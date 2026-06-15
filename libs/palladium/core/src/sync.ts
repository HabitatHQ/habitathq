/**
 * SyncTransport — HTTP-poll-based sync between a `PalladiumEngine` and a
 * `palladium-axum` server.
 *
 * Lifecycle
 * ─────────
 * The transport is a dumb drainer of the engine's `_changes` journal. It
 * does not own the journal; the engine writes a row for every local tx
 * (see {@link PalladiumEngine.tx}). On `start()`, the transport:
 *
 *   1. drains any rows already in the journal (writes made before
 *      `start()`, plus rows that never made it to the server last time),
 *   2. hydrates from the server with the current cursor,
 *   3. starts polling.
 *
 * Each tick: drain the journal, then poll for remote changes. `stop()`
 * clears the poll timer. The transport can be restarted (idempotently).
 *
 * Wire-format quirks
 * ──────────────────
 * The Rust server's `Op::Update` is single-column (`{col, value}`) while
 * the engine's update op carries a `patch: Partial<Row>` (potentially
 * many columns). The journal stores one `update` per column (fan-out),
 * which matches the wire shape directly.
 */

import type { PalladiumEngine, SyncStatus } from "./engine.js";
import type { Hlc } from "./hlc.js";
import { JOURNAL_TABLE, type JournalOp, type JournalRow, journalRowToEntry } from "./journal.js";
import { SYNC_STATE_KEYS, SYNC_STATE_TABLE } from "./sync-state.js";
import type { SchemaMap } from "./tx.js";

// Re-export the status type for consumers that import from sync.ts.
export type { SyncStatus } from "./engine.js";

// ── Wire types (mirror of the Rust palladium-core JSON serialisation) ──────

export interface InsertWireOp {
  readonly op: "insert";
  readonly table: string;
  readonly row_id: string;
  readonly data: Record<string, unknown>;
}

export interface UpdateWireOp {
  readonly op: "update";
  readonly table: string;
  readonly row_id: string;
  readonly col: string;
  readonly value: unknown;
}

export interface DeleteWireOp {
  readonly op: "delete";
  readonly table: string;
  readonly row_id: string;
}

export type WireOp = InsertWireOp | UpdateWireOp | DeleteWireOp;

export interface WireChange {
  readonly id: string;
  readonly hlc: Hlc;
  readonly ops: ReadonlyArray<WireOp>;
}

// ── Cursor encoding ─────────────────────────────────────────────────────────

/**
 * Encode an [`Hlc`] as the lexicographic cursor accepted by the server's
 * `GET /v1/changes?after=` query parameter.
 *
 * Format: `{wallMs:020}_{counter:010}_{nodeIdHex:032x}` — sortable as a string.
 */
export function hlcToAfterCursor(hlc: Hlc): string {
  const wallMs = String(hlc.wallMs).padStart(20, "0");
  const counter = String(hlc.counter).padStart(10, "0");
  const nodeId = hlc.nodeId.replace(/-/g, "").padStart(32, "0");
  return `${wallMs}_${counter}_${nodeId}`;
}

// ── Options ────────────────────────────────────────────────────────────────

/**
 * Static headers (Record) or a factory returning headers (for rotating
 * tokens). Merged into every request alongside the default
 * `Content-Type: application/json`. Pass `undefined` to omit auth.
 */
export type AuthHeaders =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

export interface SyncTransportOptions {
  readonly serverUrl: string;
  /** Polling interval for the downlink. Default: 1000 ms. */
  readonly pollIntervalMs?: number;
  /** Override `fetch` for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Auth headers merged into every request. Either a static record or
   * a factory (called once per request; may return a Promise for async
   * token refresh). For dynamic per-request logic, prefer the `fetch`
   * override above.
   */
  readonly headers?: AuthHeaders;
}

// ── Journal ↔ wire conversion ──────────────────────────────────────────────

/** Convert one journal `Op` into its wire shape. The shapes already match. */
function journalOpToWire(op: JournalOp): WireOp {
  if (op.op === "insert") {
    return { op: "insert", table: op.table, row_id: op.row_id, data: op.data };
  }
  if (op.op === "update") {
    return { op: "update", table: op.table, row_id: op.row_id, col: op.col, value: op.value };
  }
  return { op: "delete", table: op.table, row_id: op.row_id };
}

function rowToChange(row: JournalRow): WireChange {
  const entry = journalRowToEntry(row);
  return {
    id: entry.changeId,
    hlc: entry.hlc,
    ops: entry.ops.map(journalOpToWire),
  };
}

/** Convert one wire `Op` into the engine `Op` shape that `applyRemote` accepts. */
function wireOpToEngine<S extends SchemaMap>(
  op: WireOp,
):
  | {
      type: "insert";
      table: keyof S & string;
      data: Record<string, unknown> & { id: string };
    }
  | {
      type: "update";
      table: keyof S & string;
      id: string;
      patch: Record<string, unknown>;
    }
  | {
      type: "delete";
      table: keyof S & string;
      id: string;
    } {
  if (op.op === "insert") {
    return {
      type: "insert",
      table: op.table as keyof S & string,
      data: { id: op.row_id, ...op.data } as Record<string, unknown> & { id: string },
    };
  }
  if (op.op === "update") {
    return {
      type: "update",
      table: op.table as keyof S & string,
      id: op.row_id,
      patch: { [op.col]: op.value },
    };
  }
  return {
    type: "delete",
    table: op.table as keyof S & string,
    id: op.row_id,
  };
}

