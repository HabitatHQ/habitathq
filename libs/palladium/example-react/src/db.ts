/**
 * NotesEngine — local notes store synced to a `palladium-axum` backend.
 *
 * Now a thin wrapper: schema definition + `SyncTransport` lifecycle. The
 * uplink / downlink / HLC stamping / re-emit suppression all live in
 * `@palladium/core`'s `SyncTransport`.
 */

import { createEngine, type PalladiumEngine, SyncTransport } from "@palladium/core";
import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";

// ── Schema ─────────────────────────────────────────────────────────────────

export interface NoteRow {
  id: string;
  title: string;
  /** Stringified TipTap JSON. */
  content: string;
  updated_at: number;
}

export type NotesSchema = { notes: NoteRow };

const SCHEMA = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

// ── Notes session: engine + transport ─────────────────────────────────────

export interface NotesSession {
  readonly engine: PalladiumEngine<NotesSchema>;
  readonly transport: SyncTransport<NotesSchema>;
  stop(): Promise<void>;
}

/**
 * Build a notes engine + transport, wire them up, hydrate from server.
 * The returned `stop()` clears the transport polling loop.
 */
export async function createNotesSession(serverUrl: string, nodeId: string): Promise<NotesSession> {
  const engine = createEngine<NotesSchema>(new BrowserSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId,
  });
  await engine.init(SCHEMA);

  const transport = new SyncTransport(engine, { serverUrl, pollIntervalMs: 1_000 });
  await transport.start();

  return {
    engine,
    transport,
    stop: () => transport.stop(),
  };
}
