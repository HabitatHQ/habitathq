/**
 * CapacitorSqliteAdapter — StorageAdapter backed by @capacitor-community/sqlite.
 *
 * Pass a SQLiteConnection (from @capacitor-community/sqlite or a compatible
 * shim) and a config specifying the database name and optional schema version.
 * Implements TransactableStorageAdapter via the plugin's begin/commit/rollback
 * transaction API.
 *
 * SQL routing in exec():
 *   - SELECT / PRAGMA / EXPLAIN / VALUES and CTE SELECTs -> query() (returns rows)
 *   - DML with RETURNING (including CTE DML) -> run(..., returnMode: "all")
 *   - Other DML with bind params -> run()
 *   - DDL / DML without params, including multi-statement scripts -> execute()
 *
 * Usage:
 *   import { SQLiteConnection, CapacitorSQLite } from '@capacitor-community/sqlite';
 *   const conn = new SQLiteConnection(CapacitorSQLite);
 *   const adapter = new CapacitorSqliteAdapter(conn, { dbName: 'myapp' });
 *   await adapter.open();
 */

import type { StorageAdapter, TransactableStorageAdapter } from "@palladium/core";
import { dbg } from "@palladium/core";
import type { CapSQLiteChanges, SQLiteConnection, SQLiteDBConnection } from "./types.js";

export type { SQLiteConnection, SQLiteDBConnection } from "./types.js";

export type CapacitorSqliteBlobBindingFormat = "android-buffer" | "byte-array";

export interface CapacitorSqliteConfig {
  readonly dbName: string;
  readonly version?: number;
  /** Native plugin byte binding shape: Android Buffer object or iOS byte array. */
  readonly blobBindingFormat?: CapacitorSqliteBlobBindingFormat;
}

function encodeBindings(
  values: readonly unknown[],
  format: CapacitorSqliteBlobBindingFormat,
): unknown[] {
  return values.map((value) => {
    if (!(value instanceof Uint8Array)) return value;
    const data = Array.from(value);
    return format === "android-buffer" ? { type: "Buffer", data } : data;
  });
}

/** Guard against SQL injection via interpolated identifiers (table/column names). */
function assertIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new TypeError(
      `Invalid SQL identifier: ${JSON.stringify(name)}. Only [A-Za-z_][A-Za-z0-9_]* is allowed.`,
    );
  }
}

type SqlToken = { readonly kind: "word" | "quoted" | "punctuation"; readonly value: string };

/**
 * Tokenize enough SQLite syntax to classify statements without interpreting
 * words or delimiters inside comments, string literals, or quoted identifiers.
 */
function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i + 2);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let value = "";
      i++;
      while (i < sql.length) {
        const next = sql[i] as string;
        if (next === close) {
          if (sql[i + 1] === close && close !== "]") {
            value += close;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += next;
        i++;
      }
      tokens.push({ kind: "quoted", value });
      continue;
    }
    if (/[A-Za-z0-9_]/.test(c)) {
      const start = i++;
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i] as string)) i++;
      tokens.push({ kind: "word", value: sql.slice(start, i).toUpperCase() });
      continue;
    }
    tokens.push({ kind: "punctuation", value: c });
    i++;
  }
  return tokens;
}

