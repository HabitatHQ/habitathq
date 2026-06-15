/**
 * §3.2 — Persisted cursor.
 *
 * Architecture review §3.2: "#cursor lives on the transport instance.
 * Every page reload re-fetches the *entire* server history. Persist
 * the cursor (e.g. a _sync_state row next to the outbox) and reloads
 * become incremental."
 *
 * The fix: store the cursor in a single-row _sync_state table in the
 * engine's database. The transport reads it on start() and writes it
 * after every successful applyRemote.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { hlcToAfterCursor, SyncTransport, type WireChange } from "../sync.js";

interface Schema {
  notes: { id: string; title: string; updated_at: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const ALICE = "00000000-0000-0000-0000-0000000a11ce";
const SERVER_URL = "http://localhost:13745";

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

function makeChange(id: string, rowId: string, wallMs: number): WireChange {
  return {
    id,
    hlc: { wallMs, counter: 0, nodeId: "ff" },
    ops: [
      {
        op: "insert",
        table: "notes",
        row_id: rowId,
        data: { id: rowId, title: `note ${rowId}`, updated_at: wallMs },
      },
    ],
  };
}

async function makeEngine(nodeId: string): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId,
  });
  await db.init(SCHEMA);
  return db;
}

describe("SyncTransport — persisted cursor", () => {
  it("the cursor survives a transport restart — second start picks up where the first left off", async () => {
    const db = await makeEngine(ALICE);
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);
    const c2 = makeChange("c2", "n2", 1_700_000_001_000);

    // First transport: server returns [c1, c2], cursor advances.
    {
      const seenUrls: string[] = [];
      let pollCount = 0;
      const { fetch } = makeFakeFetch((call) => {
        if (call.init?.method === "POST") return jsonResponse({}, 201);
        seenUrls.push(call.input);
        pollCount += 1;
        if (pollCount === 1) return jsonResponse([c1, c2]);
        return jsonResponse([]);
      });
      const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
      await t.start();
      await t.stop();

      expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes`);
    }

    // Second transport on the same engine: should pick up the persisted
    // cursor and request from there, not from the beginning.
    {
      const seenUrls: string[] = [];
      const { fetch } = makeFakeFetch((call) => {
        if (call.init?.method === "POST") return jsonResponse({}, 201);
        seenUrls.push(call.input);
        return jsonResponse([]);
      });
      const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
      await t.start();
      await t.stop();

      const expectedCursor = hlcToAfterCursor(c2.hlc);
      expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes?after=${expectedCursor}`);
    }
  });

  it("a brand-new engine with no persisted cursor fetches the full history (no ?after=)", async () => {
    const db = await makeEngine(ALICE);
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);

    const seenUrls: string[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      seenUrls.push(call.input);
      return jsonResponse([c1]);
    });
    const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await t.start();
    await t.stop();

    expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes`);
  });

  it("the cursor row lives in _sync_state (single-row key/value)", async () => {
    const db = await makeEngine(ALICE);
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);

    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      return jsonResponse([c1]);
    });
    const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await t.start();
    await t.stop();

    const rows = await db.adapter.exec<{ key: string; value: string }>(
      "SELECT key, value FROM _sync_state",
    );
    const cursor = rows.find((r) => r.key === "cursor");
    expect(cursor?.value).toBe(hlcToAfterCursor(c1.hlc));
  });
});
