/**
 * Auth seam — SyncTransport accepts a static `headers` option that is
 * merged into every request's Headers.
 *
 * Architecture review §3.6: "#tryPost/#poll send bare fetch with no
 * auth header hook. Before any multi-user deployment there must be at
 * least a headers/fetch-middleware option."
 *
 * The seam is small: an `authHeader` (or `headers`) option. For
 * dynamic tokens (rotating JWTs etc.) callers can use the `fetch`
 * override that already exists; this is the explicit, ergonomic path
 * for the common case.
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
const SERVER_URL = "http://localhost:13746";

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

describe("SyncTransport — auth seam", () => {
  it("static `headers` option is merged into every request", async () => {
    const db = await makeEngine(ALICE);
    const { fetch, calls } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      return jsonResponse([]);
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      headers: { Authorization: "Bearer test-token" },
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await new Promise((r) => setTimeout(r, 20));
    await transport.stop();

    // Every recorded call must carry the Authorization header.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe("Bearer test-token");
    }
  });

  it("a `headers` factory function is called per-request (for rotating tokens)", async () => {
    const db = await makeEngine(ALICE);
    const { fetch, calls } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      return jsonResponse([]);
    });

    let tokenSeq = 0;
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      headers: () => ({ Authorization: `Bearer token-${tokenSeq++}` }),
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await new Promise((r) => setTimeout(r, 20));
    await transport.stop();

    expect(calls.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string> | undefined;
      const auth = headers?.Authorization;
      if (auth !== undefined) seen.add(auth);
    }
    // Multiple distinct tokens were issued across requests.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("no `headers` option — existing behavior unchanged (no Authorization header)", async () => {
    const db = await makeEngine(ALICE);
    const { fetch, calls } = makeFakeFetch((call) => {
      if (call.init?.method === "POST") return jsonResponse({}, 201);
      return jsonResponse([]);
    });

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
    });
    await transport.start();
    await db.insert("notes", { id: "n1", title: "a", updated_at: 1 });
    await new Promise((r) => setTimeout(r, 20));
    await transport.stop();

    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
    }
  });
});
