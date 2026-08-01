/**
 * SyncTransport — HTTP-poll-based sync between a `PalladiumEngine` and a
 * `palladium-axum` server.
 *
 * Lifecycle
 * ─────────
 * `await transport.start()` creates a `_sync_pending_changes` outbox table if
 * missing, drains any pending rows left from a previous session, hydrates the
 * local store from the server (full `GET /v1/changes`), then schedules a
 * periodic poll that applies new remote changes via `engine.applyRemote()`.
 * While the transport is running, any local `engine.tx()` fires a
 * `"changes:local"` event; the transport writes the change to the outbox,
 * attempts a `POST /v1/changes`, and deletes the outbox row on success. Each
 * poll cycle also re-attempts any outbox rows that are still pending.
 *
 * `await transport.stop()` clears the poll timer and unsubscribes from the
 * engine event bus. The transport can be restarted (idempotently).
 *
 * Wire-format quirks
 * ──────────────────
 * The Rust server's `Op::Update` is single-column (`{col, value}`) while the
 * engine's update op carries a `patch: Partial<Row>` (potentially many
 * columns). One engine update with N patched columns becomes N wire ops.
 */

import type { PalladiumEngine, SyncStatus } from "./engine.js";
import type { Hlc } from "./hlc.js";
import type { SchemaMap } from "./tx.js";

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

export interface SyncTransportOptions {
  readonly serverUrl: string;
  /** Polling interval for the downlink. Default: 1000 ms. */
  readonly pollIntervalMs?: number;
  /** Override `fetch` for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * How many times a change may fail to apply before it is permanently
   * dead-lettered and the cursor advances past it (`D2a` terminal state).
   * Default: 5.
   */
  readonly maxApplyAttempts?: number;
}

// ── Outbox table ───────────────────────────────────────────────────────────

const OUTBOX_TABLE = "_sync_pending_changes";

/**
 * Idempotent DDL for the durable outbox. Creates the table only if missing,
 * so it's safe to run on every transport start without versioning.
 */