type PostOutcome = "ok" | "rejected" | "offline";

const POST_OUTCOME_TO_STATUS: Record<PostOutcome, SyncStatus> = {
  ok: "idle",
  rejected: "error",
  offline: "offline",
};

// ── Transport ──────────────────────────────────────────────────────────────

/**
 * The contract every sync transport must satisfy.
 *
 * `SyncTransport` (HTTP-polling) is one realisation. SSE and WebSocket
 * transports can implement the same interface without changes to the
 * engine or the framework bindings. The contract is intentionally
 * minimal: drain the engine's journal of pending changes, fetch remote
 * changes, and surface failures via the engine's `error` event.
 */
export interface SyncTransportInterface {
  /** Begin draining + receiving. Idempotent. */
  start(): Promise<void>;
  /** Stop draining + receiving. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Rich sync status object returned by `getSyncStatus()`.
 *
 * - `status`: coarse state string. `"syncing"` while a POST or
 *   poll is in flight, `"error"` when a server rejected, `"offline"`
 *   when fetch threw, `"idle"` otherwise.
 * - `pendingCount`: number of rows in the engine's `_changes`
 *   journal that have not been successfully POSTed yet.
 * - `isOnline`: derived from the most recent POST outcome — false
 *   iff it was a network failure (not a 4xx/5xx rejection).
 * - `lastSyncId`: `change_id` of the most recently drained journal
 *   row (i.e. the last thing we successfully sent to the server),
 *   or null if nothing has been sent yet.
 */
export interface SyncStatusInfo {
  readonly status: SyncStatus;
  readonly pendingCount: number;
  readonly isOnline: boolean;
  readonly lastSyncId: string | null;
}

export class SyncTransport<S extends SchemaMap> implements SyncTransportInterface {
  readonly #engine: PalladiumEngine<S>;
  readonly #serverUrl: string;
  readonly #pollIntervalMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #authHeaders: AuthHeaders | undefined;

  #status: SyncStatus = "idle";
  #cursor: string | null = null;
  #cursorDirty = false;
  #lastSyncId: string | null = null;
  #pollHandle: ReturnType<typeof setInterval> | null = null;
  #polling = false;
  #unsubscribeLocal: (() => void) | null = null;

  constructor(engine: PalladiumEngine<S>, options: SyncTransportOptions) {
    this.#engine = engine;
    this.#serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#authHeaders = options.headers;
  }

  /**
   * Current sync status. The transport is the canonical owner; the
   * engine no longer carries this state (architecture review §6).
   * `sync:status` events on the engine are emitted by the transport
   * via `notifySyncStatus` — subscribers on either side see the same
   * stream.
   */
  async getSyncStatus(): Promise<SyncStatusInfo> {
    const rows = await this.#engine.adapter.exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM _changes",
    );
    return {
      status: this.#status,
      pendingCount: rows[0]?.n ?? 0,
      isOnline: this.#status !== "offline",
      lastSyncId: this.#lastSyncId,
    };
  }

