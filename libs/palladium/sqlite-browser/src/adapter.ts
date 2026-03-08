/**
 * BrowserSqliteAdapter — StorageAdapter backed by @sqlite.org/sqlite-wasm.
 *
 * Supports in-memory and OPFS (Origin Private File System) VFS modes.
 * OPFS provides persistent storage in modern browsers; memory is ephemeral.
 *
 * Vite config note: add `optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] }`
 * to prevent Vite from pre-bundling the WASM module.
 *
 * OPFS note: OPFS requires `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp` response headers.
 */

import type { StorageAdapter, TransactableStorageAdapter } from "@palladium/core";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

export type BrowserVfs =
  | { readonly type: "memory" }
  | { readonly type: "opfs"; readonly filename: string };

export interface BrowserSqliteConfig {
  readonly vfs: BrowserVfs;
}

/** Guard against SQL injection via interpolated identifiers (table/column names). */
function assertIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new TypeError(
      `Invalid SQL identifier: ${JSON.stringify(name)}. Only [A-Za-z_][A-Za-z0-9_]* is allowed.`,
    );
  }
}

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exported cleanly
type Sqlite3Db = any;

export class BrowserSqliteAdapter implements TransactableStorageAdapter {
  readonly #config: BrowserSqliteConfig;
  #db: Sqlite3Db | null = null;

  constructor(config: BrowserSqliteConfig = { vfs: { type: "memory" } }) {
    this.#config = config;
  }

  get #database(): Sqlite3Db {
    if (this.#db === null) {
      throw new Error("BrowserSqliteAdapter: call open() before using the adapter.");
    }
    return this.#db;
  }

  async open(): Promise<void> {
    const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
    if (this.#config.vfs.type === "memory") {
      // biome-ignore lint/suspicious/noExplicitAny: oo1 not in TS types
      this.#db = new (sqlite3 as any).oo1.DB(":memory:");
    } else {
      // biome-ignore lint/suspicious/noExplicitAny: oo1 not in TS types
      this.#db = new (sqlite3 as any).oo1.OpfsDb(this.#config.vfs.filename);
    }
  }

  async exec<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    return (this.#database.exec({
      sql,
      bind: params.length > 0 ? (params as unknown[]) : undefined,
      returnValue: "resultRows",
      rowMode: "object",
    }) ?? []) as T[];
  }

  async put(table: string, _id: string, data: Record<string, unknown>): Promise<void> {
    assertIdentifier(table);
    const keys = Object.keys(data);
    for (const k of keys) assertIdentifier(k);
    if (keys.length === 0) return;
    const placeholders = keys.map(() => "?").join(", ");
    this.#database.exec({
      sql: `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`,
      bind: keys.map((k) => (data[k] === undefined ? null : data[k])),
    });
  }

  async patch(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
    assertIdentifier(table);
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    for (const k of keys) assertIdentifier(k);
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    this.#database.exec({
      sql: `UPDATE ${table} SET ${sets} WHERE id = ?`,
      bind: [...keys.map((k) => (patch[k] === undefined ? null : patch[k])), id],
    });
  }

  async remove(table: string, id: string): Promise<void> {
    assertIdentifier(table);
    this.#database.exec({ sql: `DELETE FROM ${table} WHERE id = ?`, bind: [id] });
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
