/**
 * PalladiumEngine — concrete sync engine base class.
 *
 * Provides the high-level API (tx, insert, update, delete, liveQuery, on)
 * on top of a StorageAdapter. Subclasses may override the protected
 * _putRow / _patchRow / _removeRow hooks to intercept writes (e.g. to
 * replicate changes to a remote server).
 */

import type { BlobAdapter } from "./blob-adapter.js";
import { BlobHandle } from "./blob-handle.js";
import { BlobRegistry } from "./blob-registry.js";
import { EventEmitter } from "./event-emitter.js";
import type { Hlc } from "./hlc.js";
import { compareHlc, createHlc, hlcFromString, hlcToString, recvHlc, sendHlc } from "./hlc.js";
import { LiveQuery } from "./live-query.js";
import { MemoryBlobAdapter } from "./memory-blob-adapter.js";
import type { SchemaConfig } from "./migration.js";
import { applySchema } from "./migration.js";
import type { SqlQuery } from "./sql.js";
import type { StorageAdapter } from "./storage.js";
import { isTransactable } from "./storage.js";
import type { Op, SchemaMap } from "./tx.js";
import { TxBuilder } from "./tx.js";

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export interface ChangesLocal<S extends SchemaMap = SchemaMap> {
  /** The ops as they came out of the `tx()` builder, in order. */
  readonly ops: ReadonlyArray<Op<S>>;
  /** Lowercased table names touched by `ops`, deduped. */
  readonly touchedTables: ReadonlyArray<string>;
  /**
   * The single HLC stamped on this change. Every column written by `ops`
   * carries this HLC in `_sync_row_meta`; the sync transport propagates it so
   * remote peers can LWW-reconcile against it. One change = one HLC (`D2a`).
   */
  readonly hlc: Hlc;
  /** Stable id for this change — the sync transport's idempotency key. */
  readonly changeId: string;
}

/**
 * A change received from a remote peer, applied via {@link PalladiumEngine.applyRemote}.
 * Carries the originating {@link Hlc} so the engine can column-LWW-reconcile
 * (`D3`); `id` is the idempotency key (a re-delivered change is a no-op).
 */
export interface RemoteChange<S extends SchemaMap = SchemaMap> {
  readonly hlc: Hlc;
  readonly ops: ReadonlyArray<Op<S>>;
  readonly id?: string;
}

export interface EngineEvents<S extends SchemaMap = SchemaMap> {
  "sync:status": SyncStatus;
  error: Error;
  /**
   * Fired after a local `tx()` commits successfully. Suppressed while the
   * engine is applying remote ops via `applyRemote()`. Subscribers (sync
   * transport, audit logs, etc.) get the full batch with the original engine
   * `Op` shape — wire-format conversion is the subscriber's job.
   */
  "changes:local": ChangesLocal<S>;
}

export interface PalladiumEngineOptions {
  readonly blobAdapter?: BlobAdapter;
  /**
   * Stable node identifier for HLC stamping. Defaults to a fresh `crypto.randomUUID()`.
   *
   * Apps that need their HLCs to survive reloads should persist this string
   * (localStorage, SQLite, etc.) and pass it on every engine construction.
   */
  readonly nodeId?: string;
}

// ── Column-LWW shadow table (`_sync_row_meta`, D3/G8) ────────────────────────

/** Per-`(table, row, column)` write-HLC shadow table backing column-level LWW. */
const SYNC_ROW_META = "_sync_row_meta";

/**
 * Reserved `col` value marking a row-level delete tombstone (`D4`). The
 * `__palladium_` prefix keeps it clear of any real SQL column name while
 * staying plain ASCII (a NUL/control sentinel would make the source binary).
 */
const DELETED_COL = "__palladium_deleted__";

const SYNC_ROW_META_DDL = `CREATE TABLE IF NOT EXISTS ${SYNC_ROW_META} (
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  col TEXT NOT NULL,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  PRIMARY KEY (tbl, row_id, col)
)`;

interface MetaRow {
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
}

function metaRowToHlc(row: MetaRow): Hlc {
  return { wallMs: row.hlc_wall_ms, counter: row.hlc_counter, nodeId: row.hlc_node_id };
}

// ── Durable sync state (`_sync_state`, D2b) ──────────────────────────────────

