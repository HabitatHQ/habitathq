/**
 * Richer getSyncStatus() — pendingCount, isOnline, lastSyncId.
 *
 * Architecture review §6 'r getSyncStatus() returns only status: string.
 * The outbox now has enough data to answer pendingCount
 * (SELECT COUNT(*) FROM _sync_pending_changes) and isOnline (last
 * outcome != 'offline'); not yet exposed. lastSyncId is also missing.'
 *
 * After the journal refactor, "pendingCount" is "count of rows in
 * _changes that haven't been successfully POSTed". The transport
 * exposes this plus lastSyncId (the most recently drained change
 * from the journal) and isOnline (a derived flag).
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { SyncTransport } from "../sync.js";

interface Schema {
  notes: { id: string; title: string; updated_at: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const ALICE = "00000000-0000-0000-0000-0000000a11ce";
const SERVER_URL = "http://localhost:13747";

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

describe("SyncTransport — getSyncStatus()", () => {
  it("returns a rich object with status, pendingCount, isOnline, lastSyncId", async () => {
    const db = await makeEngine();
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      return jsonResponse([]);
    });
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      pollIntervalMs: 1_000_000,
    });

    const s = await transport.getSyncStatus();
    expect(s.status).toBe("idle");
    expect(s.pendingCount).toBe(0);
    expect(s.isOnline).toBe(true);
    expect(s.lastSyncId).toBeNull();
    await transport.start();
    await transport.stop();
  });

  it("pendingCount counts unuploaded journal rows (server returns 500)", async () => {
    const db = await makeEngine();
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return new Response("nope", { status: 500 });
      return jsonResponse([]);
    });
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      pollIntervalMs: 1_000_000,
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await db.insert("notes", { id: "n2", title: "b", updated_at: 2 });
    await new Promise((r) => setTimeout(r, 30));
    await transport.stop();

    const s = await transport.getSyncStatus();
    expect(s.pendingCount).toBe(2);
    expect(s.status).toBe("error");
    expect(s.isOnline).toBe(true);
  });

  it("isOnline is false when the most recent POST was a network failure", async () => {
    const db = await makeEngine();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "POST") throw new Error("net::ERR_INTERNET_DISCONNECTED");
      void input;
      return jsonResponse([]);
    };
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      pollIntervalMs: 1_000_000,
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await new Promise((r) => setTimeout(r, 30));
    await transport.stop();

    const s = await transport.getSyncStatus();
    expect(s.isOnline).toBe(false);
    expect(s.status).toBe("offline");
  });

  it("lastSyncId is the change_id of the most recently drained journal row", async () => {
    const db = await makeEngine();
    const drained: string[] = [];
    const { fetch } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") {
        const body = JSON.parse(String(call.init.body)) as { id: string };
        drained.push(body.id);
        return jsonResponse({}, 201);
      }
      return jsonResponse([]);
    });
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      pollIntervalMs: 1_000_000,
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await db.insert("notes", { id: "n2", title: "b", updated_at: 2 });
    await new Promise((r) => setTimeout(r, 30));
    await transport.stop();

    const s = await transport.getSyncStatus();
    expect(s.lastSyncId).not.toBeNull();
    expect(s.lastSyncId).toBe(drained[drained.length - 1] ?? null);
  });
});