/** Find the index after a balanced parenthesized token group. */
function afterParentheses(tokens: readonly SqlToken[], open: number): number {
  if (tokens[open]?.value !== "(") return -1;
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i]?.value === "(") depth++;
    else if (tokens[i]?.value === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Return the first token after a CTE list, or -1 for malformed/unrecognized syntax. */
function cteBodyStart(tokens: readonly SqlToken[]): number {
  let i = 1;
  if (tokens[i]?.value === "RECURSIVE") i++;
  while (i < tokens.length) {
    // The name itself can be a bare or quoted identifier.
    if (tokens[i]?.kind !== "word" && tokens[i]?.kind !== "quoted") return -1;
    i++;
    if (tokens[i]?.value === "(") {
      i = afterParentheses(tokens, i);
      if (i < 0) return -1;
    }
    if (tokens[i]?.value !== "AS") return -1;
    i++;
    if (tokens[i]?.value === "NOT") {
      i++;
      if (tokens[i]?.value !== "MATERIALIZED") return -1;
      i++;
    } else if (tokens[i]?.value === "MATERIALIZED") {
      i++;
    }
    if (tokens[i]?.value !== "(") return -1;
    i = afterParentheses(tokens, i);
    if (i < 0) return -1;
    if (tokens[i]?.value !== ",") return i;
    i++;
  }
  return -1;
}

/** True when RETURNING is a top-level keyword in the statement token sequence. */
function hasTopLevelReturning(tokens: readonly SqlToken[]): boolean {
  let depth = 0;
  for (const token of tokens) {
    if (token.value === "(") depth++;
    else if (token.value === ")") depth--;
    else if (depth === 0 && token.kind === "word" && token.value === "RETURNING") return true;
  }
  return false;
}

/** Classify SQL for the plugin APIs while preserving complete scripts for execute(). */
function classification(
  sql: string,
): { kind: "read" } | { kind: "returning" } | { kind: "command" } {
  const tokens = tokenizeSql(sql);
  const statements: SqlToken[][] = [[]];
  for (const token of tokens) {
    if (token.value === ";") statements.push([]);
    else statements[statements.length - 1]?.push(token);
  }
  const nonEmpty = statements.filter((statement) => statement.length > 0);
  if (nonEmpty.length !== 1) return { kind: "command" };

  const statement = nonEmpty[0] as SqlToken[];
  let start = 0;
  let verb = statement[0]?.value ?? "";
  if (verb === "WITH") {
    start = cteBodyStart(statement);
    if (start < 0) return { kind: "command" };
    verb = statement[start]?.value ?? "";
  }

  if (verb === "SELECT" || verb === "VALUES" || verb === "PRAGMA" || verb === "EXPLAIN") {
    return { kind: "read" };
  }
  if (
    (verb === "INSERT" || verb === "UPDATE" || verb === "DELETE") &&
    hasTopLevelReturning(statement.slice(start))
  ) {
    return { kind: "returning" };
  }
  return { kind: "command" };
}

export class CapacitorSqliteAdapter implements TransactableStorageAdapter {
  readonly #conn: SQLiteConnection;
  readonly #config: CapacitorSqliteConfig;
  #db: SQLiteDBConnection | null = null;
  #opening: Promise<SQLiteDBConnection> | null = null;
  #closing: Promise<void> | null = null;

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
    if (this.#closing !== null) await this.#closing;
    if (this.#opening !== null) {
      await this.#opening;
      return;
    }
    const opening = this.#openConnection();
    this.#opening = opening;
    try {
      this.#db = await opening;
    } finally {
      if (this.#opening === opening) this.#opening = null;
    }
  }

  async #openConnection(): Promise<SQLiteDBConnection> {
    dbg("sqlite-capacitor", "open start", { dbName: this.#config.dbName });
    const current = this.#db;
    if (current !== null) {
      const state = await current.isDBOpen?.();
      if (state?.result ?? true) return current;
      this.#db = null;
      await current.open();
      dbg("sqlite-capacitor", "open complete", { dbName: this.#config.dbName, reused: true });
      return current;
    }
    await this.#conn.checkConnectionsConsistency();
    const { dbName, version = 1 } = this.#config;
    const isConn = (await this.#conn.isConnection(dbName, false)).result ?? false;
    const db = isConn
      ? await this.#conn.retrieveConnection(dbName, false)
      : await this.#conn.createConnection(dbName, false, "no-encryption", version, false);
    const state = await db.isDBOpen?.();
    if (!(state?.result ?? false)) await db.open();
    dbg("sqlite-capacitor", "open complete", { dbName, reused: isConn });
    return db;
  }

  async exec<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const route = classification(sql);
    const bindings = encodeBindings(params, this.#config.blobBindingFormat ?? "byte-array");

    if (route.kind === "read") {
      const result = await this.#database.query(sql, bindings);
      return (result.values ?? []) as T[];
    }

    if (route.kind === "returning") {
      const result = (await this.#database.run(sql, bindings, false, "all")) as
        | CapSQLiteChanges
        | undefined;
      return ((result?.changes?.values as T[] | undefined) ?? []) as T[];
    }

    if (params.length > 0) {
      dbg("sqlite-capacitor", "exec via run()", { sql: sql.slice(0, 60) });
      await this.#database.run(sql, bindings, false);
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
    // REPLACE deletes the old row, which would cascade into child records.
    const updates = keys.filter((key) => key !== "id").map((key) => `${key} = excluded.${key}`);
    const conflict = updates.length > 0 ? `DO UPDATE SET ${updates.join(", ")}` : "DO NOTHING";
    const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) ${conflict}`;
    await this.#database.run(
      sql,
      encodeBindings(
        keys.map((k) => data[k]),
        this.#config.blobBindingFormat ?? "byte-array",
      ),
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
    await this.#database.run(
      sql,
      encodeBindings(
        [...keys.map((k) => patch[k]), id],
        this.#config.blobBindingFormat ?? "byte-array",
      ),
      false,
    );
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

  /** Delete only the configured native database after releasing its connection. */
  async resetStorage(): Promise<void> {
    if (this.#opening !== null) await this.#opening;
    const database = this.#database;
    if (typeof database.delete !== "function") {
      throw new Error("SQLite connection does not support physical database reset");
    }
    await this.close();
    await database.delete();
    this.#db = null;
    await this.open();
  }

  async close(): Promise<void> {
    if (this.#opening !== null) await this.#opening;
    if (this.#closing !== null) {
      await this.#closing;
      return;
    }
    if (this.#db === null) {
      this.#closing = null;
      return;
    }
    const closing = (async () => {
      try {
        await this.#conn.closeConnection(this.#config.dbName, false);
      } finally {
        this.#db = null;
        this.#closing = null;
      }
    })();
    this.#closing = closing;
    await closing;
  }
}
