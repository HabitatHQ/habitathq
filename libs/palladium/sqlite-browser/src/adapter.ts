/**
 * BrowserSqliteAdapter — StorageAdapter backed by @sqlite.org/sqlite-wasm.
 *
 * Supports three VFS modes:
 * - `memory`:         ephemeral in-memory database
 * - `opfs`:           basic OPFS via oo1.OpfsDb (serializable, no locking)
 * - `opfs-sah-pool`:  high-performance OPFS SAH pool VFS with synchronous
 *                     file access handles (recommended for production)
 *
 * OPFS modes require `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp` response headers.
 *
 * Vite config note: add `optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] }`
 * to prevent Vite from pre-bundling the WASM module.
 */

import type { StorageAdapter, TransactableStorageAdapter } from "@palladium/core";
import { dbg } from "@palladium/core";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

export type BrowserVfs =
  | { readonly type: "memory" }
  | { readonly type: "opfs"; readonly filename: string }
  | { readonly type: "opfs-sah-pool"; readonly directory: string; readonly filename: string };

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
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm internals
  #sqlite3: any = null;

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
    const vfs = this.#config.vfs;
    dbg("sqlite-browser", "open start", { type: vfs.type });

    this.#sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });

    if (vfs.type === "memory") {
      // biome-ignore lint/suspicious/noExplicitAny: oo1 not in TS types
      this.#db = new (this.#sqlite3 as any).oo1.DB(":memory:");
    } else if (vfs.type === "opfs") {
      // biome-ignore lint/suspicious/noExplicitAny: oo1 not in TS types
      this.#db = new (this.#sqlite3 as any).oo1.OpfsDb(vfs.filename);
    } else {
      dbg("sqlite-browser", "installing SAH pool VFS", {
        directory: vfs.directory,
        filename: vfs.filename,
      });
      const poolUtil = await this.#sqlite3.installOpfsSAHPoolVfs({
        directory: vfs.directory,
        clearOnInit: false,
      });
      this.#db = new poolUtil.OpfsSAHPoolDb(vfs.filename);
      this.#db.exec("PRAGMA foreign_keys = ON");
    }

    dbg("sqlite-browser", "open complete", { type: vfs.type });
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

  /**
   * Serialize the live database to a Uint8Array via sqlite3_serialize FFI.
   *
   * Only available for persistent VFS types (`opfs` and `opfs-sah-pool`).
   * Throws if the adapter is not open or uses the `memory` VFS.
   */
  serialize(): Uint8Array {
    if (!this.#sqlite3 || !this.#db) {
      throw new Error("BrowserSqliteAdapter: not open");
    }
    if (this.#config.vfs.type === "memory") {
      throw new Error("BrowserSqliteAdapter: serialize() is not supported for memory VFS");
    }

    dbg("sqlite-browser", "serialize start");
    const w = this.#sqlite3.wasm;
    const c = this.#sqlite3.capi;
    const savedStack = w.pstack.pointer;
    try {
      const pSize = w.pstack.alloc(8);
      const pData = c.sqlite3_serialize(this.#db.pointer, "main", pSize, 0);
      if (!pData) throw new Error("sqlite3_serialize returned null");
      const nBytes = Number(w.peek(pSize, "i64"));
      const bytes = new Uint8Array(nBytes);
      bytes.set(w.heap8u().subarray(pData, pData + nBytes));
      c.sqlite3_free(pData);
      dbg("sqlite-browser", "serialize complete", { bytes: nBytes });
      return bytes;
    } finally {
      w.pstack.restore(savedStack);
    }
  }

  async close(): Promise<void> {
    if (this.#db !== null) {
      dbg("sqlite-browser", "close");
      this.#db.close();
      this.#db = null;
      this.#sqlite3 = null;
    }
  }
}
