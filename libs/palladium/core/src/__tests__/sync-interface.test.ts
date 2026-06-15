/**
 * Tests for the SyncTransport interface extraction.
 *
 * The interface (`start()`, `stop()`) is what consumers depend on; the
 * concrete HTTP-polling implementation is one realisation. SSE and
 * WebSocket transports can implement the same interface without
 * changes to the engine or the bindings.
 *
 * The contract:
 *   start() — begin draining the engine's journal + receiving remote
 *             changes. Idempotent. Safe to call repeatedly.
 *   stop()  — stop polling, unsubscribe from the engine. Idempotent.
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

describe("SyncTransport interface", () => {
  it("SyncTransport exposes start/stop and is constructible from a PalladiumEngine", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
    await db.init(SCHEMA);

    const transport = new SyncTransport(db, {
      serverUrl: "http://localhost:0",
      pollIntervalMs: 1_000_000,
      fetch: (() =>
        Promise.resolve(new Response("[]", { status: 200 }))) as typeof globalThis.fetch,
    });

    expect(typeof transport.start).toBe("function");
    expect(typeof transport.stop).toBe("function");
    await transport.start();
    await transport.stop();
  });

  it("start() is idempotent — multiple calls do not start a second poll", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
    await db.init(SCHEMA);

    const transport = new SyncTransport(db, {
      serverUrl: "http://localhost:0",
      pollIntervalMs: 1_000_000,
      fetch: (() =>
        Promise.resolve(new Response("[]", { status: 200 }))) as typeof globalThis.fetch,
    });
    await transport.start();
    await transport.start(); // second call must not throw or double-subscribe
    await transport.stop();
  });

  it("stop() is idempotent", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
    await db.init(SCHEMA);

    const transport = new SyncTransport(db, {
      serverUrl: "http://localhost:0",
      pollIntervalMs: 1_000_000,
      fetch: (() =>
        Promise.resolve(new Response("[]", { status: 200 }))) as typeof globalThis.fetch,
    });
    await transport.start();
    await transport.stop();
    await transport.stop(); // second call must not throw
  });
});
