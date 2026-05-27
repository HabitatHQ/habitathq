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
import { hlcToAfterCursor, SyncTransport, type WireChange } from "../sync.js";

interface Schema {
  notes: { id: string; title: string; updated_at: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

// 8-4-4-4-12 hex format — 32 hex chars total.
const ALICE = "00000000-0000-0000-0000-0000000a11ce";
const BOB = "00000000-0000-0000-0000-00000000b0b0";
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
      return jsonResponse([]);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("local insert posts one Change with one wire insert op", async () => {
    const db = await makeEngine(ALICE);
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fakeFetch.fetch });

    await transport.start();
    await db.insert("notes", { id: "n1", title: "hi", updated_at: 1 });
    // Let the changes:local listener run.
    await Promise.resolve();
    await transport.stop();

    expect(postBodies).toHaveLength(1);
    const post = postBodies[0];
    expect(post?.ops).toHaveLength(1);
    expect(post?.ops[0]).toMatchObject({
      op: "insert",
      table: "notes",
      row_id: "n1",
      data: { id: "n1", title: "hi", updated_at: 1 },
    });
    expect(post?.hlc.nodeId).toBe(ALICE);
  });

  it("multi-op tx posts one Change carrying all ops in order", async () => {
    const db = await makeEngine(ALICE);
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fakeFetch.fetch });

    await transport.start();
    await db.tx((t) => {
      t.insert("notes", { id: "n1", title: "a", updated_at: 1 });
      t.insert("notes", { id: "n2", title: "b", updated_at: 2 });
    });
    await Promise.resolve();
    await transport.stop();

    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]?.ops).toHaveLength(2);
    expect(postBodies[0]?.ops[0]).toMatchObject({ row_id: "n1" });
    expect(postBodies[0]?.ops[1]).toMatchObject({ row_id: "n2" });
  });

  it("multi-column update splits into one wire op per column", async () => {
    const db = await makeEngine(ALICE);
    await db.insert("notes", { id: "n1", title: "old", updated_at: 1 });

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fakeFetch.fetch });
    await transport.start();
    postBodies.length = 0; // ignore the initial insert if it raced

    await db.update("notes", "n1", { title: "new", updated_at: 2 });
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
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fakeFetch.fetch });

    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await Promise.resolve();
    await db.insert("notes", { id: "n2", title: "b", updated_at: 2 });
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
      return jsonResponse([]);
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fakeFetch.fetch });

    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await Promise.resolve();
    await transport.stop();

    expect(db.getSyncStatus()).toBe("error");
  });
});

describe("SyncTransport — downlink", () => {
  it("applies remote insert via applyRemote without firing changes:local", async () => {
    const db = await makeEngine(BOB);
    const aliceHlc = { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE };
    const remoteChange: WireChange = {
      id: "c1",
      hlc: aliceHlc,
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "n1",
          data: { id: "n1", title: "from alice", updated_at: 1 },
        },
      ],
    };

    let served = false;
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      // Return the remote change exactly once.
      if (!served) {
        served = true;
        return jsonResponse([remoteChange]);
      }
      return jsonResponse([]);
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

  it("advances engine.currentHlc past the remote HLC", async () => {
    const db = await makeEngine(BOB);
    const remoteHlc = { wallMs: 9_999_999_999_999, counter: 7, nodeId: ALICE };
    const remote: WireChange = {
      id: "c1",
      hlc: remoteHlc,
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "n1",
          data: { id: "n1", title: "x", updated_at: 1 },
        },
      ],
    };
    let served = false;
    const { fetch } = makeFakeFetch(() => {
      if (!served) {
        served = true;
        return jsonResponse([remote]);
      }
      return jsonResponse([]);
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
      id: "c1",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "n1",
          data: { id: "n1", title: "own", updated_at: 1 },
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
      return jsonResponse(responses.shift() ?? []);
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
      id: "c1",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "n1",
          data: { id: "n1", title: "first", updated_at: 1 },
        },
      ],
    };

    let pollCount = 0;
    const seenUrls: string[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      seenUrls.push(call.input);
      pollCount += 1;
      if (pollCount === 1) return jsonResponse([c1]);
      return jsonResponse([]);
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      pollIntervalMs: 50,
      fetch,
    });
    await transport.start();
    await new Promise((r) => setTimeout(r, 80));
    await transport.stop();

    // Initial poll has no ?after=; subsequent polls carry the cursor.
    expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes`);
    const cursor = hlcToAfterCursor(c1.hlc);
    expect(seenUrls[1]).toBe(`${SERVER_URL}/v1/changes?after=${cursor}`);
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
      return jsonResponse([]);
    });

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await transport.stop();
    await db.insert("notes", { id: "n1", title: "x", updated_at: 1 });
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
      return jsonResponse([]);
    });
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.start();
    await transport.start(); // second call must not double-subscribe
    await db.insert("notes", { id: "n1", title: "x", updated_at: 1 });
    await Promise.resolve();
    await transport.stop();

    expect(posted).toHaveLength(1);
  });

  it("hlcToAfterCursor format is 64 chars (20 + 1 + 10 + 1 + 32)", () => {
    const cursor = hlcToAfterCursor({ wallMs: 1, counter: 0, nodeId: ALICE });
    expect(cursor).toHaveLength(64);
    expect(cursor).toMatch(/^[0-9a-f_]+$/);
  });
});
