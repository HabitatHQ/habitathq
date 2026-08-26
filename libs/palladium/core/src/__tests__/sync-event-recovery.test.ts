import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";
import { type SyncEvent, type SyncPageEnvelope, SyncTransport, type WireChange } from "../sync.js";

type Schema = {
  notes: { id: string; title: string; updated_at: number };
};

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const ALICE = "00000000-0000-4000-8000-0000000a11ce";
const BOB = "00000000-0000-4000-8000-00000000b0b0";
const SERVER_URL = "http://localhost:13742";
const ROOT_ID = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
const NOTE_ID = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";
const CHANGE_ID = "00000000-0000-4000-8000-0000000000c1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function page({
  changes = [],
  events = [],
  cursor = "1",
}: {
  readonly changes?: readonly WireChange[];
  readonly events?: readonly SyncEvent[];
  readonly cursor?: string | null;
} = {}): SyncPageEnvelope {
  return {
    version: 1,
    changes,
    purges: [],
    events,
    cursor,
    upperBound: cursor ?? "0",
    caughtUp: true,
    control: { mustRefetch: false },
  };
}

function remoteChange(): WireChange {
  return {
    id: CHANGE_ID,
    hlc: { wallMs: 1_700_000_000_000, counter: 3, nodeId: ALICE },
    ops: [
      {
        op: "insert",
        table: "notes",
        row_id: NOTE_ID,
        data: { id: NOTE_ID, title: "remote", updated_at: 1 },
      },
    ],
  };
}

async function makeEngine(): Promise<PalladiumEngine<Schema>> {
  const engine = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: BOB,
  });
  await engine.init(SCHEMA);
  return engine;
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
}

describe("SyncTransport — event durability", () => {
  it("commits events and cursor before acknowledging the server event", async () => {
    const engine = await makeEngine();
    const event: SyncEvent = { id: 71, kind: "grant", root_id: ROOT_ID };
    let ackSnapshot: {
      eventId: number;
      payload: string;
      acknowledgedAt: number | null;
      cursor: string | null;
    } | null = null;
    const fetch: typeof globalThis.fetch = async (input, _init) => {
      if (urlOf(input).endsWith("/events/ack")) {
        const events = await engine.adapter.exec<{
          eventId: number;
          payload: string;
          acknowledgedAt: number | null;
        }>(
          "SELECT event_id AS eventId, payload, acknowledged_at AS acknowledgedAt FROM _sync_events WHERE event_id = ?",
          [event.id],
        );
        ackSnapshot = {
          eventId: events[0]?.eventId ?? -1,
          payload: events[0]?.payload ?? "",
          acknowledgedAt: events[0]?.acknowledgedAt ?? null,
          cursor: await engine.getSyncState("append_cursor_v1"),
        };
        return jsonResponse({});
      }
      return jsonResponse(page({ events: [event], cursor: "41" }));
    };
    const transport = new SyncTransport(engine, { serverUrl: SERVER_URL, fetch });

    await transport.poll();

    expect(ackSnapshot).toEqual({
      eventId: event.id,
      payload: JSON.stringify(event),
      acknowledgedAt: null,
      cursor: "41",
    });
    const persisted = await engine.adapter.exec<{ acknowledgedAt: number | null }>(
      "SELECT acknowledged_at AS acknowledgedAt FROM _sync_events WHERE event_id = ?",
      [event.id],
    );
    expect(persisted[0]?.acknowledgedAt).not.toBeNull();
    await transport.dispose();
  });

  it("does not acknowledge an event or advance cursor when event persistence aborts", async () => {
    const engine = await makeEngine();
    const event: SyncEvent = { id: 72, kind: "revoke", root_id: ROOT_ID };
    let acknowledgements = 0;
    const fetch: typeof globalThis.fetch = async (input) => {
      if (urlOf(input).endsWith("/events/ack")) {
        acknowledgements += 1;
        return jsonResponse({});
      }
      return jsonResponse(page({ events: [event], cursor: "42" }));
    };
    const transport = new SyncTransport(engine, { serverUrl: SERVER_URL, fetch });
    await transport.inspectQuarantine();
    await engine.adapter.exec(
      "CREATE TRIGGER reject_event_persist BEFORE INSERT ON _sync_events BEGIN SELECT RAISE(ABORT, 'event persistence denied'); END",
      [],
    );

    await expect(transport.poll()).rejects.toThrow(/event persistence denied/u);

    expect(acknowledgements).toBe(0);
    expect(await engine.getSyncState("append_cursor_v1")).toBeNull();
    const persisted = await engine.adapter.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM _sync_events WHERE event_id = ?",
      [event.id],
    );
    expect(persisted[0]?.count).toBe(0);
    await transport.dispose();
  });

  it("clears degraded status after a later event acknowledgement succeeds", async () => {
    const engine = await makeEngine();
    const event: SyncEvent = { id: 73, kind: "grant", root_id: ROOT_ID };
    let acknowledgements = 0;
    const fetch: typeof globalThis.fetch = async (input) => {
      if (urlOf(input).endsWith("/events/ack")) {
        acknowledgements += 1;
        return acknowledgements === 1 ? jsonResponse({}, 503) : new Response(null, { status: 204 });
      }
      return jsonResponse(page({ events: [event], cursor: "43" }));
    };
    const transport = new SyncTransport(engine, { serverUrl: SERVER_URL, fetch });

    await transport.poll();
    expect(engine.getSyncStatus()).toBe("degraded");

    await transport.poll();
    expect(engine.getSyncStatus()).toBe("caught_up");
    expect(transport.lastError).toBeNull();
    await transport.dispose();
  });
});

