/**
 * Bootstrap cold-start tests.
 *
 * Architecture review §5: 'Bootstrap snapshots server-side'. The full
 * fix is a server-side GET /v1/bootstrap that returns a compacted
 * snapshot + cursor. The client part of the fix lives in
 * SyncTransport.bootstrap(): do one full-history fetch, persist the
 * cursor, and (if a snapshot is returned) apply it before polling.
 *
 * For this commit, the client side handles the snapshot. The server
 * side ships the wire shape: a bootstrap response is
 *   { snapshot?: Change[], cursor: string }
 * where snapshot is the optional compacted state. Empty snapshot
 * is allowed (server may not yet support compaction; the client
 * falls through to the regular /v1/changes poll).
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
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

const ALICE = "00000000-0000-0000-0000-0000000a11ce";
const SERVER_URL = "http://localhost:13748";

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

function makeChange(id: string, rowId: string, wallMs: number, nodeId = "ff"): WireChange {
  return {
    id,
    hlc: { wallMs, counter: 0, nodeId },
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

async function makeEngine(): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: ALICE,
  });
  await db.init(SCHEMA);
  return db;
}

describe("SyncTransport — bootstrap cold-start", () => {
  it("bootstrap() fetches a snapshot from /v1/bootstrap and persists the cursor", async () => {
    const db = await makeEngine();
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);
    const c2 = makeChange("c2", "n2", 1_700_000_001_000);

    const { fetch, calls } = makeFakeFetch((call) => {
      if (call.input === `${SERVER_URL}/v1/bootstrap`) {
        return jsonResponse({
          snapshot: [c1, c2],
          cursor: hlcToAfterCursor(c2.hlc),
        });
      }
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      return jsonResponse([]);
    });

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    const result = await transport.bootstrap();
    await transport.stop();

    expect(result.applied).toBe(2);
    expect(result.cursor).toBe(hlcToAfterCursor(c2.hlc));

    // A single /v1/bootstrap call was made (not /v1/changes).
    expect(calls.some((c) => c.input === `${SERVER_URL}/v1/bootstrap`)).toBe(true);
    expect(calls.filter((c) => c.input === `${SERVER_URL}/v1/bootstrap`)).toHaveLength(1);

    // Rows landed locally.
    const rows = await db.exec<{ id: string }>(sql`SELECT id FROM notes ORDER BY id`);
    expect(rows.map((r) => r.id)).toEqual(["n1", "n2"]);

    // Cursor was persisted.
    const persisted = await db.adapter.exec<{ value: string }>(
      "SELECT value FROM _sync_state WHERE key = 'cursor'",
    );
    expect(persisted[0]?.value).toBe(hlcToAfterCursor(c2.hlc));
  });

  it("bootstrap() with an empty snapshot still persists the server cursor (skip replay)", async () => {
    const db = await makeEngine();
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);

    const { fetch } = makeFakeFetch((call) => {
      if (call.input === `${SERVER_URL}/v1/bootstrap`) {
        return jsonResponse({ snapshot: [], cursor: hlcToAfterCursor(c1.hlc) });
      }
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      return jsonResponse([]);
    });

    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    const result = await transport.bootstrap();
    await transport.stop();

    expect(result.applied).toBe(0);
    expect(result.cursor).toBe(hlcToAfterCursor(c1.hlc));
  });

  it("bootstrap() followed by start() picks up from the persisted cursor (no full replay)", async () => {
    const db = await makeEngine();
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);

    {
      const { fetch } = makeFakeFetch((call) => {
        if (call.input === `${SERVER_URL}/v1/bootstrap`) {
          return jsonResponse({ snapshot: [c1], cursor: hlcToAfterCursor(c1.hlc) });
        }
        if (call.init?.method === "POST") return jsonResponse({}, 201);
        return jsonResponse([]);
      });
      const t = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
      await t.bootstrap();
      await t.stop();
    }

    // Second transport: should NOT call /v1/bootstrap (or /v1/changes
    // without ?after=). It should go straight to incremental polling.
    const seenUrls: string[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      seenUrls.push(call.input);
      return jsonResponse([]);
    });
    const t = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      pollIntervalMs: 1_000_000,
    });
    await t.start();
    await t.stop();

    expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes?after=${hlcToAfterCursor(c1.hlc)}`);
  });
});
