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
import { type SyncPageEnvelope, SyncTransport, type WireChange, type WireOp } from "../sync.js";

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
        return jsonResponse({}, 201);
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
    await Promise.resolve();
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
      title: "b",
      updated_at: 2,
    });
    await Promise.resolve();
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
      if (call.init?.method === "POST") return jsonResponse({}, 201);
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
      if (call.init?.method === "POST") return jsonResponse({}, 201);
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
      if (call.init?.method === "POST") return jsonResponse({}, 201);
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
      call.init?.method === "POST" ? jsonResponse({}, 201) : jsonResponse(page([change])),
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
        return jsonResponse({}, 201);
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
        return jsonResponse({}, 201);
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
      if (call.init?.method === "POST") return jsonResponse({}, 201);
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
          return jsonResponse({}, 201);
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
        return jsonResponse({}, 201);
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
      if (call.init?.method === "POST") return jsonResponse({}, 201);
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
          return postsSeen === 1 ? jsonResponse({}, 201) : new Response("no", { status: 500 });
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
      if (init?.method === "POST") return jsonResponse({}, 201);
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
      if (init?.method === "POST") return jsonResponse({}, 201);
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
      call.init?.method === "POST" ? jsonResponse({}, 201) : jsonResponse(page([change], "42")),
    );
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    expect(await db.getSyncState("append_cursor_v1")).toBe("42");
    await transport.stop();
  });

  it("rejects a malformed envelope cursor without advancing durable state", async () => {
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
    expect(await db.getSyncState("append_cursor_v1")).toBeNull();
    await transport.stop();
  });

  it("syncOnce drains the durable outbox without starting a timer", async () => {
    const db = await makeEngine(ALICE);
    const methods: Array<string | undefined> = [];
    const { fetch } = makeFakeFetch((call) => {
      methods.push(call.init?.method);
      return call.init?.method === "POST" ? jsonResponse({}, 201) : jsonResponse(page());
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

    expect(methods).toContain("POST");
    expect(await db.adapter.exec("SELECT change_id FROM _sync_outbox", [])).toHaveLength(0);
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
        return jsonResponse({}, 201);
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
    expect(posted.map((change) => change.id)).toContain("00000000-0000-4000-8000-000000000008");
    expect(await db.adapter.exec("SELECT change_id FROM _sync_outbox_quarantine", [])).toHaveLength(
      0,
    );
    await transport.stop();
  });

  it("quarantines a fingerprint-mismatched change with an unknown column", async () => {
    const db = await makeEngine(ALICE);
    const posted: WireChange[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        posted.push(JSON.parse(String(call.init.body)) as WireChange);
        return jsonResponse({}, 201);
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
