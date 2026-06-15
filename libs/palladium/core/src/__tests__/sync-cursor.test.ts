/**
 * §3.1 — Cursor advancement only after successful apply.
 *
 * Architecture review §3.1: the old poll loop advanced the cursor for
 * every change *before* awaiting applyRemote, so a mid-loop throw
 * silently skipped the failed change forever. The fix is to advance
 * the cursor only after applyRemote resolves, and to surface the
 * error to the engine's `error` event so subscribers can react.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it, vi } from "vitest";
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
const SERVER_URL = "http://localhost:13744";

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

function makeChange(id: string, rowId: string, hlcWallMs: number): WireChange {
  return {
    id,
    hlc: { wallMs: hlcWallMs, counter: 0, nodeId: "ff" },
    ops: [
      {
        op: "insert",
        table: "notes",
        row_id: rowId,
        data: { id: rowId, title: `note ${rowId}`, updated_at: hlcWallMs },
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

describe("SyncTransport — cursor advance on success", () => {
  it("cursor advances past a change only after applyRemote resolves", async () => {
    const db = await makeEngine(ALICE);
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);
    const c2 = makeChange("c2", "n2", 1_700_000_001_000);
    const c3 = makeChange("c3", "n3", 1_700_000_002_000);

    const seenUrls: string[] = [];
    let pollCount = 0;
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      seenUrls.push(call.input);
      pollCount += 1;
      if (pollCount === 1) return jsonResponse([c1, c2, c3]);
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

    // First poll URL has no ?after= (cold start).
    expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes`);
    // Second poll URL has cursor pointing at c3, the last successfully
    // applied change.
    const expectedCursor = hlcToAfterCursor(c3.hlc);
    expect(seenUrls[1]).toBe(`${SERVER_URL}/v1/changes?after=${expectedCursor}`);
  });

  it("a thrown error in applyRemote does NOT advance the cursor past the failed change", async () => {
    const db = await makeEngine(ALICE);
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);

    // Override the engine's applyRemote to throw on the second change.
    const realApply = db.applyRemote.bind(db);
    let callCount = 0;
    vi.spyOn(db, "applyRemote").mockImplementation((hlc, ops) => {
      callCount += 1;
      if (callCount === 1) return realApply(hlc, ops);
      throw new Error("disk full");
    });

    // Server returns [c1, c2]. c1 applies, c2 throws.
    const c2 = makeChange("c2", "n2", 1_700_000_001_000);
    const seenUrls: string[] = [];
    let pollCount = 0;
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      seenUrls.push(call.input);
      pollCount += 1;
      if (pollCount === 1) return jsonResponse([c1, c2]);
      return jsonResponse([]);
    });

    // Surface errors to the engine's 'error' event so a subscriber knows.
    const errorCb = vi.fn();
    db.on("error", errorCb);

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      pollIntervalMs: 50,
      fetch,
    });
    await transport.start();
    await new Promise((r) => setTimeout(r, 80));
    await transport.stop();

    // Cursor is at c1 (the last successful change), not c2.
    const expectedCursor = hlcToAfterCursor(c1.hlc);
    expect(seenUrls[1]).toBe(`${SERVER_URL}/v1/changes?after=${expectedCursor}`);
    // Error was emitted.
    expect(errorCb).toHaveBeenCalled();
  });

  it("the next poll retries the change that failed last time", async () => {
    const db = await makeEngine(ALICE);
    const c1 = makeChange("c1", "n1", 1_700_000_000_000);
    const c2 = makeChange("c2", "n2", 1_700_000_001_000);

    // First applyRemote call (for c1) throws, second (also c1) succeeds.
    const realApply = db.applyRemote.bind(db);
    let attempts = 0;
    vi.spyOn(db, "applyRemote").mockImplementation(async (hlc, ops) => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
      return realApply(hlc, ops);
    });

    let pollCount = 0;
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      pollCount += 1;
      // Always return c1 (the cursor says "everything up to here") so the
      // transport retries c1 each time.
      if (pollCount === 1) return jsonResponse([c1, c2]);
      return jsonResponse([c1]);
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      pollIntervalMs: 30,
      fetch,
    });
    await transport.start();
    // Give it a few ticks.
    await new Promise((r) => setTimeout(r, 100));
    await transport.stop();

    // c1 was attempted at least twice (first failed, second succeeded).
    expect(attempts).toBeGreaterThanOrEqual(2);
    // c1 is now in the database.
    const rows = await db.adapter.exec<{ id: string }>("SELECT id FROM notes WHERE id = 'n1'");
    expect(rows).toHaveLength(1);
  });
});
