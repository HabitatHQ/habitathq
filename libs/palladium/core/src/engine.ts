/**
 * PalladiumEngine — abstract base class for the sync engine.
 *
 * Provides the high-level API (tx, insert, update, delete, liveQuery, on)
 * on top of a StorageAdapter. Subclasses (e.g. MockEngine, SqliteEngine)
 * supply the concrete adapter and optional transport.
 */

import { EventEmitter } from "./event-emitter.js";
import { LiveQuery } from "./live-query.js";
import type { SqlQuery } from "./sql.js";
import type { StorageAdapter } from "./storage.js";
import { TxBuilder } from "./tx.js";
import type { SchemaMap } from "./tx.js";

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export interface EngineEvents {
  "sync:status": SyncStatus;
  error: Error;
}

export abstract class PalladiumEngine<S extends SchemaMap> {
  protected readonly adapter: StorageAdapter;
  protected readonly emitter = new EventEmitter<EngineEvents>();
  protected status: SyncStatus = "idle";
  readonly #liveQueries = new Set<LiveQuery>();

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  /** Initialise the engine (run migrations, open connections). */
  abstract init(): Promise<void>;

  /** Execute a batch of mutations inside a SQLite transaction. */
  async tx(callback: (t: TxBuilder<S>) => void): Promise<void> {
    const builder = new TxBuilder<S>();
    callback(builder);
    const ops = builder.build();
    const touchedTables = new Set<string>();

    for (const op of ops) {
      const table = String(op.table);
      touchedTables.add(table);
      await this.#applyOp(op);
    }

    // Notify live queries whose watched tables overlap.
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

  /** Create a reactive live query. */
  liveQuery<T = Record<string, unknown>>(query: SqlQuery): LiveQuery<T> {
    const lq = new LiveQuery<T>(query, this.adapter);
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

  async #applyOp(op: ReturnType<TxBuilder<S>["build"]>[number]): Promise<void> {
    const table = String(op.table);
    if (op.type === "insert") {
      this._putRow(
        table,
        (op.data as unknown as { id: string }).id,
        op.data as Record<string, unknown>,
      );
    } else if (op.type === "update") {
      this._patchRow(table, op.id, op.patch as Record<string, unknown>);
    } else {
      this._removeRow(table, op.id);
    }
  }

  /** Override in subclasses to customise storage writes. */
  protected abstract _putRow(table: string, id: string, data: Record<string, unknown>): void;
  protected abstract _patchRow(table: string, id: string, patch: Record<string, unknown>): void;
  protected abstract _removeRow(table: string, id: string): void;

  async #notifyLiveQueries(tables: string[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const lq of this.#liveQueries) {
      promises.push(lq.notifyTables(tables));
    }
    await Promise.all(promises);
  }
}
