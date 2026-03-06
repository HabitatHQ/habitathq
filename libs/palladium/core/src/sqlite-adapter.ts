/**
 * SqliteAdapter — StorageAdapter backed by node:sqlite (in-memory).
 *
 * Used by createMockEngine for tests and local-only development in Node.js.
 * Requires runMigrations() to be called (via engine.init()) before any writes.
 *
 * Booleans are coerced to integers (false → 0, true → 1) when binding
 * parameters, matching SQLite's native storage type.
 */

// Use createRequire to load node:sqlite at runtime rather than as a static
// import, so Vite's bundler (which does not recognise node:sqlite as a
// built-in in versions < 6) does not try to resolve it at transform time.
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { StorageAdapter } from "./storage.js";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

/** Coerce JS values to types accepted by node:sqlite. */
function coerce(v: unknown): null | number | bigint | string {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  // Stryker disable next-line all -- LogicalOperator/ConditionalExpression mutations here produce String(v) instead, but SQLite's type affinity coerces "42"→42 on read, making the mutations unobservable via exec()
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return v;
  return String(v);
}

export class SqliteAdapter implements StorageAdapter {
  readonly #db: DatabaseSyncType;

  constructor() {
    // Stryker disable next-line StringLiteral -- ":memory:" is the SQLite in-memory URI; any mutation breaks the adapter
    this.#db = new DatabaseSync(":memory:");
  }

  /** Low-level: insert or replace a row in a table. */
  _put(table: string, _id: string, row: Record<string, unknown>): void {
    const keys = Object.keys(row);
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
    this.#db.prepare(sql).run(...keys.map((k) => coerce(row[k])));
  }

  /** Low-level: patch an existing row. */
  _patch(table: string, id: string, patch: Record<string, unknown>): void {
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const sql = `UPDATE ${table} SET ${sets} WHERE id = ?`;
    this.#db.prepare(sql).run(...keys.map((k) => coerce(patch[k])), id);
  }

  /** Low-level: remove a row by id. */
  _remove(table: string, id: string): void {
    this.#db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  }

  async exec<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    return this.#db.prepare(sql).all(...params.map(coerce)) as T[];
  }

  async runMigrations(migrations: readonly string[]): Promise<void> {
    for (const migration of migrations) {
      this.#db.exec(migration);
    }
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}
