/**
 * CapacitorSqliteAdapter — StorageAdapter backed by @capacitor-community/sqlite.
 *
 * Pass a SQLiteConnection (from @capacitor-community/sqlite or a compatible
 * shim) and a config specifying the database name and optional schema version.
 * Implements TransactableStorageAdapter via the plugin's begin/commit/rollback
 * transaction API.
 *
 * Usage:
 *   import { SQLiteConnection, CapacitorSQLite } from '@capacitor-community/sqlite';
 *   const conn = new SQLiteConnection(CapacitorSQLite);
 *   const adapter = new CapacitorSqliteAdapter(conn, { dbName: 'myapp' });
 *   const engine = createEngine(adapter);
 *   await engine.init(schema);
 */

import type { StorageAdapter, TransactableStorageAdapter } from "@palladium/core";
import type { SQLiteConnection, SQLiteDBConnection } from "./types.js";

export type { SQLiteConnection, SQLiteDBConnection } from "./types.js";

export interface CapacitorSqliteConfig {
  readonly dbName: string;
  readonly version?: number;
}

/** Guard against SQL injection via interpolated identifiers (table/column names). */
function assertIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new TypeError(
      `Invalid SQL identifier: ${JSON.stringify(name)}. Only [A-Za-z_][A-Za-z0-9_]* is allowed.`,
    );
  }
}

export class CapacitorSqliteAdapter implements TransactableStorageAdapter {
  readonly #conn: SQLiteConnection;
  readonly #config: CapacitorSqliteConfig;
  #db: SQLiteDBConnection | null = null;

  constructor(connection: SQLiteConnection, config: CapacitorSqliteConfig) {
    this.#conn = connection;
    this.#config = config;
  }

  get #database(): SQLiteDBConnection {
    if (this.#db === null) {
      throw new Error("CapacitorSqliteAdapter: call open() before using the adapter.");
    }
    return this.#db;
  }

  async open(): Promise<void> {
    await this.#conn.checkConnectionsConsistency();
    const { dbName, version = 1 } = this.#config;
    const isConn = (await this.#conn.isConnection(dbName, false)).result ?? false;
    if (isConn) {
      this.#db = await this.#conn.retrieveConnection(dbName, false);
    } else {
      this.#db = await this.#conn.createConnection(dbName, false, "no-encryption", version, false);
    }
    await this.#db.open();
  }

  async exec<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.#database.query(sql, params as unknown[]);
    return (result.values ?? []) as T[];
  }

  async put(table: string, _id: string, data: Record<string, unknown>): Promise<void> {
    assertIdentifier(table);
    const keys = Object.keys(data);
    for (const k of keys) assertIdentifier(k);
    if (keys.length === 0) return;
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
    await this.#database.run(
      sql,
      keys.map((k) => data[k]),
      false,
    );
  }

  async patch(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
    assertIdentifier(table);
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    for (const k of keys) assertIdentifier(k);
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const sql = `UPDATE ${table} SET ${sets} WHERE id = ?`;
    await this.#database.run(sql, [...keys.map((k) => patch[k]), id], false);
  }

  async remove(table: string, id: string): Promise<void> {
    assertIdentifier(table);
    await this.#database.run(`DELETE FROM ${table} WHERE id = ?`, [id], false);
  }

  async runMigrations(migrations: readonly string[]): Promise<void> {
    for (const migration of migrations) {
      await this.#database.execute(migration, false);
    }
  }

  async transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    await this.#database.beginTransaction();
    try {
      const result = await fn(this);
      await this.#database.commitTransaction();
      return result;
    } catch (err) {
      await this.#database.rollbackTransaction();
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.#db !== null) {
      await this.#conn.closeConnection(this.#config.dbName, false);
      this.#db = null;
    }
  }
}
