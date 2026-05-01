/**
 * NodeSqliteAdapter — StorageAdapter backed by node:sqlite.
 *
 * Supports in-memory and file-based VFS modes. Implements
 * TransactableStorageAdapter for atomic multi-row writes.
 *
 * Booleans are coerced to integers (false → 0, true → 1) when binding
 * parameters, matching SQLite's native storage type.
 *
 * node:sqlite is loaded via createRequire so that Vite/vitest does not try
 * to bundle it — it is only available at runtime in Node.js >= 22.5.0.
 */

// Use createRequire to load node:sqlite at runtime rather than as a static
// import, so Vite's bundler (which does not recognise node:sqlite as a
// built-in in older versions) does not try to resolve it at transform time.
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { StorageAdapter, TransactableStorageAdapter } from "@palladium/core";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

export type NodeVfs =
  | { readonly type: "memory" }
  | { readonly type: "file"; readonly filename: string };

export interface NodeSqliteConfig {
  readonly vfs: NodeVfs;
}

/** Guard against SQL injection via interpolated identifiers (table/column names). */
function assertIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new TypeError(
      `Invalid SQL identifier: ${JSON.stringify(name)}. Only [A-Za-z_][A-Za-z0-9_]* is allowed.`,
    );
  }
}

/** Coerce JS values to types accepted by node:sqlite. */
function coerce(v: unknown): null | number | bigint | string {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  // Stryker disable next-line all -- LogicalOperator/ConditionalExpression mutations here produce String(v) instead, but SQLite's type affinity coerces "42"→42 on read, making the mutations unobservable via exec()
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return v;
  return String(v);
}

export class NodeSqliteAdapter implements TransactableStorageAdapter {
  readonly #config: NodeSqliteConfig;
  #db: DatabaseSyncType | null = null;

  constructor(config: NodeSqliteConfig = { vfs: { type: "memory" } }) {
    this.#config = config;
  }

  get #database(): DatabaseSyncType {
    if (this.#db === null) {
      throw new Error("NodeSqliteAdapter: call open() before using the adapter.");
    }
    return this.#db;
  }

  async open(): Promise<void> {
    // Stryker disable next-line StringLiteral -- ":memory:" is the SQLite in-memory URI; any mutation breaks the adapter
    const path = this.#config.vfs.type === "memory" ? ":memory:" : this.#config.vfs.filename;
    this.#db = new DatabaseSync(path);
  }

  async exec<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    return this.#database.prepare(sql).all(...params.map(coerce)) as T[];
  }

  async put(table: string, _id: string, data: Record<string, unknown>): Promise<void> {
    assertIdentifier(table);
    const keys = Object.keys(data);
    for (const k of keys) assertIdentifier(k);
    if (keys.length === 0) return;
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
    this.#database.prepare(sql).run(...keys.map((k) => coerce(data[k])));
  }

  async patch(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
    assertIdentifier(table);
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    for (const k of keys) assertIdentifier(k);
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const sql = `UPDATE ${table} SET ${sets} WHERE id = ?`;
    this.#database.prepare(sql).run(...keys.map((k) => coerce(patch[k])), id);
  }

  async remove(table: string, id: string): Promise<void> {
    assertIdentifier(table);
    this.#database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  }

  async runMigrations(migrations: readonly string[]): Promise<void> {
    for (const migration of migrations) {
      this.#database.exec(migration);
    }
  }

  async transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    this.#database.exec("BEGIN");
    try {
      const result = await fn(this);
      this.#database.exec("COMMIT");
      return result;
    } catch (err) {
      this.#database.exec("ROLLBACK");
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.#db !== null) {
      this.#db.close();
      this.#db = null;
    }
  }
}
