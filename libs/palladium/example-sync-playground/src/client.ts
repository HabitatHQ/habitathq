import type { PalladiumEngine, SchemaConfig } from "@palladium/core";
import { createEngine, generateUuidV7, SyncTransport } from "@palladium/core";
import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";

/** One task row — mirrors the schema the Rust server stores opaquely. */
export type TaskRow = { id: string; text: string; done: number };
export type TasksSchema = { tasks: TaskRow };

export const SCHEMA: SchemaConfig = {
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL)",
  version: 1,
};

/** A single simulated device: its own local SQLite + its own sync uplink. */
export interface Device {
  engine: PalladiumEngine<TasksSchema>;
  transport: SyncTransport<TasksSchema>;
  nodeId: string;
  token: string;
}

/**
 * Build and start one device.
 *
 * Each device gets an *independent* in-memory SQLite (so two panes are two
 * genuinely separate clients) and a `SyncTransport` that authenticates with a
 * bearer `token`. The server derives the tenant scope from that token, so two
 * devices sharing a token share a workspace; different tokens are isolated.
 */
export async function createDevice(opts: {
  nodeId: string;
  serverUrl: string;
  token: string;
  pollIntervalMs?: number;
}): Promise<Device> {
  const engine = createEngine<TasksSchema>(new BrowserSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: opts.nodeId,
  });
  await engine.init(SCHEMA);
  const transport = new SyncTransport(engine, {
    serverUrl: opts.serverUrl,
    pollIntervalMs: opts.pollIntervalMs ?? 500,
    authHeaders: () => ({ Authorization: `Bearer ${opts.token}` }),
  });
  await transport.start();
  return { engine, transport, nodeId: opts.nodeId, token: opts.token };
}

/**
 * Fresh row / node identifier.
 *
 * NOTE: the Rust server types `row_id` and `node_id` as **UUIDs** and rejects
 * anything else with a 422 — so ids on the wire must be UUIDs, not ULIDs.
 */
export const newId = (): string => generateUuidV7();
