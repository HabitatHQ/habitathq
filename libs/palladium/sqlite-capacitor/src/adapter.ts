/**
 * CapacitorSqliteAdapter — StorageAdapter backed by @capacitor-community/sqlite.
 *
 * Pass a SQLiteConnection (from @capacitor-community/sqlite or a compatible
 * shim) and a config specifying the database name and optional schema version.
 * Implements TransactableStorageAdapter via the plugin's begin/commit/rollback
 * transaction API.
 *
 * SQL routing in exec():
 *   - SELECT / PRAGMA / EXPLAIN -> query()   (returns rows)
 *   - DML with bind params      -> run()     (INSERT/UPDATE/DELETE)
 *   - DDL / DML without params  -> execute() (CREATE TABLE, multi-statement)
 *
 * Usage:
 *   import { SQLiteConnection, CapacitorSQLite } from '@capacitor-community/sqlite';
 *   const conn = new SQLiteConnection(CapacitorSQLite);
 *   const adapter = new CapacitorSqliteAdapter(conn, { dbName: 'myapp' });
 *   await adapter.open();
 */

import type { StorageAdapter, TransactableStorageAdapter } from "@palladium/core";
import { dbg } from "@palladium/core";
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

/** True for statements that return result rows via query(). */
function isReadStatement(sql: string): boolean {
  const trimmed = sql.trimStart().toUpperCase();
  return (
    trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("EXPLAIN")
  );
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
    dbg("sqlite-capacitor", "open start", { dbName: this.#config.dbName });
    await this.#conn.checkConnectionsConsistency();
    const { dbName, version = 1 } = this.#config;
    const isConn = (await this.#conn.isConnection(dbName, false)).result ?? false;
    if (isConn) {
      this.#db = await this.#conn.retrieveConnection(dbName, false);
    } else {
      this.#db = await this.#conn.createConnection(dbName, false, "no-encryption", version, false);
    }
    await this.#db.open();
    dbg("sqlite-capacitor", "open complete", { dbName, reused: isConn });
  }

  async exec<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    if (isReadStatement(sql)) {
      const result = await this.#database.query(sql, params as unknown[]);
      return (result.values ?? []) as T[];
    }

    if (params.length > 0) {
      dbg("sqlite-capacitor", "exec via run()", { sql: sql.slice(0, 60) });
      await this.#database.run(sql, params as unknown[], false);
      return [];
    }

    dbg("sqlite-capacitor", "exec via execute()", { sql: sql.slice(0, 60) });
    await this.#database.execute(sql, false);
    return [];
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
    await this.beginTransaction();
    try {
      const result = await fn(this);
      await this.commitTransaction();
      return result;
    } catch (err) {
      await this.rollbackTransaction();
      throw err;
    }
  }

  async beginTransaction(): Promise<void> {
    dbg("sqlite-capacitor", "BEGIN");
    await this.#database.beginTransaction();
  }

  async commitTransaction(): Promise<void> {
    dbg("sqlite-capacitor", "COMMIT");
    await this.#database.commitTransaction();
  }

  async rollbackTransaction(): Promise<void> {
    dbg("sqlite-capacitor", "ROLLBACK");
    await this.#database.rollbackTransaction();
  }

  async close(): Promise<void> {
    if (this.#db !== null) {
      dbg("sqlite-capacitor", "close", { dbName: this.#config.dbName });
      await this.#conn.closeConnection(this.#config.dbName, false);
      this.#db = null;
    }
  }
}
