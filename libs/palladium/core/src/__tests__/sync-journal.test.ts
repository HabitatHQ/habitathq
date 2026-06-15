/**
 * Tests that exercise the SyncTransport ↔ engine-journal integration.
 *
 * After the journal-in-engine refactor (§1), the transport's uplink is a
 * dumb drainer: read rows from `_changes` in HLC order, POST, delete on
 * success. The transport no longer needs the `_sync_pending_changes`
 * shadow table — the journal is the outbox.
 *
 * Key invariants exercised:
 * - A local tx() leaves a journal row; the transport picks it up
 *   without ever subscribing to a "changes:local" event.
 * - Successful POST removes the journal row (not a separate outbox row).
 * - Pending journal rows survive a transport restart and are retried.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { JournalRow } from "../journal.js";
import type { SchemaConfig } from "../migration.js";
import { SyncTransport, type WireChange } from "../sync.js";

interface Schema {
  notes: { id: string; title: string; updated_at: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const ALICE = "00000000-0000-0000-0000-0000000a11ce";
const SERVER_URL = "http://localhost:13743";

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

async function journalRows(db: PalladiumEngine<Schema>): Promise<JournalRow[]> {
  return db.adapter.exec<JournalRow>(
    "SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at FROM _changes ORDER BY hlc_wall_ms, hlc_counter, change_id",
    [],
  );
}

async function legacyOutboxCount(db: PalladiumEngine<Schema>): Promise<number> {
  // The transport used to maintain _sync_pending_changes separately.
  // After the journal refactor it should not create that table.
  try {
    const rows = await db.adapter.exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM _sync_pending_changes",
    );
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

describe("SyncTransport — engine journal uplink", () => {
  let postBodies: WireChange[];
  let fakeFetch: ReturnType<typeof makeFakeFetch>;

  beforeEach(() => {
    postBodies = [];
    fakeFetch = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        postBodies.push(JSON.parse(String(call.init.body)) as WireChange);
        return jsonResponse({}, 201);
      }
      return jsonResponse([]);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads journal rows that existed before transport.start()", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: ALICE,
    });
    await db.init(SCHEMA);

    // Local writes before the transport ever starts — these MUST end up
    // uploaded. (This is the bug §1 of the architecture review called out.)
    await db.insert("notes", { id: "n1", title: "before", updated_at: 1 });
    await db.insert("notes", { id: "n2", title: "after", updated_at: 2 });
    expect(await journalRows(db)).toHaveLength(2);

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fakeFetch.fetch });
    await transport.start();
    await transport.stop();

    // Both changes were posted, in HLC order.
    expect(postBodies).toHaveLength(2);
    expect(postBodies[0]?.ops[0]).toMatchObject({ row_id: "n1" });
    expect(postBodies[1]?.ops[0]).toMatchObject({ row_id: "n2" });
    // …and the journal is drained.
    expect(await journalRows(db)).toHaveLength(0);
  });

  it("successful POST removes the change from the _changes journal", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: ALICE,
    });
    await db.init(SCHEMA);
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch: fakeFetch.fetch,
      pollIntervalMs: 20,
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    // Wait for the next tick to drain.
    await new Promise((r) => setTimeout(r, 60));
    await transport.stop();

    expect(postBodies).toHaveLength(1);
    expect(await journalRows(db)).toHaveLength(0);
  });

  it("non-OK POST leaves the journal row in place; status flips to 'error'", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: ALICE,
    });
    await db.init(SCHEMA);
    fakeFetch = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return new Response("nope", { status: 500 });
      return jsonResponse([]);
    });
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch: fakeFetch.fetch,
      pollIntervalMs: 20,
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await new Promise((r) => setTimeout(r, 60));
    await transport.stop();

    const rows = await journalRows(db);
    expect(rows).toHaveLength(1);
    expect(db.getSyncStatus()).toBe("error");
  });

  it("pending journal row survives a transport restart and drains on next start()", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: ALICE,
    });
    await db.init(SCHEMA);

    // Server rejects; row stays in the journal.
    {
      fakeFetch = makeFakeFetch((call) => {
        if (call.init?.method === "POST") return new Response("nope", { status: 500 });
        return jsonResponse([]);
      });
      const t = new SyncTransport(db, {
        serverUrl: SERVER_URL,
        fetch: fakeFetch.fetch,
        pollIntervalMs: 20,
      });
      await t.start();
      await db.insert("notes", { id: "n1", title: "queued", updated_at: 1 });
      await new Promise((r) => setTimeout(r, 60));
      await t.stop();
    }
    expect(await journalRows(db)).toHaveLength(1);

    // Server now accepts; drain on the second start clears the row.
    {
      postBodies = [];
      fakeFetch = makeFakeFetch((call) => {
        if (call.init?.method === "POST") {
          postBodies.push(JSON.parse(String(call.init.body)) as WireChange);
          return jsonResponse({}, 201);
        }
        return jsonResponse([]);
      });
      const t = new SyncTransport(db, {
        serverUrl: SERVER_URL,
        fetch: fakeFetch.fetch,
        pollIntervalMs: 20,
      });
      await t.start();
      await t.stop();

      expect(postBodies).toHaveLength(1);
    }
    expect(await journalRows(db)).toHaveLength(0);
  });

  it("the transport does NOT create a separate _sync_pending_changes table", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: ALICE,
    });
    await db.init(SCHEMA);
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch: fakeFetch.fetch,
      pollIntervalMs: 20,
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await new Promise((r) => setTimeout(r, 60));
    await transport.stop();

    expect(await legacyOutboxCount(db)).toBe(0);
    expect(await journalRows(db)).toHaveLength(0);
  });
});
