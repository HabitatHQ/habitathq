/**
 * SyncTransport unit tests — exercise the engine ↔ HTTP loop with a mocked
 * `fetch`. Each test installs a fake fetch that records requests and returns
 * canned responses, lets the transport run, then asserts on the engine state
 * and HTTP traffic.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";
import {
  type SyncPageEnvelope,
  type SyncReceipt,
  SyncTransport,
  type WireChange,
  type WireOp,
} from "../sync.js";

type Schema = {
  notes: { id: string; title: string; updated_at: number };
};

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

// 8-4-4-4-12 hex format — 32 hex chars total.
const ALICE = "00000000-0000-4000-8000-0000000a11ce";
const BOB = "00000000-0000-4000-8000-00000000b0b0";
const SERVER_URL = "http://localhost:13742";

type FetchCall = { input: string; init?: RequestInit };

function makeFakeFetch(responder: (call: FetchCall) => Response): {
  fetch: typeof globalThis.fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const call: FetchCall = { input: url, init: init ?? undefined };
    calls.push(call);
    return responder(call);
  };
  return { fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function receipt(outcome: "inserted" | "duplicate" = "inserted"): SyncReceipt {
  return { version: 1, outcome, cursor: "1" };
}

function page(
  changes: readonly WireChange[] = [],
  cursor: string | null = "0",
  caughtUp = true,
): SyncPageEnvelope {
  return {
    version: 1,
    changes,
    purges: [],
    events: [],
    cursor,
    upperBound: cursor ?? "0",
    caughtUp,
    control: { mustRefetch: false },
  };
}

async function makeEngine(nodeId: string): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId,
  });
  await db.init(SCHEMA);
  return db;
}

describe("SyncTransport — uplink", () => {
  let postBodies: WireChange[];
  let fakeFetch: ReturnType<typeof makeFakeFetch>;

  beforeEach(() => {
    postBodies = [];
    fakeFetch = makeFakeFetch((call) => {
      if (call.input.startsWith(`${SERVER_URL}/v1/changes`) && call.init?.method === "POST") {
        postBodies.push(JSON.parse(String(call.init.body)) as WireChange);
        return jsonResponse(receipt(), 201);
      }
      // GET /v1/changes — return empty list for these uplink tests
      return jsonResponse(page());
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("local insert posts one Change with one wire insert op", async () => {
    const db = await makeEngine(ALICE);
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch: fakeFetch.fetch,
    });

    await transport.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "hi",
      updated_at: 1,
    });
    // Let the changes:local listener run.
    await Promise.resolve();
    await transport.stop();

    expect(postBodies).toHaveLength(1);
    const post = postBodies[0];
    expect(post?.ops).toHaveLength(1);
    expect(post?.ops[0]).toMatchObject({
      op: "insert",
      table: "notes",
      row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "hi", updated_at: 1 },
    });
    expect(post?.hlc.nodeId).toBe(ALICE);
  });

  it("multi-op tx posts one Change carrying all ops in order", async () => {
    const db = await makeEngine(ALICE);
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch: fakeFetch.fetch,
    });

    await transport.start();
    await db.tx((t) => {
      t.insert("notes", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "a", updated_at: 1 });
      t.insert("notes", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac", title: "b", updated_at: 2 });
    });
    await Promise.resolve();
    await transport.stop();

    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]?.ops).toHaveLength(2);
    expect(postBodies[0]?.ops[0]).toMatchObject({ row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab" });
    expect(postBodies[0]?.ops[1]).toMatchObject({ row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac" });
  });

  it("multi-column update splits into one wire op per column", async () => {
    const db = await makeEngine(ALICE);
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "old",
      updated_at: 1,
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch: fakeFetch.fetch,
    });
    await transport.start();
    postBodies.length = 0; // ignore the initial insert if it raced

    await db.update("notes", "018f0f50-7b8d-7a1c-8e2f-1234567890ab", {
      title: "new",
      updated_at: 2,
    });
    await Promise.resolve();
    await transport.stop();

    expect(postBodies).toHaveLength(1);
    const post = postBodies[0];
    expect(post?.ops).toHaveLength(2);
    expect(post?.ops.map((o) => (o.op === "update" ? o.col : null)).sort()).toEqual([
      "title",
      "updated_at",
    ]);
  });

  it("HLC counter advances across consecutive local writes in the same ms", async () => {
    const db = await makeEngine(ALICE);
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch: fakeFetch.fetch,
    });

    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    await transport.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "a",
      updated_at: 1,
    });
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
      title: "b",
      updated_at: 2,
    });
    await transport.syncOnce();
    await transport.stop();

    expect(postBodies).toHaveLength(2);
    const first = postBodies[0]?.hlc;
    const second = postBodies[1]?.hlc;
    expect(first?.wallMs).toBe(second?.wallMs);
    expect(second?.counter).toBeGreaterThan(first?.counter ?? -1);
  });

  it("non-OK POST flips status to error", async () => {
    const db = await makeEngine(ALICE);
    fakeFetch = makeFakeFetch((call) => {
      if (call.input.startsWith(`${SERVER_URL}/v1/changes`) && call.init?.method === "POST") {
        return new Response("nope", { status: 500 });
      }
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch: fakeFetch.fetch,
    });

    await transport.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "a",
      updated_at: 1,
    });
    await Promise.resolve();
    await transport.stop();

    expect(db.getSyncStatus()).toBe("degraded");
  });
});

describe("SyncTransport — downlink", () => {
  it("applies remote insert via applyRemote without firing changes:local", async () => {
    const db = await makeEngine(BOB);
    const aliceHlc = { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE };
    const remoteChange: WireChange = {
      id: "00000000-0000-4000-8000-000000000001",
      hlc: aliceHlc,
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "from alice", updated_at: 1 },
        },
      ],
    };

    let served = false;
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse(receipt(), 201);
      // Return the remote change exactly once.
      if (!served) {
        served = true;
        return jsonResponse(page([remoteChange]));
      }
      return jsonResponse(page());
    });

    const localCb = vi.fn();
    db.on("changes:local", localCb);

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await transport.stop();

    const rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("from alice");
    // Remote ops must not be re-emitted as local changes.
    expect(localCb).not.toHaveBeenCalled();
  });

  it("poll() before start() provisions tables and can quarantine a bad change", async () => {
    const db = await makeEngine(BOB);
    // Insert omits NOT NULL `title` → apply throws → must be quarantinable, which
    // needs `_sync_quarantine`. Before the fix, poll() without start() rejected
    // with "no such table".
    const poison: WireChange = {
      id: "00000000-0000-4000-8000-000000000001",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab" },
        },
      ],
    };
    const { fetch } = makeFakeFetch(() => jsonResponse(page([poison])));
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    // Drive a single poll directly, without start().
    await expect(transport.poll()).resolves.toBeUndefined();

    const dl = await db.adapter.exec<{ change_id: string }>(
      "SELECT change_id FROM _sync_quarantine",
      [],
    );
    expect(dl.map((r) => r.change_id)).toContain("00000000-0000-4000-8000-000000000001");
  });

  it("rejects a non-canonical raw wire operation sequence without applying it", async () => {
    const db = await makeEngine(BOB);
    const nonCanonical: WireChange = {
      id: "00000000-0000-4000-8000-00000000000a",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "first", updated_at: 1 },
        },
        {
          op: "update",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          col: "title",
          value: "second",
        },
      ],
    };
    const { fetch } = makeFakeFetch(() => jsonResponse(page([nonCanonical])));
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await transport.poll();

    expect(transport.lastError).toMatchObject({
      phase: "protocol",
      code: "invalid_operation",
      retryable: false,
      changeId: nonCanonical.id,
    });
    expect(await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`)).toEqual([]);
    await transport.dispose();
  });

  it("retries a remediated durable payload after discard clears its permanent state", async () => {
    const db = await makeEngine(BOB);
    const poisoned: WireChange = {
      id: "00000000-0000-4000-8000-00000000000b",
      hlc: { wallMs: 1_700_000_000_001, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac", updated_at: 1 },
        },
      ],
    };
    const { fetch } = makeFakeFetch(() => jsonResponse(page([poisoned])));
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await transport.poll();
    await transport.discardQuarantined(poisoned.id);
    await db.adapter.exec("UPDATE _sync_quarantine SET ops = ? WHERE change_id = ?", [
      JSON.stringify([
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
          data: {
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
            title: "remediated",
            updated_at: 1,
          },
        },
      ]),
      poisoned.id,
    ]);

    await transport.retryQuarantined(poisoned.id);

    expect(await transport.inspectQuarantine()).toEqual([]);
    expect(
      await db.exec<Schema["notes"]>(
        sql`SELECT * FROM notes WHERE id = ${"018f0f50-7b8d-7a1c-8e2f-1234567890ac"}`,
      ),
    ).toEqual([
      {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
        title: "remediated",
        updated_at: 1,
      },
    ]);
    await transport.dispose();
  });

  it("ignores a legacy HLC cursor and starts from the new append cursor key", async () => {
    const db = await makeEngine(BOB);
    await db.setSyncState("cursor", "legacy-hlc-cursor");
    const seen: string[] = [];
    const { fetch } = makeFakeFetch((call) => {
      seen.push(call.input);
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    expect(seen[0]).toBe(`${SERVER_URL}/v1/changes?limit=100`);
    expect(await db.getSyncState("append_cursor_v1")).toBe("0");
    await transport.stop();
  });

  it("concurrent start()/poll() initialize exactly once", async () => {
    const db = await makeEngine(BOB);
    await db.setSyncState("append_cursor_v1", "0");

    // Count how many times the outbox DDL runs — init must fire once even when
    // start() and poll() overlap (both would otherwise pass the flag check).
    const adapter = db.adapter;
    const origExec = adapter.exec.bind(adapter);
    let outboxDdlCount = 0;
    adapter.exec = ((sqlText: string, params: unknown[]) => {
      if (
        typeof sqlText === "string" &&
        sqlText.includes("CREATE TABLE IF NOT EXISTS _sync_outbox")
      ) {
        outboxDdlCount += 1;
      }
      return origExec(sqlText, params as never);
    }) as typeof adapter.exec;

    const { fetch } = makeFakeFetch(() => jsonResponse(page()));
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await Promise.all([transport.start(), transport.poll()]);
    await transport.stop();
    expect(outboxDdlCount).toBe(2);
    expect(db.currentHlc).toBeNull(); // cursor restore didn't corrupt clock state
  });

  it("advances engine.currentHlc past the remote HLC", async () => {
    const db = await makeEngine(BOB);
    const remoteHlc = { wallMs: 1_700_000_001_000, counter: 7, nodeId: ALICE };
    const remote: WireChange = {
      id: "00000000-0000-4000-8000-000000000001",
      hlc: remoteHlc,
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "x", updated_at: 1 },
        },
      ],
    };
    let served = false;
    const { fetch } = makeFakeFetch(() => {
      if (!served) {
        served = true;
        return jsonResponse(page([remote]));
      }
      return jsonResponse(page());
    });

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await transport.stop();

    const next = db.nextSendHlc();
    expect(next.wallMs).toBeGreaterThanOrEqual(remoteHlc.wallMs);
    if (next.wallMs === remoteHlc.wallMs) {
      expect(next.counter).toBeGreaterThan(remoteHlc.counter);
    }
  });

  it("skips own-node changes after initial hydration", async () => {
    const db = await makeEngine(ALICE);
    // First poll seeds local table from server; the server has Alice's own
    // historical change. Initial hydration should still apply it.
    const ownChange: WireChange = {
      id: "00000000-0000-4000-8000-000000000001",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "own", updated_at: 1 },
        },
      ],
    };

    const responses = [
      [ownChange], // first poll: hydrate from server (own change is applied)
      [ownChange], // second poll: same own change again, should be skipped now
      [],
    ];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse(receipt(), 201);
      return jsonResponse(page(responses.shift() ?? []));
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      pollIntervalMs: 50,
      fetch,
    });
    await transport.start(); // applies ownChange during initial hydration
    // Pre-poll: own change applied via applyRemote, so table has 1 row.
    let rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows).toHaveLength(1);

    // Wait a poll interval, then check that the re-served own change was skipped.
    await new Promise((r) => setTimeout(r, 80));
    rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows).toHaveLength(1);

    await transport.stop();
  });

  it("cursor advances after applied remote changes", async () => {
    const db = await makeEngine(BOB);
    const c1: WireChange = {
      id: "00000000-0000-4000-8000-000000000001",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "first", updated_at: 1 },
        },
      ],
    };

    let pollCount = 0;
    const seenUrls: string[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse(receipt(), 201);
      seenUrls.push(call.input);
      pollCount += 1;
      if (pollCount === 1) return jsonResponse(page([c1]));
      return jsonResponse(page());
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      pollIntervalMs: 50,
      fetch,
    });
    await transport.start();
    await new Promise((r) => setTimeout(r, 80));
    await transport.stop();

    expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes?limit=100`);
    expect(seenUrls[1]).toBe(`${SERVER_URL}/v1/changes?limit=100&cursor=0`);
  });
  it("keeps the cursor monotonic when a poll includes older backfill", async () => {
    const db = await makeEngine(BOB);
    const newer: WireChange = {
      id: "00000000-0000-4000-8000-000000000002",
      hlc: { wallMs: 1_700_000_000_500, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad", title: "newer", updated_at: 1 },
        },
      ],
    };
    const olderBackfill: WireChange = {
      id: "00000000-0000-4000-8000-000000000003",
      hlc: { wallMs: 1_699_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae", title: "older", updated_at: 1 },
        },
      ],
    };
    const responses = [page([newer, olderBackfill]), page()];
    const { calls, fetch } = makeFakeFetch(() => jsonResponse(responses.shift() ?? page()));
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await transport.poll();
    await transport.poll();

    expect(calls.map((call) => call.input)).toEqual([
      `${SERVER_URL}/v1/changes?limit=100`,
      `${SERVER_URL}/v1/changes?limit=100&cursor=0`,
    ]);
    await transport.stop();
  });

  it("rejects an insert whose data.id does not equal row_id without advancing the cursor", async () => {
    const db = await makeEngine(BOB);
    const change: WireChange = {
      id: "00000000-0000-4000-8000-000000000004",
      hlc: { wallMs: 1_700_000_000_010, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890b1",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890b2", title: "ok", updated_at: 1 },
        },
      ],
    };
    const { fetch } = makeFakeFetch((call) =>
      call.init?.method === "POST" ? jsonResponse(receipt(), 201) : jsonResponse(page([change])),
    );
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
    });

    await transport.poll();

    const rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows).toHaveLength(0);
    expect(await db.getSyncState("append_cursor_v1")).toBeNull();
    await transport.dispose();
  });
});
describe("SyncTransport — lifecycle", () => {
  it("stop() unsubscribes from changes:local so later writes don't post", async () => {
    const db = await makeEngine(ALICE);
    const posted: WireChange[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        posted.push(JSON.parse(String(call.init.body)) as WireChange);
        return jsonResponse(receipt(), 201);
      }
      return jsonResponse(page());
    });

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await transport.stop();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "x",
      updated_at: 1,
    });
    await Promise.resolve();

    expect(posted).toHaveLength(0);
  });

  it("start() is idempotent (no double-subscription)", async () => {
    const db = await makeEngine(ALICE);
    const posted: WireChange[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        posted.push(JSON.parse(String(call.init.body)) as WireChange);
        return jsonResponse(receipt(), 201);
      }
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await transport.start(); // second call must not double-subscribe
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "x",
      updated_at: 1,
    });
    await Promise.resolve();
    await transport.stop();

    expect(posted).toHaveLength(1);
  });

  it("keeps local checkpointing active after stop until disposal", async () => {
    const db = await makeEngine(ALICE);
    const { fetch } = makeFakeFetch(() => jsonResponse(page()));
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await transport.stop();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "durable",
      updated_at: 1,
    });

    expect(await outboxRows(db)).toHaveLength(1);
    await transport.dispose();
  });

  it("replaces a disposed transport without duplicate outbox checkpoints", async () => {
    const db = await makeEngine(ALICE);
    const posted: WireChange[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        posted.push(JSON.parse(String(call.init.body)) as WireChange);
        return jsonResponse(receipt(), 201);
      }
      return jsonResponse(page());
    });
    const first = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await first.start();
    await first.dispose();

    const replacement = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await replacement.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "replacement",
      updated_at: 1,
    });
    await replacement.syncOnce();
    await replacement.stop();

    expect(posted).toHaveLength(1);
    expect(await outboxRows(db)).toHaveLength(0);
    await replacement.dispose();
  });

  it("does not leak a checkpoint when another transport construction fails", async () => {
    const db = await makeEngine(ALICE);
    const { fetch } = makeFakeFetch(() => jsonResponse(page()));
    const first = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    expect(() => new SyncTransport(db, { serverUrl: SERVER_URL, fetch })).toThrow(
      "already attached",
    );
    await first.dispose();

    const replacement = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await replacement.start();
    await replacement.stop();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "single-checkpoint",
      updated_at: 1,
    });
    expect(await outboxRows(db)).toHaveLength(1);
    await replacement.dispose();
  });

  it("cancels an in-flight startup poll before stop resolves", async () => {
    const db = await makeEngine(ALICE);
    let aborted = false;
    let markFetchStarted: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") return jsonResponse(receipt(), 201);
      markFetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("cancelled", "AbortError"));
          },
          { once: true },
        );
      });
    };
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    const starting = transport.start();
    await fetchStarted;
    await transport.stop();
    await starting;

    expect(aborted).toBe(true);
    await transport.dispose();
  });
  it("serializes overlapping poll and syncOnce calls", async () => {
    const db = await makeEngine(ALICE);
    let active = 0;
    let maximumActive = 0;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") return jsonResponse(receipt(), 201);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return jsonResponse(page());
    };
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await Promise.all([transport.poll(), transport.syncOnce()]);

    expect(maximumActive).toBe(1);
    await transport.dispose();
  });
});

describe("SyncTransport — opaque cursors", () => {
  it("persists and sends opaque version-one cursor tokens unchanged", async () => {
    const db = await makeEngine(ALICE);
    const urls: string[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse(receipt(), 201);
      urls.push(call.input);
      return jsonResponse(page([], "checkpoint/A:1"));
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await transport.poll();
    await transport.poll();

    expect(await db.getSyncState("append_cursor_v1")).toBe("checkpoint/A:1");
    expect(urls).toEqual([
      `${SERVER_URL}/v1/changes?limit=100`,
      `${SERVER_URL}/v1/changes?limit=100&cursor=checkpoint%2FA%3A1`,
    ]);
    await transport.dispose();
  });
});

describe("SyncTransport — durable events", () => {
  const event = {
    id: 1,
    kind: "grant" as const,
    root_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
  };

  it("persists an event before acknowledging it", async () => {
    const db = await makeEngine(ALICE);
    const { fetch } = makeFakeFetch((call) => {
      if (call.input.endsWith("/events/ack")) return new Response(null, { status: 204 });
      return jsonResponse({ ...page(), events: [event] });
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await transport.poll();

    const rows = await db.adapter.exec<{ event_id: number; acknowledged_at: number | null }>(
      "SELECT event_id, acknowledged_at FROM _sync_events",
      [],
    );
    expect(rows).toEqual([{ event_id: 1, acknowledged_at: expect.any(Number) }]);
    await transport.dispose();
  });

  it("keeps a processed event pending when acknowledgement fails", async () => {
    const db = await makeEngine(ALICE);
    const { fetch } = makeFakeFetch((call) => {
      if (call.input.endsWith("/events/ack")) return new Response("unavailable", { status: 503 });
      return jsonResponse({ ...page(), events: [event] });
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await transport.poll();
    await transport.poll();

    const rows = await db.adapter.exec<{ event_id: number; acknowledged_at: number | null }>(
      "SELECT event_id, acknowledged_at FROM _sync_events",
      [],
    );
    expect(rows).toEqual([{ event_id: 1, acknowledged_at: null }]);
    expect(transport.lastError?.code).toBe("event_ack_rejected");
    await transport.dispose();

    const { fetch: recoveredFetch } = makeFakeFetch((call) => {
      if (call.input.endsWith("/events/ack")) return new Response(null, { status: 204 });
      return jsonResponse({ ...page(), events: [event] });
    });
    const recovered = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: recoveredFetch });
    await recovered.poll();
    const acknowledged = await db.adapter.exec<{
      event_id: number;
      acknowledged_at: number | null;
    }>("SELECT event_id, acknowledged_at FROM _sync_events", []);
    expect(acknowledged).toEqual([{ event_id: 1, acknowledged_at: expect.any(Number) }]);
    await recovered.dispose();
  });
});

interface OutboxRow {
  change_id: string;
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
  ops: string;
  created_at: number;
}

async function outboxRows(db: PalladiumEngine<Schema>): Promise<OutboxRow[]> {
  return db.adapter.exec<OutboxRow>(
    "SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at FROM _sync_outbox ORDER BY hlc_wall_ms, hlc_counter",
    [],
  );
}

describe("SyncTransport — durable outbox", () => {
  it("successful POST removes the change from the outbox", async () => {
    const db = await makeEngine(ALICE);
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse(receipt(), 201);
      return jsonResponse(page());
    });

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "a",
      updated_at: 1,
    });
    await Promise.resolve();
    await transport.stop();

    const rows = await outboxRows(db);
    expect(rows).toHaveLength(0);
  });
  it("preserves Retry-After as structured retry scheduling data", async () => {
    const db = await makeEngine(ALICE);
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        return new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      }
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    const before = Date.now();
    await transport.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
      title: "rate-limited",
      updated_at: 1,
    });
    await transport.syncOnce();

    expect(transport.lastError).toMatchObject({
      phase: "uplink",
      code: "http_rejected",
      retryable: true,
      status: 429,
      body: "slow down",
    });
    expect(transport.lastError?.nextRetryAt).toBeGreaterThanOrEqual(before + 1_000);
    expect(await outboxRows(db)).toHaveLength(1);
    await transport.dispose();
  });

  for (const [description, response] of [
    ["an empty receipt", () => jsonResponse({}, 201)],
    ["an HTML receipt", () => new Response("<html>ok</html>", { status: 201 })],
    ["a receipt with another version", () => jsonResponse({ ...receipt(), version: 2 }, 201)],
    [
      "a receipt with an unknown outcome",
      () => jsonResponse({ ...receipt(), outcome: "queued" }, 201),
    ],
    ["a receipt without a cursor", () => jsonResponse({ version: 1, outcome: "inserted" }, 201)],
  ] as const) {
    it(`retains the outbox for ${description}`, async () => {
      const db = await makeEngine(ALICE);
      const { fetch } = makeFakeFetch((call) =>
        call.init?.method === "POST" ? response() : jsonResponse(page()),
      );
      const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
      await transport.start();
      await db.insert("notes", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
        title: "receipt",
        updated_at: 1,
      });
      await transport.syncOnce();
      await transport.stop();

      expect(await outboxRows(db)).toHaveLength(1);
      expect(transport.lastError?.code).toBe("invalid_receipt");
    });
  }
  it("aborts a stalled response body at requestTimeoutMs and cleans up timers", async () => {
    vi.useFakeTimers();
    const db = await makeEngine(ALICE);
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method !== "POST") return jsonResponse(page());
      const signal = call.init.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const completion = setTimeout(() => controller.close(), 200);
          signal?.addEventListener("abort", () => {
            clearTimeout(completion);
            controller.error(new DOMException("request timed out", "AbortError"));
          });
        },
      });
      return new Response(body, { status: 201 });
    });
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      requestTimeoutMs: 100,
    });
    await transport.poll();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "stalled",
      updated_at: 1,
    });
    await Promise.resolve();
    const syncing = transport.syncOnce();
    await vi.advanceTimersByTimeAsync(100);
    await syncing;

    expect(transport.lastError).toMatchObject({
      code: "request_timeout",
      retryable: true,
    });
    expect(await outboxRows(db)).toHaveLength(1);
    await transport.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not POST again before Retry-After eligibility", async () => {
    const db = await makeEngine(ALICE);
    let posts = 0;
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        posts += 1;
        return new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "rate-limited",
      updated_at: 1,
    });
    await transport.syncOnce();
    await transport.syncOnce();

    expect(posts).toBe(1);
    expect(await outboxRows(db)).toHaveLength(1);
    await transport.dispose();
  });

  it("does not automatically retry a terminal protocol failure", async () => {
    const db = await makeEngine(ALICE);
    let posts = 0;
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        posts += 1;
        return jsonResponse({}, 201);
      }
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "invalid receipt",
      updated_at: 1,
    });
    await transport.syncOnce();
    await transport.syncOnce();

    expect(posts).toBe(1);
    expect(transport.lastError).toMatchObject({
      code: "invalid_receipt",
      retryable: false,
    });
    expect(await outboxRows(db)).toHaveLength(1);
    await transport.dispose();
  });

  it("non-OK POST leaves the change in the outbox; engine status is 'error'", async () => {
    const db = await makeEngine(ALICE);
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return new Response("nope", { status: 500 });
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "a",
      updated_at: 1,
    });
    await Promise.resolve();
    await transport.stop();

    const rows = await outboxRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.change_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(rows[0]?.hlc_node_id).toBe(ALICE);
    expect(db.getSyncStatus()).toBe("degraded");
  });

  it("network failure (fetch throws) leaves the change in the outbox; status is 'offline'", async () => {
    const db = await makeEngine(ALICE);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "POST") throw new Error("net::ERR_INTERNET_DISCONNECTED");
      void input;
      return jsonResponse(page());
    };
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "a",
      updated_at: 1,
    });
    await Promise.resolve();
    await transport.stop();

    expect(await outboxRows(db)).toHaveLength(1);
    expect(db.getSyncStatus()).toBe("offline");
  });

  it("pending change survives a transport restart and drains on next start()", async () => {
    const db = await makeEngine(ALICE);

    // First transport: server rejects, change ends up in outbox.
    {
      const { fetch } = makeFakeFetch((call) => {
        if (call.init?.method === "POST") return new Response("nope", { status: 500 });
        return jsonResponse(page());
      });
      const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
      await t.start();
      await db.insert("notes", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
        title: "queued",
        updated_at: 1,
      });
      await Promise.resolve();
      await t.dispose();
    }
    expect(await outboxRows(db)).toHaveLength(1);

    // Second transport: server now accepting; drain on start clears the outbox.
    {
      const posted: WireChange[] = [];
      const { fetch } = makeFakeFetch((call) => {
        if (call.init?.method === "POST") {
          posted.push(JSON.parse(String(call.init.body)) as WireChange);
          return jsonResponse(receipt(), 201);
        }
        return jsonResponse(page());
      });
      const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
      await t.start(); // drainOutbox runs here
      await t.stop();

      expect(posted).toHaveLength(1);
      expect(posted[0]?.ops[0]).toMatchObject({ row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab" });
    }
    expect(await outboxRows(db)).toHaveLength(0);
  });
  it("replays a server-processed POST after the response is lost", async () => {
    vi.useFakeTimers();
    const db = await makeEngine(ALICE);
    const accepted = new Set<string>();
    let postCount = 0;
    let loseFirstResponse = true;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        const change = JSON.parse(String(init.body)) as WireChange;
        accepted.add(change.id);
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error("injected response loss after server commit");
        }
        return jsonResponse(receipt("duplicate"), 201);
      }
      return jsonResponse(page());
    };

    const first = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await first.start();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "replay-safe",
      updated_at: 1,
    });
    await Promise.resolve();
    await first.dispose();
    expect(await outboxRows(db)).toHaveLength(1);

    const second = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await vi.advanceTimersByTimeAsync(1_000);
    await second.start();
    await second.stop();

    expect(postCount).toBe(2);
    expect(accepted).toHaveLength(1);
    expect(await outboxRows(db)).toHaveLength(0);
  });

  it("does not advance the cursor after a truncated response", async () => {
    const db = await makeEngine(BOB);
    const change: WireChange = {
      id: "00000000-0000-4000-8000-000000000005",
      hlc: { wallMs: 1_700_000_000_100, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890af",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890af", title: "eventual", updated_at: 1 },
        },
      ],
    };
    let pollCount = 0;
    const seenUrls: string[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse(receipt(), 201);
      seenUrls.push(call.input);
      pollCount += 1;
      return pollCount === 1
        ? new Response(JSON.stringify(page([change])).slice(0, 12), { status: 200 })
        : jsonResponse(page([change]));
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    await transport.poll();
    await transport.stop();

    expect(seenUrls).toEqual([
      `${SERVER_URL}/v1/changes?limit=100`,
      `${SERVER_URL}/v1/changes?limit=100`,
    ]);
    const rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("eventual");
  });

  it("drainOutbox stops at the first failure to preserve ordering", async () => {
    const db = await makeEngine(ALICE);

    // Queue two changes against a failing server.
    {
      const { fetch } = makeFakeFetch((call) => {
        if (call.init?.method === "POST") return new Response("nope", { status: 500 });
        return jsonResponse(page());
      });
      const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
      await t.start();
      await db.insert("notes", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
        title: "first",
        updated_at: 1,
      });
      await Promise.resolve();
      await db.insert("notes", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
        title: "second",
        updated_at: 2,
      });
      await Promise.resolve();
      await t.dispose();
    }
    expect(await outboxRows(db)).toHaveLength(2);

    // Now: server accepts the first, rejects the second.
    {
      let postsSeen = 0;
      const { fetch } = makeFakeFetch((call) => {
        if (call.init?.method === "POST") {
          postsSeen += 1;
          return postsSeen === 1
            ? jsonResponse(receipt(), 201)
            : new Response("no", { status: 500 });
        }
        return jsonResponse(page());
      });
      const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
      await t.start();
      await t.stop();
      // Drain stopped after the second POST failed; first row gone, second still queued.
      const rows = await outboxRows(db);
      expect(rows).toHaveLength(1);
      const parsedOps = JSON.parse(rows[0]?.ops ?? "[]") as WireOp[];
      expect(parsedOps[0]).toMatchObject({ row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac" });
    }
  });
});

describe("SyncTransport — auth decoration (§2b)", () => {
  it("attaches authHeaders to poll and post requests", async () => {
    const db = await makeEngine(ALICE);
    const authSeen: Array<string | null> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      authSeen.push(new Headers(init?.headers).get("authorization"));
      if (init?.method === "POST") return jsonResponse(receipt(), 201);
      void url;
      return jsonResponse(page());
    };
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      authHeaders: () => ({ Authorization: "Bearer tok", "X-Workspace": "w1" }),
    });

    await transport.start(); // one GET poll
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "a",
      updated_at: 1,
    }); // one POST
    await Promise.resolve();
    await transport.stop();

    expect(authSeen.length).toBeGreaterThan(0);
    expect(authSeen.every((a) => a === "Bearer tok")).toBe(true);
  });

  it("refreshes the token and retries once on 401", async () => {
    const db = await makeEngine(ALICE);
    const refreshFlags: boolean[] = [];
    const tokensSent: Array<string | null> = [];
    let firstGet = true;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") return jsonResponse(receipt(), 201);
      tokensSent.push(new Headers(init?.headers).get("authorization"));
      if (firstGet) {
        firstGet = false;
        return new Response("unauthorized", { status: 401 }); // triggers refresh+retry
      }
      return jsonResponse(page());
    };
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      authHeaders: ({ refresh }) => {
        refreshFlags.push(refresh);
        return { Authorization: refresh ? "Bearer new" : "Bearer old" };
      },
    });

    await transport.start(); // first GET → 401 → refresh → retry
    await transport.stop();

    // Hook was called with refresh=false then refresh=true; the retry sent the
    // refreshed token.
    expect(refreshFlags).toContain(false);
    expect(refreshFlags).toContain(true);
    expect(tokensSent).toContain("Bearer old");
    expect(tokensSent).toContain("Bearer new");
  });
});

describe("SyncTransport — Atrium append cursor", () => {
  it("persists an envelope cursor after applying all changes", async () => {
    const db = await makeEngine(BOB);
    const change: WireChange = {
      id: "00000000-0000-4000-8000-000000000006",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890b0",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890b0", title: "envelope", updated_at: 1 },
        },
      ],
    };
    const { fetch } = makeFakeFetch((call) =>
      call.init?.method === "POST"
        ? jsonResponse(receipt(), 201)
        : jsonResponse(page([change], "42")),
    );
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    expect(await db.getSyncState("append_cursor_v1")).toBe("42");
    await transport.stop();
  });

  it("persists an opaque envelope cursor without numeric interpretation", async () => {
    const db = await makeEngine(BOB);
    const { fetch } = makeFakeFetch(() =>
      jsonResponse({
        version: 1,
        changes: [],
        cursor: "-1",
        purges: [],
        events: [],
        upperBound: "0",
        caughtUp: true,
        control: { mustRefetch: false },
      }),
    );
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    expect(await db.getSyncState("append_cursor_v1")).toBe("-1");
    await transport.stop();
  });

  it("syncOnce drains the durable outbox without starting a timer", async () => {
    const db = await makeEngine(ALICE);
    const methods: Array<string | undefined> = [];
    const { fetch } = makeFakeFetch((call) => {
      methods.push(call.init?.method);
      return call.init?.method === "POST" ? jsonResponse(receipt(), 201) : jsonResponse(page());
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    await db.adapter.exec(
      `INSERT INTO _sync_outbox
       (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "00000000-0000-4000-8000-000000000007",
        1,
        0,
        ALICE,
        JSON.stringify([
          {
            op: "insert",
            table: "notes",
            row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
            data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "queued", updated_at: 1 },
          },
        ]),
        "unversioned",
        1,
      ],
    );

    await transport.syncOnce();

    expect(methods).not.toContain("POST");
    expect(await db.adapter.exec("SELECT change_id FROM _sync_outbox", [])).toHaveLength(0);
    expect(await db.adapter.exec("SELECT change_id FROM _sync_outbox_quarantine", [])).toHaveLength(
      1,
    );
    await transport.stop();
  });
});

describe("SyncTransport — outbox schema compatibility", () => {
  it("posts a fingerprint-mismatched change when its columns still exist", async () => {
    const db = await makeEngine(ALICE);
    const posted: WireChange[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        posted.push(JSON.parse(String(call.init.body)) as WireChange);
        return jsonResponse(receipt(), 201);
      }
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      schemaFingerprint: "current",
    });
    await transport.start();
    await transport.stop();
    await db.adapter.exec(
      `INSERT INTO _sync_outbox
       (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "00000000-0000-4000-8000-000000000008",
        1,
        0,
        ALICE,
        JSON.stringify([
          {
            op: "insert",
            table: "notes",
            row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
            data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "queued", updated_at: 1 },
          },
        ]),
        "old",
        1,
      ],
    );
    await transport.start();
    expect(posted).toHaveLength(0);
    expect(await db.adapter.exec("SELECT change_id FROM _sync_outbox_quarantine", [])).toHaveLength(
      1,
    );
    await transport.stop();
  });

  it("quarantines a fingerprint-mismatched change with an unknown column", async () => {
    const db = await makeEngine(ALICE);
    const posted: WireChange[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        posted.push(JSON.parse(String(call.init.body)) as WireChange);
        return jsonResponse(receipt(), 201);
      }
      return jsonResponse(page());
    });
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      schemaFingerprint: "current",
    });
    await transport.start();
    await transport.stop();
    await db.adapter.exec(
      `INSERT INTO _sync_outbox
       (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "00000000-0000-4000-8000-000000000009",
        1,
        0,
        ALICE,
        JSON.stringify([
          {
            op: "update",
            table: "notes",
            row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
            col: "removed_column",
            value: "x",
          },
        ]),
        "old",
        1,
      ],
    );
    await transport.start();
    expect(posted).toHaveLength(0);
    const quarantined = await db.adapter.exec<{ change_id: string }>(
      "SELECT change_id FROM _sync_outbox_quarantine",
      [],
    );
    expect(quarantined.map((row) => row.change_id)).toContain(
      "00000000-0000-4000-8000-000000000009",
    );
  });
});