/** Key-value table holding the durable `nodeId`, engine HLC, and poll cursor. */
const SYNC_STATE = "_sync_state";

const SYNC_STATE_DDL = `CREATE TABLE IF NOT EXISTS ${SYNC_STATE} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

const STATE_NODE_ID = "node_id";
const STATE_HLC = "hlc";

export class PalladiumEngine<S extends SchemaMap> {
  readonly adapter: StorageAdapter;
  #nodeId: string;
  protected readonly emitter = new EventEmitter<EngineEvents<S>>();
  protected status: SyncStatus = "idle";
  readonly #liveQueries = new Set<LiveQuery>();
  readonly #blobRegistry = new BlobRegistry();
  /** High-level blob storage API. */
  readonly blobs: BlobHandle;

  /**
   * Stable per-device HLC node id. Defaults to the constructor value but is
   * adopted from durable `_sync_state` on `init()` if a prior session persisted
   * one (`D2b`) — so it survives leader-worker failover instead of churning.
   */
  get nodeId(): string {
    return this.#nodeId;
  }

  /**
   * Current HLC. Loaded from durable `_sync_state` on `init()` and persisted
   * within each `tx()` / `applyRemote()` transaction (`D2b` atomic checkpoint),
   * so a restart resumes from the persisted floor and never reissues an HLC.
   */
  #currentHlc: Hlc | null = null;

  constructor(adapter: StorageAdapter, options?: PalladiumEngineOptions | BlobAdapter) {
    this.adapter = adapter;
    // Back-compat shim: previous signature was (adapter, blobAdapter?). Detect
    // a bare BlobAdapter by the absence of nodeId/blobAdapter keys.
    const opts: PalladiumEngineOptions =
      options && "get" in options && typeof options.get === "function"
        ? { blobAdapter: options as BlobAdapter }
        : ((options as PalladiumEngineOptions | undefined) ?? {});
    this.#nodeId = opts.nodeId ?? crypto.randomUUID();
    this.blobs = new BlobHandle(opts.blobAdapter ?? new MemoryBlobAdapter(), this.#blobRegistry);
  }

  /**
   * Advance the engine's HLC for a *send* (local mutation about to be
   * propagated to the server). Counter increments on same-millisecond bursts;
   * `wallMs` advances when the OS clock ticks. The returned HLC is strictly
   * greater than any HLC this engine has issued or received.
   */
  nextSendHlc(): Hlc {
    this.#currentHlc =
      this.#currentHlc === null ? createHlc(this.nodeId) : sendHlc(this.#currentHlc);
    return this.#currentHlc;
  }

  /**
   * Advance the engine's HLC after *receiving* a remote HLC. Preserves the
   * causality invariant that future local sends will be strictly greater than
   * any HLC observed (local or remote).
   */
  receiveHlc(remote: Hlc): void {
    this.#currentHlc =
      this.#currentHlc === null
        ? recvHlc(createHlc(this.nodeId), remote)
        : recvHlc(this.#currentHlc, remote);
  }

  /** Most-recently-issued HLC, or `null` if the engine has not yet stamped anything. */
  get currentHlc(): Hlc | null {
    return this.#currentHlc;
  }

  /**
   * Open the adapter and optionally apply versioned migrations and seeds.
   *
   * Without a schema config, just opens the adapter.
   * With a schema config, also runs baseline DDL, versioned migrations,
   * and seeds via `applySchema()`.
   */
  async init(schema?: SchemaConfig): Promise<void> {
    await this.adapter.open();
    await this.#ensureSyncTables(this.adapter);
    await this.#loadDurableState();
    if (schema) {
      await applySchema(this.adapter, schema);
    }
  }

  /**
   * Adopt the durable `nodeId` and engine HLC from `_sync_state` (`D2b`). A
   * prior session's `nodeId` wins over the constructor default so device
   * identity survives failover; a persisted HLC seeds `#currentHlc` so the next
   * `nextSendHlc()` is strictly greater than anything issued before the restart
   * (no HLC reuse). On a fresh store the current `nodeId` is persisted.
   */
  async #loadDurableState(): Promise<void> {
    const persistedNode = await this.getSyncState(STATE_NODE_ID);
    if (persistedNode === null) {
      await this.setSyncState(STATE_NODE_ID, this.#nodeId);
    } else {
      this.#nodeId = persistedNode;
    }
    const persistedHlc = await this.getSyncState(STATE_HLC);
    if (persistedHlc !== null) {
      this.#currentHlc = hlcFromString(persistedHlc);
    }
  }

  /** Suppresses `"changes:local"` while remote ops are being applied. */
  #suppressLocalEmit = false;

  /** Guards one-time DDL of the internal `_sync_*` shadow tables. */
  #syncTablesReady = false;

  /** Idempotently create the column-LWW + durable-state shadow tables (`D3`/`D2b`). */
  async #ensureSyncTables(adpt: StorageAdapter): Promise<void> {
    if (this.#syncTablesReady) return;
    await adpt.exec(SYNC_ROW_META_DDL, []);
    await adpt.exec(SYNC_STATE_DDL, []);
    this.#syncTablesReady = true;
  }

  /**
   * Read a durable sync-state value (`_sync_state`), or `null` if unset. Used
   * by the engine (nodeId/HLC) and the sync transport (poll cursor) — keeping
   * `_sync_state` access adapter-neutral inside core (`D2c`, no SQLite in the
   * transport).
   */
  async getSyncState(key: string): Promise<string | null> {
    await this.#ensureSyncTables(this.adapter);
    const rows = await this.adapter.exec<{ value: string }>(
      `SELECT value FROM ${SYNC_STATE} WHERE key = ?`,
      [key],
    );
    return rows[0]?.value ?? null;
  }

  /**
   * Upsert a durable sync-state value. `adpt` defaults to the engine adapter
   * but a transaction-scoped adapter may be passed so the write commits
   * atomically with the operation it records (`D2b` atomic checkpoint).
   */
  async setSyncState(
    key: string,
    value: string,
    adpt: StorageAdapter = this.adapter,
  ): Promise<void> {
    await this.#ensureSyncTables(adpt);
    await adpt.exec(
      `INSERT INTO ${SYNC_STATE} (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  /**
   * Execute a batch of local mutations, wrapped in a transaction when
   * supported. The whole batch is stamped with a single HLC (`D2a`), and every
   * written `(table, row, column)` records that HLC in `_sync_row_meta` so a
   * later remote change can column-LWW-reconcile against it (`D3`). Local
   * writes always win locally (their HLC is freshly minted, hence latest), so
   * no gating is applied on this path.
   */
  async tx(callback: (t: TxBuilder<S>) => void): Promise<void> {
    const builder = new TxBuilder<S>();
    const maybePromise: unknown = callback(builder);
    if (maybePromise instanceof Promise) {
      throw new TypeError(
        "tx() callback must be synchronous. Received a Promise — did you accidentally use an async function?",
      );
    }
    const ops = builder.build();
    const touchedTables = new Set<string>();
    // One HLC per change (only minted when there is something to stamp).
    const hlc = ops.length > 0 ? this.nextSendHlc() : null;
    const changeId = crypto.randomUUID();

    const applyAll = async (adpt: StorageAdapter): Promise<void> => {
      await this.#ensureSyncTables(adpt);
      for (const op of ops) {
        // Lowercase to match extractTables(), which normalises SQL identifiers.
        touchedTables.add(String(op.table).toLowerCase());
        await this.#applyOp(adpt, op);
        if (hlc !== null) await this.#stampLocalMeta(adpt, op, hlc);
      }
      // Checkpoint the advanced HLC in the same transaction as the writes it
      // stamped (`D2b`), so recovery never reissues an HLC.
      if (hlc !== null) await this.setSyncState(STATE_HLC, hlcToString(hlc), adpt);
    };

    if (isTransactable(this.adapter)) {
      await this.adapter.transaction(applyAll);
    } else {
      await applyAll(this.adapter);
    }

    await this.#notifyLiveQueries([...touchedTables]);

    if (!this.#suppressLocalEmit && hlc !== null) {
      this.emitter.emit("changes:local", {
        ops,
        touchedTables: [...touchedTables],
        hlc,
        changeId,
      });
    }
  }

  /**
   * Apply a change received from a remote peer, column-LWW-reconciled by HLC
   * (`D3`, fixes F1). Unlike `tx()` this does **not** mint a local HLC — every
   * write is stamped with the change's own `hlc` and gated per column: a remote
   * column is accepted iff its HLC is strictly greater than the stored write
   * HLC (`compareHlc` tie-breaks on `nodeId`), so the higher-HLC write wins
   * regardless of arrival order and the apply is idempotent + commutative.
   * Deletes leave a durable tombstone (`D4`). Live queries refresh, but
   * `"changes:local"` is suppressed so the transport doesn't re-emit a change
   * it just downloaded.
   */
  async applyRemote(change: RemoteChange<S>): Promise<void> {
    const { hlc, ops } = change;
    if (ops.length === 0) return;
    // Keep the local clock causally ahead of anything we've observed.
    this.receiveHlc(hlc);

    const touchedTables = new Set<string>();
    const applyAll = async (adpt: StorageAdapter): Promise<void> => {
      await this.#ensureSyncTables(adpt);
      for (const op of ops) {
        touchedTables.add(String(op.table).toLowerCase());
        await this.#applyRemoteOp(adpt, op, hlc);
      }
      // Checkpoint the receive-advanced HLC atomically with the apply (`D2b`).
      if (this.#currentHlc !== null) {
        await this.setSyncState(STATE_HLC, hlcToString(this.#currentHlc), adpt);
      }
    };

    this.#suppressLocalEmit = true;
    try {
      if (isTransactable(this.adapter)) {
        await this.adapter.transaction(applyAll);
      } else {
        await applyAll(this.adapter);
      }
    } finally {
      this.#suppressLocalEmit = false;
    }

    await this.#notifyLiveQueries([...touchedTables]);
  }

  /** Shorthand for single-row insert. */
  async insert<K extends keyof S & string>(table: K, data: S[K]): Promise<void> {
    return this.tx((t) => {
      t.insert(table, data);
    });
  }

  /** Shorthand for single-row update. */
  async update<K extends keyof S & string>(
    table: K,
    id: string,
    patch: Partial<S[K]>,
  ): Promise<void> {
    return this.tx((t) => {
      t.update(table, id, patch);
    });
  }

  /** Shorthand for single-row delete. */
  async delete<K extends keyof S & string>(table: K, id: string): Promise<void> {
    return this.tx((t) => {
      t.delete(table, id);
    });
  }

  /** Execute a raw SQL query. */
  async exec<T = Record<string, unknown>>(query: SqlQuery): Promise<T[]> {
    return this.adapter.exec<T>(query.text, query.params);
  }

  /**
   * Create a reactive live query. Automatically deregisters on cancel().
   * @deprecated LiveQuery runs on the same thread as the engine. In worker-based
   * architectures (OPFS / SharedArrayBuffer), use framework composables or a
   * message-bus subscription instead.
   */
  liveQuery<T = Record<string, unknown>>(query: SqlQuery): LiveQuery<T> {
    const lq = new LiveQuery<T>(query, this.adapter, () => {
      // Stryker disable next-line all -- removing delete is observably equivalent: cancelled lq returns early from notifyTables
      this.#liveQueries.delete(lq as LiveQuery);
    });
    this.#liveQueries.add(lq as LiveQuery);
    return lq;
  }

  /** Subscribe to engine events. */
  on<K extends keyof EngineEvents<S>>(
    event: K,
    listener: (payload: EngineEvents<S>[K]) => void,
  ): () => void {
    // Cast through unknown to bridge the Listener<T> conditional type.
    return this.emitter.on(event, listener as unknown as Parameters<typeof this.emitter.on<K>>[1]);
  }

  /** Poll the current sync status. */
  getSyncStatus(): SyncStatus {
    return this.status;
  }

  /** Update the sync status and emit a `sync:status` event. */
  setStatus(s: SyncStatus): void {
    this.status = s;
    this.emitter.emit("sync:status", s);
  }

  async #applyOp(adpt: StorageAdapter, op: Op<S>): Promise<void> {
    const table = String(op.table);
    if (op.type === "insert") {
      await this._putRow(
        adpt,
        table,
        (op.data as unknown as { id: string }).id,
        op.data as Record<string, unknown>,
      );
    } else if (op.type === "update") {
      await this._patchRow(adpt, table, op.id, op.patch as Record<string, unknown>);
    } else {
      await this._removeRow(adpt, table, op.id);
    }
  }

  /** Override to intercept or augment storage writes (e.g. server replication). */
  protected async _putRow(
    adpt: StorageAdapter,
    table: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await adpt.put(table, id, data);
  }

  protected async _patchRow(
    adpt: StorageAdapter,
    table: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await adpt.patch(table, id, patch);
  }

  protected async _removeRow(adpt: StorageAdapter, table: string, id: string): Promise<void> {
    await adpt.remove(table, id);
  }

  async #notifyLiveQueries(tables: string[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const lq of this.#liveQueries) {
      promises.push(lq.notifyTables(tables));
    }
    await Promise.all(promises);
  }

  // ── Column-LWW shadow-table helpers (`_sync_row_meta`, D3/D4) ──────────────

  /** Read the stored write HLC for one `(table, row, column)`, or `null`. */
  async #getColMeta(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    col: string,
  ): Promise<Hlc | null> {
    const rows = await adpt.exec<MetaRow>(
      `SELECT hlc_wall_ms, hlc_counter, hlc_node_id FROM ${SYNC_ROW_META}
         WHERE tbl = ? AND row_id = ? AND col = ?`,
      [table, rowId, col],
    );
    return rows[0] ? metaRowToHlc(rows[0]) : null;
  }

  /** Highest write HLC across all *data* columns of a row (excludes the tombstone). */
  async #maxColMeta(adpt: StorageAdapter, table: string, rowId: string): Promise<Hlc | null> {
    const rows = await adpt.exec<MetaRow>(
      `SELECT hlc_wall_ms, hlc_counter, hlc_node_id FROM ${SYNC_ROW_META}
         WHERE tbl = ? AND row_id = ? AND col != ?`,
      [table, rowId, DELETED_COL],
    );
    let max: Hlc | null = null;
    for (const r of rows) {
      const h = metaRowToHlc(r);
      if (max === null || compareHlc(h, max) > 0) max = h;
    }
    return max;
  }

  /** Upsert the write HLC for one `(table, row, column)`. */
  async #putColMeta(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    col: string,
    hlc: Hlc,
  ): Promise<void> {
    await adpt.exec(
      `INSERT INTO ${SYNC_ROW_META} (tbl, row_id, col, hlc_wall_ms, hlc_counter, hlc_node_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (tbl, row_id, col) DO UPDATE SET
           hlc_wall_ms = excluded.hlc_wall_ms,
           hlc_counter = excluded.hlc_counter,
           hlc_node_id = excluded.hlc_node_id`,
      [table, rowId, col, hlc.wallMs, hlc.counter, hlc.nodeId],
    );
  }

  /** Drop the delete tombstone for a row (on resurrection). */
  async #clearTombstone(adpt: StorageAdapter, table: string, rowId: string): Promise<void> {
    await adpt.exec(`DELETE FROM ${SYNC_ROW_META} WHERE tbl = ? AND row_id = ? AND col = ?`, [
      table,
      rowId,
      DELETED_COL,
    ]);
  }

  /** Stamp a set of columns of one row with the same write HLC. */
  async #stampCols(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    cols: Iterable<string>,
    hlc: Hlc,
  ): Promise<void> {
    for (const col of cols) {
      await this.#putColMeta(adpt, table, rowId, col, hlc);
    }
  }

  /** Stamp every column a *local* op writes with the change's HLC (no gating). */
  async #stampLocalMeta(adpt: StorageAdapter, op: Op<S>, hlc: Hlc): Promise<void> {
    const table = String(op.table);
    if (op.type === "insert") {
      const data = op.data as unknown as Record<string, unknown> & { id: string };
      await this.#clearTombstone(adpt, table, data.id);
      await this.#stampCols(adpt, table, data.id, Object.keys(data), hlc);
    } else if (op.type === "update") {
      await this.#stampCols(
        adpt,
        table,
        op.id,
        Object.keys(op.patch as Record<string, unknown>),
        hlc,
      );
    } else {
      await this.#putColMeta(adpt, table, op.id, DELETED_COL, hlc);
    }
  }

  /**
   * Column-LWW filter: keep only the `fields` whose incoming `hlc` strictly
   * beats the stored per-column write HLC (`compareHlc` tie-breaks on `nodeId`).
   */
  async #winningCols(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    fields: Record<string, unknown>,
    hlc: Hlc,
  ): Promise<Record<string, unknown>> {
    const winning: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(fields)) {
      const stored = await this.#getColMeta(adpt, table, rowId, col);
      if (stored === null || compareHlc(hlc, stored) > 0) winning[col] = value;
    }
    return winning;
  }

  /**
   * Apply one remote op with column-level LWW gating against `_sync_row_meta`.
   * A column is written only when the incoming `hlc` strictly beats the stored
   * write HLC; deletes reconcile against the row's newest column write and
   * leave a durable tombstone.
   */
  async #applyRemoteOp(adpt: StorageAdapter, op: Op<S>, hlc: Hlc): Promise<void> {
    const table = String(op.table);
    if (op.type === "insert") {
      await this.#applyRemoteInsert(adpt, table, op, hlc);
    } else if (op.type === "update") {
      await this.#applyRemoteUpdate(adpt, table, op, hlc);
    } else {
      await this.#applyRemoteDelete(adpt, table, op.id, hlc);
    }
  }

  async #applyRemoteInsert(
    adpt: StorageAdapter,
    table: string,
    op: Extract<Op<S>, { type: "insert" }>,
    hlc: Hlc,
  ): Promise<void> {
    const data = op.data as unknown as Record<string, unknown> & { id: string };
    const tombstone = await this.#getColMeta(adpt, table, data.id, DELETED_COL);
    if (tombstone !== null && compareHlc(hlc, tombstone) <= 0) return; // delete wins
    const winning = await this.#winningCols(adpt, table, data.id, data, hlc);
    if (Object.keys(winning).length === 0) return;

    if (tombstone !== null) {
      // Resurrection (hlc > tombstone): re-create the full row.
      await this.#clearTombstone(adpt, table, data.id);
      await this._putRow(adpt, table, data.id, data);
      await this.#stampCols(adpt, table, data.id, Object.keys(data), hlc);
      return;
    }
    const existing = await adpt.exec(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`, [data.id]);
    if (existing.length === 0) {
      // Brand-new row: insert the full payload so NOT NULL columns are set.
      await this._putRow(adpt, table, data.id, data);
      await this.#stampCols(adpt, table, data.id, Object.keys(data), hlc);
    } else {
      // Conflicting insert on an existing row: LWW the winning columns only.
      await this._patchRow(adpt, table, data.id, winning);
      await this.#stampCols(adpt, table, data.id, Object.keys(winning), hlc);
    }
  }

  async #applyRemoteUpdate(
    adpt: StorageAdapter,
    table: string,
    op: Extract<Op<S>, { type: "update" }>,
    hlc: Hlc,
  ): Promise<void> {
    const tombstone = await this.#getColMeta(adpt, table, op.id, DELETED_COL);
    if (tombstone !== null && compareHlc(hlc, tombstone) <= 0) return; // delete wins
    const winning = await this.#winningCols(
      adpt,
      table,
      op.id,
      op.patch as Record<string, unknown>,
      hlc,
    );
    if (Object.keys(winning).length === 0) return;
    if (tombstone !== null) await this.#clearTombstone(adpt, table, op.id); // un-delete
    await this._patchRow(adpt, table, op.id, winning);
    await this.#stampCols(adpt, table, op.id, Object.keys(winning), hlc);
  }

  async #applyRemoteDelete(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    hlc: Hlc,
  ): Promise<void> {
    // Reconcile against the row's newest data-column write.
    const maxCol = await this.#maxColMeta(adpt, table, rowId);
    if (maxCol !== null && compareHlc(hlc, maxCol) < 0) return; // a newer update wins
    await this._removeRow(adpt, table, rowId);
    await this.#putColMeta(adpt, table, rowId, DELETED_COL, hlc);
  }
}

/** Factory — create a `PalladiumEngine` with the given adapter and options. */
export function createEngine<S extends SchemaMap>(
  adapter: StorageAdapter,
  options?: PalladiumEngineOptions | BlobAdapter,
): PalladiumEngine<S> {
  return new PalladiumEngine<S>(adapter, options);
}

/** Coerces an unknown thrown value to an `Error` instance. */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
