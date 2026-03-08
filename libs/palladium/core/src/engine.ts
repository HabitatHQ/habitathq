/**
 * PalladiumEngine — concrete sync engine base class.
 *
 * Provides the high-level API (tx, insert, update, delete, liveQuery, on)
 * on top of a StorageAdapter. Subclasses may override the protected
 * _putRow / _patchRow / _removeRow hooks to intercept writes (e.g. to
 * replicate changes to a remote server).
 */

import { EventEmitter } from "./event-emitter.js";
import { LiveQuery } from "./live-query.js";
import type { SqlQuery } from "./sql.js";
import { isTransactable } from "./storage.js";
import type { StorageAdapter } from "./storage.js";
import { TxBuilder } from "./tx.js";
import type { Op, SchemaMap } from "./tx.js";

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export interface EngineEvents {
  "sync:status": SyncStatus;
  error: Error;
}

export class PalladiumEngine<S extends SchemaMap> {
  readonly adapter: StorageAdapter;
  readonly #migrations: readonly string[];
  protected readonly emitter = new EventEmitter<EngineEvents>();
  protected status: SyncStatus = "idle";
  readonly #liveQueries = new Set<LiveQuery>();

  constructor(adapter: StorageAdapter, migrations: readonly string[] = []) {
    this.adapter = adapter;
    this.#migrations = migrations;
  }

  /** Open the adapter and run migrations. */
  async init(): Promise<void> {
    await this.adapter.open();
    await this.adapter.runMigrations(this.#migrations);
  }

  /** Execute a batch of mutations, wrapped in a transaction when supported. */
  async tx(callback: (t: TxBuilder<S>) => void): Promise<void> {
    const builder = new TxBuilder<S>();
    const maybePromise = callback(builder);
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

  /** Create a reactive live query. Automatically deregisters on cancel(). */
  liveQuery<T = Record<string, unknown>>(query: SqlQuery): LiveQuery<T> {
    const lq = new LiveQuery<T>(query, this.adapter, () => {
      // Stryker disable next-line all -- removing delete is observably equivalent: cancelled lq returns early from notifyTables
      this.#liveQueries.delete(lq as LiveQuery);
    });
    this.#liveQueries.add(lq as LiveQuery);
    return lq;
  }

  /** Subscribe to engine events. */
  on<K extends keyof EngineEvents>(
    event: K,
    listener: (payload: EngineEvents[K]) => void,
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

/** Factory — create a PalladiumEngine with the given adapter and migrations. */
export function createEngine<S extends SchemaMap>(
  adapter: StorageAdapter,
  migrations: readonly string[] = [],
): PalladiumEngine<S> {
  return new PalladiumEngine<S>(adapter, migrations);
}

/** Coerces an unknown thrown value to an `Error` instance. */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