  /**
   * Update the transport's status and emit a `sync:status` event on
   * the engine so subscribers don't have to wire up a separate bus.
   */
  #setStatus(s: SyncStatus): void {
    this.#status = s;
    this.#engine.notifySyncStatus(s);
  }

  /**
   * Drain the engine's journal, hydrate from the server, then start polling.
   * Idempotent.
   *
   * We also subscribe to the engine's `changes:local` event to trigger an
   * *immediate* drain attempt when a new local tx commits. The journal is
   * still the source of truth: the event is just a hint to avoid waiting
   * for the next poll tick. A racing tick-drain and event-drain is safe —
   * both read the same rows in the same order, and the DELETE is idempotent
   * (the second one is a no-op).
   */
  async start(): Promise<void> {
    if (this.#pollHandle !== null) return;
    this.#unsubscribeLocal = this.#engine.on("changes:local", () => {
      void this.#drainJournal();
    });
    await this.#drainJournal();
    await this.#loadPersistedCursor();
    await this.#poll();
    this.#pollHandle = setInterval(() => {
      void this.#tick();
    }, this.#pollIntervalMs);
  }

  /** One periodic step: drain the journal, then poll. */
  async #tick(): Promise<void> {
    await this.#drainJournal();
    await this.#poll();
  }

  /**
   * Re-attempt every row currently in the engine's `_changes` journal,
   * oldest first. The transport owns nothing; the engine does. We just
   * observe and try to upload.
   *
   * Stop after the first failure to preserve ordering and avoid hammering
   * a server that's clearly not accepting writes.
   */
  async #drainJournal(): Promise<void> {
    const rows = await this.#engine.adapter.exec<JournalRow>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at
         FROM ${JOURNAL_TABLE}
         ORDER BY hlc_wall_ms ASC, hlc_counter ASC, change_id ASC`,
      [],
    );
    if (rows.length === 0) return;
    this.#setStatus("syncing");
    let lastOutcome: PostOutcome = "ok";
    for (const row of rows) {
      const outcome = await this.#tryPost(rowToChange(row));
      lastOutcome = outcome;
      if (outcome === "ok") {
        await this.#engine.adapter.exec(`DELETE FROM ${JOURNAL_TABLE} WHERE change_id = ?`, [
          row.change_id,
        ]);
        this.#lastSyncId = row.change_id;
      } else {
        break;
      }
    }
    this.#setStatus(POST_OUTCOME_TO_STATUS[lastOutcome]);
  }

  /** Stop polling. Idempotent. */
  async stop(): Promise<void> {
    if (this.#pollHandle !== null) {
      clearInterval(this.#pollHandle);
      this.#pollHandle = null;
    }
    if (this.#unsubscribeLocal !== null) {
      this.#unsubscribeLocal();
      this.#unsubscribeLocal = null;
    }
  }

  /**
   * Read the persisted cursor from `_sync_state`. Called on `start()`;
   * a warm client (one that already has a cursor) skips the full-history
   * fetch and goes straight to incremental polling.
   */
  async #loadPersistedCursor(): Promise<void> {
    const rows = await this.#engine.adapter.exec<{ value: string }>(
      `SELECT value FROM ${SYNC_STATE_TABLE} WHERE key = ?`,
      [SYNC_STATE_KEYS.cursor],
    );
    const row = rows[0];
    if (row !== undefined) {
      this.#cursor = row.value;
      this.#cursorDirty = false;
    }
  }

  /** Upsert the current cursor into `_sync_state`. */
  async #persistCursor(): Promise<void> {
    if (this.#cursor === null) return;
    await this.#engine.adapter.exec(
      `INSERT INTO ${SYNC_STATE_TABLE} (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [SYNC_STATE_KEYS.cursor, this.#cursor, Date.now()],
    );
  }

  /**
   * Attempt a single POST.
   * - "ok": 2xx response
   * - "rejected": fetch returned a non-2xx (server reachable, request rejected)
   * - "offline": fetch threw (network down, DNS, CORS, etc.)
   */
  async #tryPost(change: WireChange): Promise<PostOutcome> {
    try {
      const headers = await this.#buildHeaders();
      const res = await this.#fetch(`${this.#serverUrl}/v1/changes`, {
        method: "POST",
        headers,
        body: JSON.stringify(change),
      });
      return res.ok ? "ok" : "rejected";
    } catch {
      return "offline";
    }
  }

  /** Build the headers for a request, merging in any auth headers option. */
  async #buildHeaders(): Promise<Record<string, string>> {
    const base: Record<string, string> = { "Content-Type": "application/json" };
    if (this.#authHeaders === undefined) return base;
    const extra =
      typeof this.#authHeaders === "function" ? await this.#authHeaders() : this.#authHeaders;
    return { ...base, ...extra };
  }

  /** Fetch newer changes from server and apply them locally. */
  async #poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      const url =
        this.#cursor === null
          ? `${this.#serverUrl}/v1/changes`
          : `${this.#serverUrl}/v1/changes?after=${this.#cursor}`;

      let changes: WireChange[];
      try {
        const headers = await this.#buildHeaders();
        const res = await this.#fetch(url, { headers });
        if (!res.ok) return;
        changes = (await res.json()) as WireChange[];
      } catch {
        return;
      }

      for (const change of changes) {
        // Own-write detection is now per-row, not per-change: column-level
        // LWW inside applyRemote rejects re-served own changes automatically
        // (the stored HLC is >= the remote HLC, the op is a no-op). No more
        // #initialHydrationDone flag — re-fetching the full server history
        // after a reload is idempotent at the row level.

        // Advance the engine's HLC past the remote so subsequent local sends
        // are causally later, then apply the ops. The change HLC is the
        // LWW comparator; column-level comparisons happen inside applyRemote.
        this.#engine.receiveHlc(change.hlc);
        const engineOps = change.ops.map(wireOpToEngine<S>);
        const opsForEngine = engineOps as unknown as Parameters<
          PalladiumEngine<S>["applyRemote"]
        >[1];
        try {
          await this.#engine.applyRemote(change.hlc, opsForEngine);
        } catch (err) {
          // The change failed to apply. Do NOT advance the cursor past it —
          // the next poll will retry. Surface the error to the engine's
          // 'error' event so subscribers can react.
          this.#engine.reportError(err);
          return;
        }
        // Cursor advances only after the change applied successfully.
        this.#cursor = hlcToAfterCursor(change.hlc);
        this.#cursorDirty = true;
      }

      // Persist the cursor (if it changed in this poll) so the next
      // transport.start() picks up where we left off instead of re-
      // fetching the full server history.
      if (this.#cursorDirty) {
        await this.#persistCursor();
        this.#cursorDirty = false;
      }
    } finally {
      this.#polling = false;
    }
  }
}