const OUTBOX_DDL = `CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (
  change_id TEXT PRIMARY KEY,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  ops TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

/**
 * Durable dead-letter table for remote changes that fail to apply (`D2a`,
 * G2). A row records the failing change, its retry count, and whether it has
 * been permanently skipped so the poll cursor can advance past it on recovery.
 */
const QUARANTINE_TABLE = "_sync_quarantine";

const QUARANTINE_DDL = `CREATE TABLE IF NOT EXISTS ${QUARANTINE_TABLE} (
  change_id TEXT PRIMARY KEY,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  ops TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  permanent INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL
)`;

interface QuarantineState {
  attempts: number;
  permanent: boolean;
}

/** `_sync_state` key under which the durable poll cursor is stored (`D2b`). */
const STATE_CURSOR = "cursor";

interface OutboxRow {
  change_id: string;
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
  /** JSON-encoded array of `WireOp`. */
  ops: string;
  created_at: number;
}

function rowToChange(row: OutboxRow): WireChange {
  return {
    id: row.change_id,
    hlc: { wallMs: row.hlc_wall_ms, counter: row.hlc_counter, nodeId: row.hlc_node_id },
    ops: JSON.parse(row.ops) as WireOp[],
  };
}

type PostOutcome = "ok" | "rejected" | "offline";

const POST_OUTCOME_TO_STATUS: Record<PostOutcome, SyncStatus> = {
  ok: "idle",
  rejected: "error",
  offline: "offline",
};

// ── Engine ↔ wire conversion ───────────────────────────────────────────────

interface EngineInsertOp {
  readonly type: "insert";
  readonly table: string;
  readonly data: Record<string, unknown> & { id: string };
}

interface EngineUpdateOp {
  readonly type: "update";
  readonly table: string;
  readonly id: string;
  readonly patch: Record<string, unknown>;
}

interface EngineDeleteOp {
  readonly type: "delete";
  readonly table: string;
  readonly id: string;
}

type EngineOp = EngineInsertOp | EngineUpdateOp | EngineDeleteOp;

/** Convert one engine `Op` into one or more wire `Op`s. */
function engineOpToWire(op: EngineOp): WireOp[] {
  if (op.type === "insert") {
    return [
      {
        op: "insert",
        table: String(op.table),
        row_id: op.data.id,
        data: op.data,
      },
    ];
  }
  if (op.type === "update") {
    // Engine patch is multi-column; wire is single-column per Op.
    const entries = Object.entries(op.patch);
    return entries.map<UpdateWireOp>(([col, value]) => ({
      op: "update",
      table: String(op.table),
      row_id: op.id,
      col,
      value,
    }));
  }
  return [{ op: "delete", table: String(op.table), row_id: op.id }];
}

/** Convert one wire `Op` into the engine `Op` shape that `applyRemote` accepts. */
function wireOpToEngine<S extends SchemaMap>(op: WireOp): EngineOp & { table: keyof S & string } {
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

// ── Transport ──────────────────────────────────────────────────────────────

export class SyncTransport<S extends SchemaMap> {
  readonly #engine: PalladiumEngine<S>;
  readonly #serverUrl: string;
  readonly #pollIntervalMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxApplyAttempts: number;

  #cursor: string | null = null;
  #pollHandle: ReturnType<typeof setInterval> | null = null;
  #polling = false;
  #initialHydrationDone = false;
  #unsubscribeLocal: (() => void) | null = null;

  constructor(engine: PalladiumEngine<S>, options: SyncTransportOptions) {
    this.#engine = engine;
    this.#serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxApplyAttempts = Math.max(1, options.maxApplyAttempts ?? 5);
  }

  /**
   * Provision the outbox + quarantine tables, drain any pending rows from
   * previous sessions, hydrate from server, then start polling. Idempotent.
   */
  async start(): Promise<void> {
    if (this.#pollHandle !== null) return;
    await this.#engine.adapter.exec(OUTBOX_DDL, []);
    await this.#engine.adapter.exec(QUARANTINE_DDL, []);
    // Resume from the durably-persisted poll cursor (`D2b`): a prior session
    // already hydrated, so skip the full re-hydration and skip own writes.
    const savedCursor = await this.#engine.getSyncState(STATE_CURSOR);
    if (savedCursor !== null) {
      this.#cursor = savedCursor;
      this.#initialHydrationDone = true;
    }
    await this.#drainOutbox();
    this.#unsubscribeLocal = this.#engine.on("changes:local", (payload) => {
      void this.#postLocal({
        ops: payload.ops as ReadonlyArray<EngineOp>,
        hlc: payload.hlc,
        changeId: payload.changeId,
      });
    });
    await this.#poll();
    this.#pollHandle = setInterval(() => {
      void this.#tick();
    }, this.#pollIntervalMs);
  }

  /** One periodic step: drain the outbox, then poll. */
  async #tick(): Promise<void> {
    await this.#drainOutbox();
    await this.#poll();
  }

  /** Re-attempt every row currently in `_sync_pending_changes`, oldest first. */
  async #drainOutbox(): Promise<void> {
    const rows = await this.#engine.adapter.exec<OutboxRow>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at
         FROM ${OUTBOX_TABLE}
         ORDER BY hlc_wall_ms ASC, hlc_counter ASC, change_id ASC`,
      [],
    );
    if (rows.length === 0) return;
    this.#engine.setStatus("syncing");
    let lastOutcome: PostOutcome = "ok";
    for (const row of rows) {
      const outcome = await this.#tryPost(rowToChange(row));
      lastOutcome = outcome;
      if (outcome === "ok") {
        await this.#engine.adapter.exec(`DELETE FROM ${OUTBOX_TABLE} WHERE change_id = ?`, [
          row.change_id,
        ]);
      } else {
        // Stop after first failure — preserves ordering and avoids hammering
        // a server that's clearly not accepting writes right now.
        break;
      }
    }
    this.#engine.setStatus(POST_OUTCOME_TO_STATUS[lastOutcome]);
  }

  /** Stop polling and unsubscribe from engine events. Idempotent. */
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
   * Persist + post one batched Change. The change is written to
   * `_sync_pending_changes` first so it survives a reload if the POST fails
   * or the page is closed mid-flight; the outbox row is deleted on success.
   */
  async #postLocal(local: {
    ops: ReadonlyArray<EngineOp>;
    hlc: Hlc;
    changeId: string;
  }): Promise<void> {
    const wireOps = local.ops.flatMap(engineOpToWire);
    if (wireOps.length === 0) return;
    // The engine already minted the HLC + change id inside tx() and stamped
    // `_sync_row_meta`; reuse them so the outbox row and the shadow-table
    // metadata agree (a fresh HLC here would break column-LWW comparisons).
    const change: WireChange = {
      id: local.changeId,
      hlc: local.hlc,
      ops: wireOps,
    };

    // Durable outbox first, then attempt the post. Order matters: a crash
    // between INSERT and fetch leaves the row in place, ready for retry on
    // next start().
    await this.#engine.adapter.exec(
      `INSERT INTO ${OUTBOX_TABLE} (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        change.id,
        change.hlc.wallMs,
        change.hlc.counter,
        change.hlc.nodeId,
        JSON.stringify(change.ops),
        Date.now(),
      ],
    );

    this.#engine.setStatus("syncing");
    const outcome = await this.#tryPost(change);
    if (outcome === "ok") {
      await this.#engine.adapter.exec(`DELETE FROM ${OUTBOX_TABLE} WHERE change_id = ?`, [
        change.id,
      ]);
    }
    this.#engine.setStatus(POST_OUTCOME_TO_STATUS[outcome]);
  }

  /**
   * Attempt a single POST.
   * - "ok": 2xx response
   * - "rejected": fetch returned a non-2xx (server reachable, request rejected)
   * - "offline": fetch threw (network down, DNS, CORS, etc.)
   */
  async #tryPost(change: WireChange): Promise<PostOutcome> {
    try {
      const res = await this.#fetch(`${this.#serverUrl}/v1/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      return res.ok ? "ok" : "rejected";
    } catch {
      return "offline";
    }
  }

  /**
   * Perform one downlink poll: fetch changes newer than the cursor and apply
   * them. Public so callers (and tests) can drive a deterministic single sync
   * step; the periodic timer calls the same path.
   */
  async poll(): Promise<void> {
    return this.#poll();
  }

  /** Fetch newer changes from server and apply them locally (non-poisoning). */
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
        const res = await this.#fetch(url);
        if (!res.ok) return;
        changes = (await res.json()) as WireChange[];
      } catch {
        return;
      }

      for (const change of changes) {
        // Stop advancing the cursor at the first change that isn't durably
        // resolved this poll, so a transient failure is retried rather than
        // skipped. `#applyOneRemote` returns false only for such a change.
        const advanced = await this.#applyOneRemote(change);
        if (!advanced) break;
        this.#cursor = hlcToAfterCursor(change.hlc);
        // Persist the cursor so a restart resumes here. Not in the same
        // transaction as the apply, but idempotent apply (1b) makes the small
        // reapply window on crash harmless.
        await this.#engine.setSyncState(STATE_CURSOR, this.#cursor);
      }

      this.#initialHydrationDone = true;
    } finally {
      this.#polling = false;
    }
  }

  /**
   * Apply one polled change with non-poisoning semantics (`D2a`, G2). Returns
   * `true` when the cursor may advance past this change — it was applied, is
   * our own already-applied write, or has been permanently dead-lettered —
   * and `false` when the change failed transiently and should be retried
   * (so the cursor must not move past it yet).
   */
  async #applyOneRemote(change: WireChange): Promise<boolean> {
    // After initial hydration, skip own writes — we already applied them.
    if (this.#initialHydrationDone && change.hlc.nodeId === this.#engine.nodeId) {
      return true;
    }

    const quarantine = await this.#quarantineState(change.id);
    // Already permanently dead-lettered: skip past it (terminal state, L71).
    if (quarantine?.permanent) return true;

    // The cast is structural: wireOpToEngine emits the same {type, table, id,
    // data?, patch?} shape Op<S> declares, but TS can't see through the generic
    // to verify. Runtime values are validated inside applyRemote.
    const remoteChange = {
      hlc: change.hlc,
      id: change.id,
      ops: change.ops.map(wireOpToEngine<S>),
    } as unknown as Parameters<PalladiumEngine<S>["applyRemote"]>[0];

    try {
      await this.#engine.applyRemote(remoteChange);
      if (quarantine !== null) await this.#clearQuarantine(change.id); // recovered
      return true;
    } catch (err) {
      const attempts = await this.#recordFailure(change, err);
      if (attempts >= this.#maxApplyAttempts) {
        // Exhausted retries: permanently skip so the cursor is never wedged.
        await this.#markPermanent(change.id);
        this.#engine.setStatus("error");
        return true;
      }
      // Transient: leave the cursor here and retry on the next poll.
      return false;
    }
  }

  /** Read the quarantine state for a change, or `null` if not quarantined. */
  async #quarantineState(changeId: string): Promise<QuarantineState | null> {
    const rows = await this.#engine.adapter.exec<{ attempts: number; permanent: number }>(
      `SELECT attempts, permanent FROM ${QUARANTINE_TABLE} WHERE change_id = ?`,
      [changeId],
    );
    const row = rows[0];
    return row ? { attempts: row.attempts, permanent: row.permanent !== 0 } : null;
  }

  /** Record (or increment) a failed apply; returns the new attempt count. */
  async #recordFailure(change: WireChange, err: unknown): Promise<number> {
    const message = err instanceof Error ? err.message : String(err);
    await this.#engine.adapter.exec(
      `INSERT INTO ${QUARANTINE_TABLE}
         (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, attempts, permanent, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
       ON CONFLICT (change_id) DO UPDATE SET
         attempts = attempts + 1,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [
        change.id,
        change.hlc.wallMs,
        change.hlc.counter,
        change.hlc.nodeId,
        JSON.stringify(change.ops),
        message,
        Date.now(),
      ],
    );
    const state = await this.#quarantineState(change.id);
    return state?.attempts ?? 1;
  }

  async #markPermanent(changeId: string): Promise<void> {
    await this.#engine.adapter.exec(
      `UPDATE ${QUARANTINE_TABLE} SET permanent = 1, updated_at = ? WHERE change_id = ?`,
      [Date.now(), changeId],
    );
  }

  async #clearQuarantine(changeId: string): Promise<void> {
    await this.#engine.adapter.exec(`DELETE FROM ${QUARANTINE_TABLE} WHERE change_id = ?`, [
      changeId,
    ]);
  }
}