describe("SyncTransport — quarantine recovery", () => {
  it("retains downlink metadata and payload across a recreated transport, then retries it", async () => {
    const engine = await makeEngine();
    const change = remoteChange();
    const fetch: typeof globalThis.fetch = async () => jsonResponse(page({ changes: [change] }));
    await engine.adapter.exec(
      "CREATE TRIGGER reject_remote_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'intentional quarantine'); END",
      [],
    );
    const first = new SyncTransport(engine, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "block",
    });

    await first.poll();

    const recorded = await first.inspectQuarantine();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      phase: "downlink",
      changeId: change.id,
      attempts: 1,
      permanent: false,
      hlcWallMs: change.hlc.wallMs,
      hlcCounter: change.hlc.counter,
      hlcNodeId: change.hlc.nodeId,
      code: expect.stringContaining("intentional quarantine"),
      updatedAt: expect.any(Number),
    });
    await first.dispose();

    const recreated = new SyncTransport(engine, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "block",
    });
    expect(await recreated.inspectQuarantine()).toEqual(recorded);
    await engine.adapter.exec("DROP TRIGGER reject_remote_note", []);

    await recreated.retryQuarantined(change.id);

    expect(await recreated.inspectQuarantine()).toEqual([]);
    const notes = await engine.exec<Schema["notes"]>(
      sql`SELECT * FROM notes WHERE id = ${NOTE_ID}`,
    );
    expect(notes).toEqual([{ id: NOTE_ID, title: "remote", updated_at: 1 }]);
    await recreated.dispose();
  });

  it("persists explicit discard as a forward skip across recreated transports", async () => {
    const engine = await makeEngine();
    const change = remoteChange();
    const fetch: typeof globalThis.fetch = async () =>
      jsonResponse(page({ changes: [change], cursor: "73" }));
    await engine.adapter.exec(
      "CREATE TRIGGER reject_discarded_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'discard me'); END",
      [],
    );
    const first = new SyncTransport(engine, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "block",
    });

    await first.poll();
    await first.discardQuarantined(change.id);
    await first.dispose();

    const second = new SyncTransport(engine, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "block",
    });
    await second.poll();
    expect(await engine.getSyncState("append_cursor_v1")).toBe("73");
    const notes = await engine.exec<Schema["notes"]>(
      sql`SELECT * FROM notes WHERE id = ${NOTE_ID}`,
    );
    expect(notes).toEqual([]);
    await second.dispose();

    const requested: string[] = [];
    const third = new SyncTransport(engine, {
      serverUrl: SERVER_URL,
      fetch: async (input) => {
        requested.push(urlOf(input));
        return jsonResponse(page({ cursor: "73" }));
      },
    });
    await third.poll();
    expect(requested[0]).toBe(`${SERVER_URL}/v1/changes?limit=100&cursor=73`);
    await third.dispose();
  });

  it("exposes block and degraded skip terminal policies through status and typed errors", async () => {
    const blockEngine = await makeEngine();
    const change = remoteChange();
    const fetch: typeof globalThis.fetch = async () => jsonResponse(page({ changes: [change] }));
    await blockEngine.adapter.exec(
      "CREATE TRIGGER reject_blocked_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'blocked remote change'); END",
      [],
    );
    const blocked = new SyncTransport(blockEngine, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "block",
    });

    await blocked.poll();

    expect(blockEngine.getSyncStatus()).toBe("degraded");
    expect(blocked.lastError).toMatchObject({
      phase: "downlink",
      code: "quarantine_blocked",
      retryable: false,
      changeId: change.id,
    });
    await blocked.dispose();

    const skipEngine = await makeEngine();
    await skipEngine.adapter.exec(
      "CREATE TRIGGER reject_skipped_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'skipped remote change'); END",
      [],
    );
    const skipped = new SyncTransport(skipEngine, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "degraded_skip",
    });

    await skipped.poll();

    expect(skipEngine.getSyncStatus()).toBe("degraded");
    expect(skipped.lastError).toMatchObject({
      phase: "downlink",
      code: "quarantine_degraded_skip",
      retryable: false,
      changeId: change.id,
    });
    await skipped.dispose();
  });
});
