/**
 * Per-row, per-column HLC metadata for column-level last-write-wins.
 *
 * Every local write that touches a row stamps a row in `_row_versions` for
 * each column it modifies. `applyRemote` consults this table to decide
 * whether a remote op is older, equal, or newer than what we have.
 *
 * Why column-level: the wire format (`Op::Update` on the Rust side) is
 * single-column, the journal fan-out already splits per column, and
 * column LWW is the most precise LWW available without a CRDT. Row-level
 * would make any change to one column overwrite the HLC for unrelated
 * columns, which is the bug the architecture review calls out.
 *
 * Schema
 * ------
 *   _row_versions (
 *     table_name TEXT NOT NULL,
 *     row_id     TEXT NOT NULL,
 *     col        TEXT NOT NULL,
 *     hlc_wall_ms   INTEGER NOT NULL,
 *     hlc_counter   INTEGER NOT NULL,
 *     hlc_node_id   TEXT NOT NULL,
 *     PRIMARY KEY (table_name, row_id, col)
 *   )
 *
 * Missing row = no data and a very old HLC (stale wins).
 */

import type { Hlc } from "./hlc.js";

export const ROW_VERSIONS_TABLE = "_row_versions";

export const ROW_VERSIONS_DDL = `CREATE TABLE IF NOT EXISTS ${ROW_VERSIONS_TABLE} (
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  col        TEXT NOT NULL,
  hlc_wall_ms   INTEGER NOT NULL,
  hlc_counter   INTEGER NOT NULL,
  hlc_node_id   TEXT NOT NULL,
  PRIMARY KEY (table_name, row_id, col)
)`;

export interface RowVersion {
  readonly tableName: string;
  readonly rowId: string;
  readonly col: string;
  readonly hlc: Hlc;
}

export interface VersionRow {
  table_name: string;
  row_id: string;
  col: string;
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
}

export function rowToVersion(row: VersionRow): RowVersion {
  return {
    tableName: row.table_name,
    rowId: row.row_id,
    col: row.col,
    hlc: { wallMs: row.hlc_wall_ms, counter: row.hlc_counter, nodeId: row.hlc_node_id },
  };
}

/** Compare two HLCs. -1 if a < b, 1 if a > b, 0 if equal. */
export function compareHlcLocal(a: Hlc, b: Hlc): -1 | 0 | 1 {
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
  return 0;
}
