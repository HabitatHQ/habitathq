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

export class PalladiumEngine<S extends SchemaMap> {
  readonly adapter: StorageAdapter;
  readonly nodeId: string;
  protected readonly emitter = new EventEmitter<EngineEvents<S>>();
  protected status: SyncStatus = "idle";
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

  constructor(adapter: StorageAdapter, options?: PalladiumEngineOptions | BlobAdapter) {
    this.adapter = adapter;
    // Back-compat shim: previous signature was (adapter, blobAdapter?). Detect
    // a bare BlobAdapter by the absence of nodeId/blobAdapter keys.
    const opts: PalladiumEngineOptions =
      options && "get" in options && typeof options.get === "function"
        ? { blobAdapter: options as BlobAdapter }
        : ((options as PalladiumEngineOptions | undefined) ?? {});
    this.nodeId = opts.nodeId ?? crypto.randomUUID();
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
    if (schema) {
      await applySchema(this.adapter, schema);
    }
  }

  /** Suppresses `"changes:local"` while remote ops are being applied. */
  #suppressLocalEmit = false;

  /** Execute a batch of mutations, wrapped in a transaction when supported. */
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

    const applyAll = async (adpt: StorageAdapter): Promise<void> => {
      for (const op of ops) {
        // Lowercase to match extractTables(), which normalises SQL identifiers.
        touchedTables.add(String(op.table).toLowerCase());
        await this.#applyOp(adpt, op);
      }
    };

    if (isTransactable(this.adapter)) {
      await this.adapter.transaction(applyAll);
    } else {
      await applyAll(this.adapter);
    }

    await this.#notifyLiveQueries([...touchedTables]);

    if (!this.#suppressLocalEmit && ops.length > 0) {
      this.emitter.emit("changes:local", {
        ops,
        touchedTables: [...touchedTables],
      });
    }
  }

  /**
   * Apply ops received from a remote peer. Runs through the normal `tx()`
   * path (so live queries refresh) but suppresses the `"changes:local"` event
   * — sync transports need this to avoid re-emitting a change they just
   * downloaded.
   */
  async applyRemote(ops: ReadonlyArray<Op<S>>): Promise<void> {
    if (ops.length === 0) return;
    this.#suppressLocalEmit = true;
    try {
      await this.tx((t) => {
        for (const op of ops) {
          if (op.type === "insert") {
            t.insert(op.table, op.data);
          } else if (op.type === "update") {
            t.update(op.table, op.id, op.patch);
          } else {
            t.delete(op.table, op.id);
          }
        }
      });
    } finally {
      this.#suppressLocalEmit = false;
    }
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
