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
import { createHlc, recvHlc, sendHlc } from "./hlc.js";
import { engineOpToJournalOp, JOURNAL_DDL, JOURNAL_TABLE, type JournalOp } from "./journal.js";
import { LiveQuery } from "./live-query.js";
import { MemoryBlobAdapter } from "./memory-blob-adapter.js";
import type { SchemaConfig } from "./migration.js";
import { applySchema } from "./migration.js";
import { compareHlcLocal, ROW_VERSIONS_DDL, ROW_VERSIONS_TABLE } from "./row-versions.js";
import type { SqlQuery } from "./sql.js";
import type { StorageAdapter } from "./storage.js";
import { isTransactable } from "./storage.js";
import { SYNC_STATE_DDL, SYNC_STATE_KEYS, SYNC_STATE_TABLE } from "./sync-state.js";
import type { Op, SchemaMap } from "./tx.js";
import { TxBuilder } from "./tx.js";

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export interface ChangesLocal<S extends SchemaMap = SchemaMap> {
  /** The ops as they came out of the `tx()` builder, in order. */
  readonly ops: ReadonlyArray<Op<S>>;
  /** Lowercased table names touched by `ops`, deduped. */
  readonly touchedTables: ReadonlyArray<string>;
}

export interface EngineEvents<S extends SchemaMap = SchemaMap> {
  "sync:status": SyncStatus;
  error: Error;
  /**
   * Fired after a local `tx()` commits successfully. Subscribers (sync
   * transport, audit logs, etc.) get the full batch with the original
   * engine `Op` shape — wire-format conversion is the subscriber's job.
   *
   * `applyRemote()` deliberately does NOT emit this event; a remote change
   * is not a local change and should not trigger uplink. The journal is
   * the single source of truth for "things to upload"; remote writes are
   * not journaled.
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

export class PalladiumEngine<S extends SchemaMap> {
  readonly adapter: StorageAdapter;
  readonly nodeId: string;
  protected readonly emitter = new EventEmitter<EngineEvents<S>>();
  readonly #liveQueries = new Set<LiveQuery>();
  readonly #blobRegistry = new BlobRegistry();
  /** High-level blob storage API. */
  readonly blobs: BlobHandle;

  /**
   * Current HLC, lazily initialised on first send/receive. Tracked in-memory only —
   * if the engine restarts and the wall clock has gone backwards, the next HLC
   * may not be strictly greater than ones we issued before the restart. A
   * follow-up commit will persist this to SQLite.
   */
  #currentHlc: Hlc | null = null;
  #initialized = false;

