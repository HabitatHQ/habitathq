/**
 * createMockEngine — SQLite in-memory engine for testing and local-only usage.
 *
 * Pass SQL migration strings to create the schema before writing data.
 *
 * ```ts
 * const db = createMockEngine<Schema>([
 *   'CREATE TABLE tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)',
 * ]);
 * await db.init();
 * await db.insert('tasks', { id: 't1', name: 'hello', done: 0 });
 * const rows = await db.exec<Task>(sql`SELECT * FROM tasks`);
 * ```
 */

import { PalladiumEngine } from "./engine.js";
import type { SyncStatus } from "./engine.js";
import { SqliteAdapter } from "./sqlite-adapter.js";
import type { SchemaMap } from "./tx.js";

class MockEngine<S extends SchemaMap> extends PalladiumEngine<S> {
  readonly #db: SqliteAdapter;
  readonly #migrations: readonly string[];

  constructor(migrations: readonly string[] = []) {
    const db = new SqliteAdapter();
    super(db);
    this.#db = db;
    this.#migrations = migrations;
  }

  async init(): Promise<void> {
    await this.#db.runMigrations(this.#migrations);
  }

  protected _putRow(table: string, id: string, data: Record<string, unknown>): void {
    this.#db._put(table, id, data);
  }

  protected _patchRow(table: string, id: string, patch: Record<string, unknown>): void {
    this.#db._patch(table, id, patch);
  }

  protected _removeRow(table: string, id: string): void {
    this.#db._remove(table, id);
  }

  /** Test helper: manually set sync status and emit the event. */
  _setStatus(s: SyncStatus): void {
    this.status = s;
    this.emitter.emit("sync:status", s);
  }
}

export function createMockEngine<S extends SchemaMap>(
  migrations: readonly string[] = [],
): MockEngine<S> {
  return new MockEngine<S>(migrations);
}
