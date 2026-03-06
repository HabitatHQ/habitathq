/**
 * LiveQuery — a reactive SQL query that re-runs when its watched tables change.
 *
 * ```ts
 * const lq = db.liveQuery<Task>(sql`SELECT * FROM tasks WHERE done = ${false}`);
 * const initial = await lq.exec();
 * const unsub   = lq.on('change', rows => setTasks(rows));
 * // ...
 * lq.cancel();
 * ```
 */

import type { SqlQuery } from "./sql.js";
import type { StorageAdapter } from "./storage.js";

type ChangeListener<T> = (rows: T[]) => void;

export class LiveQuery<T = Record<string, unknown>> {
  readonly #query: SqlQuery;
  readonly #adapter: StorageAdapter;
  readonly #listeners = new Set<ChangeListener<T>>();
  #cancelled = false;

  constructor(query: SqlQuery, adapter: StorageAdapter) {
    this.#query = query;
    this.#adapter = adapter;
  }

  /** Execute the query once and return the result rows. */
  async exec(): Promise<T[]> {
    return this.#adapter.exec<T>(this.#query.text, this.#query.params);
  }

  /**
   * Subscribe to result changes.
   * Returns an unsubscribe function.
   */
  on(_event: "change", listener: ChangeListener<T>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Called by the engine when tables are written to.
   * If any of the written tables overlap with this query's watched tables,
   * the query is re-run and listeners are notified.
   */
  async notifyTables(tables: readonly string[]): Promise<void> {
    if (this.#cancelled) return;
    const watches = this.#query.tables;
    const hasOverlap = tables.some((t) => watches.includes(t));
    if (!hasOverlap) return;
    await this.#runAndNotify();
  }

  /** Manually re-run the query and notify all listeners. */
  async refresh(): Promise<void> {
    if (this.#cancelled) return;
    await this.#runAndNotify();
  }

  /** Stop all future change notifications. */
  cancel(): void {
    this.#cancelled = true;
    this.#listeners.clear();
  }

  async #runAndNotify(): Promise<void> {
    const rows = await this.#adapter.exec<T>(this.#query.text, this.#query.params);
    for (const listener of this.#listeners) {
      listener(rows);
    }
  }
}