  constructor(adapter: StorageAdapter, options: PalladiumEngineOptions = {}) {
    this.adapter = adapter;
    // nodeId is assigned here only when the caller gave us one. Otherwise
    // it remains empty and init() (#rehydrateSyncState) either restores it
    // from _sync_state or generates a fresh UUID. This is what makes
    // nodeId durable across reloads.
    this.nodeId = options.nodeId ?? "";
    if (this.nodeId === "") {
      this.nodeId = crypto.randomUUID();
    }
    this.blobs = new BlobHandle(options.blobAdapter ?? new MemoryBlobAdapter(), this.#blobRegistry);
  }

  /**
   * Advance the engine's HLC for a *send* (local mutation about to be
   * propagated to the server). Counter increments on same-millisecond bursts;
   * `wallMs` advances when the OS clock ticks. The returned HLC is strictly
   * greater than any HLC this engine has issued or received.
   *
   * The new HLC is persisted to `_sync_state` so a reload can pick up
   * where the previous instance left off, even across a backwards
   * wall-clock tick.
   */
  nextSendHlc(): Hlc {
    this.#currentHlc =
      this.#currentHlc === null ? createHlc(this.nodeId) : sendHlc(this.#currentHlc);
    void this.#persistSyncState(SYNC_STATE_KEYS.currentHlc, JSON.stringify(this.#currentHlc));
    return this.#currentHlc;
  }

  /**
   * Advance the engine's HLC after *receiving* a remote HLC. Preserves the
   * causality invariant that future local sends will be strictly greater than
   * any HLC observed (local or remote). Persists the new HLC.
   *
   * Returns a promise that resolves when the HLC has been persisted. Most
   * callers can ignore it; the sync transport awaits it before applying
   * remote ops so the HLC is durable on disk before the cursor advances.
   */
  receiveHlc(remote: Hlc): Promise<void> {
    this.#currentHlc =
      this.#currentHlc === null
        ? recvHlc(createHlc(this.nodeId), remote)
        : recvHlc(this.#currentHlc, remote);
    return this.#persistSyncState(SYNC_STATE_KEYS.currentHlc, JSON.stringify(this.#currentHlc));
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
   *
   * Also provisions the engine-owned tables (`_changes`, `_row_versions`,
   * `_sync_state`) and rehydrates durable state (nodeId, currentHlc) from
   * `_sync_state` when present. See HLC durability notes on `nextSendHlc`.
   */
  /**
   * Open the adapter and optionally apply versioned migrations and seeds.
   *
   * Idempotent: a second call after a successful init() is a no-op
   * (no extra open(), no re-apply). Call `close()` first to re-init.
   */
  async init(schema?: SchemaConfig): Promise<void> {
    if (this.#initialized) return;
    await this.adapter.open();
    await this.adapter.exec(JOURNAL_DDL, []);
    await this.adapter.exec(ROW_VERSIONS_DDL, []);
    await this.adapter.exec(SYNC_STATE_DDL, []);
    await this.#rehydrateSyncState();
    if (schema) {
      await applySchema(this.adapter, schema);
    }
    this.#initialized = true;
  }

  /**
   * Release adapter resources. Idempotent. After close(), the engine
   * can be re-opened with init().
   */
  async close(): Promise<void> {
    if (!this.#initialized) return;
    try {
      await this.adapter.close();
    } catch {
      // Adapter may already be closed; the in-memory flag is the
      // source of truth.
    }
    this.#initialized = false;
  }

  /**
   * Load nodeId and currentHlc from `_sync_state` if present. nodeId
   * defaults to the constructor option (or a fresh UUID); currentHlc
   * defaults to null and is then advanced by `nextSendHlc` / `receiveHlc`
   * which persist on every call.
   */
  async #rehydrateSyncState(): Promise<void> {
    const rows = await this.adapter.exec<{ key: string; value: string }>(
      `SELECT key, value FROM ${SYNC_STATE_TABLE}`,
    );
    for (const row of rows) {
      if (row.key === SYNC_STATE_KEYS.nodeId) {
        // Constructor-supplied nodeId wins; only fall back to persisted
        // value when the constructor was given nothing.
        // (We read from the public field that was set in the ctor.)
        if (this.nodeId === "" || this.nodeId === undefined) {
          (this as { nodeId: string }).nodeId = row.value;
        }
      } else if (row.key === SYNC_STATE_KEYS.currentHlc) {
        const parsed = JSON.parse(row.value) as Hlc;
        this.#currentHlc = parsed;
      }
    }
    // Persist whatever nodeId we ended up with so a future reload can
    // pick it up without an explicit option.
    await this.#persistSyncState(SYNC_STATE_KEYS.nodeId, this.nodeId);
  }

  /**
   * Upsert one row in `_sync_state`. Silently no-ops if the adapter is
   * not open (e.g. the engine was constructed but never `init()`-ed, or
   * the test closes the adapter before this fire-and-forget persist
   * resolves). The in-memory HLC is still authoritative; persistence
   * is best-effort.
   */
  async #persistSyncState(key: string, value: string): Promise<void> {
    try {
      await this.adapter.exec(
        `INSERT INTO ${SYNC_STATE_TABLE} (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [key, value, Date.now()],
      );
    } catch {
      // Adapter not open or already closed; the in-memory state is
      // still consistent.
    }
  }

  /**
   * Execute a batch of mutations, wrapped in a transaction when supported.
   *
   * Each committed local tx writes one row to the `_changes` journal — in
   * the *same* storage transaction as the data writes, stamped with the
   * engine's HLC. `SyncTransport` reads the journal to know what to upload.
   * If the data write fails, the journal row is rolled back with it.
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
    if (ops.length === 0) {
      // Still run a (no-op) notify so the engine's reactive surface stays
      // consistent, but skip the journal + event-bus emit.
      return;
    }

    const touchedTables = new Set<string>();
    for (const op of ops) {
      touchedTables.add(String(op.table).toLowerCase());
    }
    const hlc = this.nextSendHlc();
    const journalOps: JournalOp[] = ops.flatMap(engineOpToJournalOp);

    const applyAll = async (adpt: StorageAdapter): Promise<void> => {
      for (const op of ops) {
        await this.#applyOp(adpt, op, { hlc, mode: "local" });
      }
      await adpt.exec(
        `INSERT INTO ${JOURNAL_TABLE} (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          hlc.wallMs,
          hlc.counter,
          hlc.nodeId,
          JSON.stringify(journalOps),
          Date.now(),
        ],
      );
    };

    if (isTransactable(this.adapter)) {
      await this.adapter.transaction(applyAll);
    } else {
      await applyAll(this.adapter);
    }

    await this.#notifyLiveQueries([...touchedTables]);

    this.emitter.emit("changes:local", {
      ops,
      touchedTables: [...touchedTables],
    });
  }

  /**
   * Apply ops received from a remote peer. Writes data (so live queries
   * refresh) but does NOT journal — a remote change is not something we
   * need to upload again.
   *
   * Column-level LWW: for each remote op, the engine looks up the
   * currently-stored HLC for every column it touches. If the remote HLC
   * is not strictly greater, the op is skipped (data and version both
   * left untouched). Stale op → noop.
   *
   * The `remoteHlc` parameter is the HLC of the *change batch* the ops
   * belong to. A wire-level change is atomic; all its ops share one HLC.
   */
  async applyRemote(remoteHlc: Hlc, ops: ReadonlyArray<Op<S>>): Promise<void> {
    if (ops.length === 0) return;
    const touchedTables = new Set<string>();
    for (const op of ops) {
      touchedTables.add(String(op.table).toLowerCase());
    }

    const applyAll = async (adpt: StorageAdapter): Promise<void> => {
      for (const op of ops) {
        const accepted = await this.#acceptRemoteOp(adpt, op, remoteHlc);
        if (accepted) {
          await this.#applyOp(adpt, op, { hlc: remoteHlc, mode: "remote" });
        }
      }
    };

    if (isTransactable(this.adapter)) {
      await this.adapter.transaction(applyAll);
    } else {
      await applyAll(this.adapter);
    }

    await this.#notifyLiveQueries([...touchedTables]);
  }

  /**
   * LWW gate: should this remote op be applied given the stored HLCs?
   * Returns true if the remote HLC is strictly greater than the stored
   * HLC for every column the op touches. (No stored HLC means "stale by
   * default" — a missing row's columns count as the zero HLC, which the
   * remote HLC is greater than.)
   *
   * `delete` ops are accepted whenever their HLC is >= the stored HLC
   * for any column on the row (deletes should propagate even if other
   * columns have been updated more recently — the tombstone wins).
   */
  async #acceptRemoteOp(adpt: StorageAdapter, op: Op<S>, remoteHlc: Hlc): Promise<boolean> {
    const table = String(op.table);
    if (op.type === "delete") {
      // The row's effective HLC is the max of its columns. A delete at
      // remoteHlc is accepted unless every column is strictly newer.
      const rows = await adpt.exec<{
        hlc_wall_ms: number;
        hlc_counter: number;
        hlc_node_id: string;
      }>(
        `SELECT hlc_wall_ms, hlc_counter, hlc_node_id
         FROM ${ROW_VERSIONS_TABLE}
         WHERE table_name = ? AND row_id = ?`,
        [table, op.id],
      );
      for (const r of rows) {
        const cmp = compareHlcLocal(
          { wallMs: r.hlc_wall_ms, counter: r.hlc_counter, nodeId: r.hlc_node_id },
          remoteHlc,
        );
        if (cmp > 0) return false;
      }
      return true;
    }

    const cols = op.type === "insert" ? Object.keys(op.data) : Object.keys(op.patch);
    if (cols.length === 0) return false;
    for (const col of cols) {
      const rows = await adpt.exec<{
        hlc_wall_ms: number;
        hlc_counter: number;
        hlc_node_id: string;
      }>(
        `SELECT hlc_wall_ms, hlc_counter, hlc_node_id
         FROM ${ROW_VERSIONS_TABLE}
         WHERE table_name = ? AND row_id = ? AND col = ?`,
        [table, op.type === "insert" ? (op.data as unknown as { id: string }).id : op.id, col],
      );
      const row = rows[0];
      if (row === undefined) {
        // No stored version — the remote HLC wins by default (the row/column
        // is "stale" relative to the remote's clock).
        continue;
      }
      const cmp = compareHlcLocal(
        { wallMs: row.hlc_wall_ms, counter: row.hlc_counter, nodeId: row.hlc_node_id },
        remoteHlc,
      );
      if (cmp >= 0) return false;
    }
    return true;
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

  /**
   * Emit an `error` event. Exposed for collaborators (e.g. the sync
   * transport) that need to surface failures back to the engine's
   * subscribers without holding a private handle to the emitter.
   */
  reportError(err: unknown): void {
    this.emitter.emit("error", err instanceof Error ? err : new Error(String(err)));
  }

  /**
   * Emit a `sync:status` event. Exposed for the sync transport, which
   * owns the status. The engine used to expose a public `setStatus`
   * any caller could poke; that has been removed (architecture review
   * §6 'engine API surface debt'). The transport is the only legitimate
   * caller; subscribers listen via `engine.on('sync:status', ...)`.
   */
  notifySyncStatus(s: SyncStatus): void {
    this.emitter.emit("sync:status", s);
  }

  async #applyOp(
    adpt: StorageAdapter,
    op: Op<S>,
    options: { hlc?: Hlc; mode: "local" | "remote" } = { mode: "local" },
  ): Promise<void> {
    const table = String(op.table);
    if (op.type === "insert") {
      const rowId = (op.data as unknown as { id: string }).id;
      await this._putRow(adpt, table, rowId, op.data as Record<string, unknown>);
      if (options.hlc) {
        await this.#stampVersions(adpt, table, rowId, op.data, options.hlc);
      }
    } else if (op.type === "update") {
      await this._patchRow(adpt, table, op.id, op.patch as Record<string, unknown>);
      if (options.hlc) {
        await this.#stampVersions(adpt, table, op.id, op.patch, options.hlc);
      }
    } else {
      await this._removeRow(adpt, table, op.id);
      // Deletes clear all version rows for the row.
      await adpt.exec(`DELETE FROM ${ROW_VERSIONS_TABLE} WHERE table_name = ? AND row_id = ?`, [
        table,
        op.id,
      ]);
    }
  }

  /** Upsert one row in `_row_versions` per column in `data`, stamped with `hlc`. */
  async #stampVersions(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    data: Record<string, unknown>,
    hlc: Hlc,
  ): Promise<void> {
    for (const col of Object.keys(data)) {
      await adpt.exec(
        `INSERT INTO ${ROW_VERSIONS_TABLE}
           (table_name, row_id, col, hlc_wall_ms, hlc_counter, hlc_node_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (table_name, row_id, col) DO UPDATE SET
           hlc_wall_ms = excluded.hlc_wall_ms,
           hlc_counter = excluded.hlc_counter,
           hlc_node_id = excluded.hlc_node_id
         WHERE excluded.hlc_wall_ms > ${ROW_VERSIONS_TABLE}.hlc_wall_ms
            OR (excluded.hlc_wall_ms = ${ROW_VERSIONS_TABLE}.hlc_wall_ms
                AND excluded.hlc_counter > ${ROW_VERSIONS_TABLE}.hlc_counter)`,
        [table, rowId, col, hlc.wallMs, hlc.counter, hlc.nodeId],
      );
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
}

/** Factory — create a `PalladiumEngine` with the given adapter and options. */
export function createEngine<S extends SchemaMap>(
  adapter: StorageAdapter,
  options?: PalladiumEngineOptions,
): PalladiumEngine<S> {
  return new PalladiumEngine<S>(adapter, options);
}

/** Coerces an unknown thrown value to an `Error` instance. */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
