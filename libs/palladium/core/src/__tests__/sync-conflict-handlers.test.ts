/**
 * Server-side rejection + client onRejected / onStaleDelta handlers.
 *
 * Architecture review §2: 'No conflict resolution — not even LWW',
 * but also: 'Deletes vs. updates — Surfaces as conflict; onRejected
 * hook on client'.
 *
 * The current applyRemote silently drops stale ops (no signal to the
 * app). After this commit:
 *   - applyRemote returns an array of skipped stale ops. The app can
 *     inspect them to drive a 'merge UI' or audit log.
 *   - onRejected is a constructor option on SyncTransport. When
 *     the server returns 409, the rejected change is delivered to
 *     the callback instead of being retried.
 *   - onStaleDelta fires when applyRemote drops a stale op.
 *
 * The server-side 409 path is a follow-up; for now, the test uses
 * a fake server that returns 409.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { SyncTransport, type WireChange, type WireOp } from "../sync.js";

interface Schema {
  notes: { id: string; title: string; updated_at: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const ALICE = "00000000-0000-0000-0000-0000000a11ce";
const SERVER_URL = "http://localhost:13749";

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

async function makeEngine(): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: ALICE,
  });
  await db.init(SCHEMA);
  return db;
}

describe("applyRemote — returns stale-op diagnostics", () => {
  it("returns the skipped ops when the local HLC is newer", async () => {
    const db = await makeEngine();
    await db.insert("notes", { id: "n1", title: "newer", updated_at: 1 });

    const result = await db.applyRemote({ wallMs: 1, counter: 0, nodeId: "ff" }, [
      { type: "update", table: "notes", id: "n1", patch: { title: "older" } },
    ]);

    expect(result.stale).toHaveLength(1);
    expect(result.stale[0]).toMatchObject({ type: "update", id: "n1" });
  });

  it("returns an empty stale list when all ops apply", async () => {
    const db = await makeEngine();
    const result = await db.applyRemote({ wallMs: Date.now() + 10_000, counter: 0, nodeId: "ff" }, [
      {
        type: "insert",
        table: "notes",
        id: "n1",
        data: { id: "n1", title: "fresh", updated_at: 1 },
      },
    ]);
    expect(result.stale).toHaveLength(0);
  });
});

describe("SyncTransport — onRejected handler", () => {
  it("a 409 POST delivers the change to onRejected (no retry)", async () => {
    const db = await makeEngine();
    const rejected: WireChange[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        return jsonResponse({ reason: "primary-key collision" }, 409);
      }
      return jsonResponse([]);
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      pollIntervalMs: 1_000_000,
      onRejected: (change, reason) => {
        rejected.push(change);
        expect(reason).toContain("primary-key");
      },
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await new Promise((r) => setTimeout(r, 30));
    await transport.stop();

    expect(rejected).toHaveLength(1);
    // The change stays in the journal (the server is rejecting, the
    // client cannot upload — it needs app intervention).
    const journal = await db.adapter.exec<{ n: number }>("SELECT COUNT(*) AS n FROM _changes");
    expect(journal[0]?.n).toBe(1);
  });
});

describe("SyncTransport — onStaleDelta handler", () => {
  it("fires when a remote op is rejected by LWW", async () => {
    const db = await makeEngine();
    // Set up a newer local version.
    await db.insert("notes", { id: "n1", title: "newer", updated_at: 1 });

    const staleSeen: WireOp[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      // Server returns a remote op with an older HLC.
      return jsonResponse([
        {
          id: "c1",
          hlc: { wallMs: 1, counter: 0, nodeId: "ff" },
          ops: [{ op: "update", table: "notes", row_id: "n1", col: "title", value: "older" }],
        } as WireChange,
      ]);
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      pollIntervalMs: 20,
      onStaleDelta: (op) => {
        staleSeen.push(op);
      },
    });
    await transport.start();
    await new Promise((r) => setTimeout(r, 80));
    await transport.stop();

    expect(staleSeen.length).toBeGreaterThan(0);
  });
});
