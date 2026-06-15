/**
 * Single-row key/value store for sync state.
 *
 * Used by SyncTransport to persist the cursor (and eventually the
 * lastSyncId, lastError, etc.) so that warm client restarts don't
 * refetch full server history.
 *
 * Schema
 * ------
 *   _sync_state (
 *     key   TEXT PRIMARY KEY,
 *     value TEXT NOT NULL,
 *     updated_at INTEGER NOT NULL
 *   )
 *
 * Single-row reads/writes per key. The transport never SELECTs or
 * UPDATEs more than one row at a time.
 */

export const SYNC_STATE_TABLE = "_sync_state";

export const SYNC_STATE_DDL = `CREATE TABLE IF NOT EXISTS ${SYNC_STATE_TABLE} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export interface SyncStateRow {
  key: string;
  value: string;
  updated_at: number;
}

export const SYNC_STATE_KEYS = {
  /** Lexicographic HLC cursor for `GET /v1/changes?after=`. */
  cursor: "cursor",
  /** Engine's last-known HLC (wallMs|counter|nodeId) for HLC durability. */
  currentHlc: "current_hlc",
  /** Persisted nodeId (HLC identifier) so it survives reloads. */
  nodeId: "node_id",
} as const;

export type SyncStateKey = (typeof SYNC_STATE_KEYS)[keyof typeof SYNC_STATE_KEYS];
