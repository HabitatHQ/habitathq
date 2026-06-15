/**
 * Engine change journal.
 *
 * The journal is a property of the database, not of the network layer. Every
 * committed local `tx()` writes one row to `_changes` inside the *same*
 * storage transaction as the data writes, stamped with the engine's HLC.
 *
 * `SyncTransport` becomes a dumb drainer of a journal it does not own: read
 * rows in HLC order, POST, delete on ack. `applyRemote` writes data without
 * journaling, so we never upload a change that came from the server.
 *
 * This module owns the schema of `_changes` and the wire-shape serialisation
 * of an op. The engine passes a `JournalOp` shape that the transport knows
 * how to flatten into `WireOp`s.
 */

import type { Hlc } from "./hlc.js";
import type { Op } from "./tx.js";

export const JOURNAL_TABLE = "_changes";

/**
 * Idempotent DDL for the journal table. Safe to run on every engine init.
 *
 * The HLC columns are flat scalars (not a JSON blob) so the cursor and
 * ordering queries stay simple (`ORDER BY hlc_wall_ms, hlc_counter, hlc_node_id`).
 */
export const JOURNAL_DDL = `CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE} (
  change_id TEXT PRIMARY KEY,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  ops TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

export interface JournalRow {
  change_id: string;
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
  /** JSON-encoded `JournalOp[]`. */
  ops: string;
  created_at: number;
}

/**
 * Engine-internal op shape, suitable for the journal. Distinct from
 * `Op<S>` in that it carries a `col`/`value` split for `update` ops so
 * the journal can be replayed without engine schema knowledge. Uses the
 * `op` discriminant (matching the wire `WireOp` shape) so the transport
 * can serialise the journal directly.
 */
export type JournalOp =
  | { op: "insert"; table: string; row_id: string; data: Record<string, unknown> }
  | { op: "update"; table: string; row_id: string; col: string; value: unknown }
  | { op: "delete"; table: string; row_id: string };

/** Convert an engine `Op<S>` into the journal-friendly shape (fan-out for updates). */
export function engineOpToJournalOp(op: Op): JournalOp[] {
  if (op.type === "insert") {
    return [
      {
        op: "insert",
        table: String(op.table),
        row_id: (op.data as unknown as { id: string }).id,
        data: op.data as Record<string, unknown>,
      },
    ];
  }
  if (op.type === "update") {
    return Object.entries(op.patch).map<JournalOp>(([col, value]) => ({
      op: "update",
      table: String(op.table),
      row_id: op.id,
      col,
      value,
    }));
  }
  return [{ op: "delete", table: String(op.table), row_id: op.id }];
}

export interface JournalEntry {
  readonly changeId: string;
  readonly hlc: Hlc;
  readonly ops: ReadonlyArray<JournalOp>;
  readonly createdAt: number;
}

export function journalRowToEntry(row: JournalRow): JournalEntry {
  return {
    changeId: row.change_id,
    hlc: { wallMs: row.hlc_wall_ms, counter: row.hlc_counter, nodeId: row.hlc_node_id },
    ops: JSON.parse(row.ops) as JournalOp[],
    createdAt: row.created_at,
  };
}
