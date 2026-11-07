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
import type {
  ConstraintDeferringAdapter,
  StorageAdapter,
  TransactableStorageAdapter,
} from "@palladium/core";

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
function coerce(v: unknown): null | number | bigint | string | Uint8Array {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Uint8Array) return v;
  // Stryker disable next-line all -- LogicalOperator/ConditionalExpression mutations here produce String(v) instead, but SQLite's type affinity coerces "42"→42 on read, making the mutations unobservable via exec()
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return v;
  return String(v);
}

/** A connection view; transaction views expire when their callback settles. */
class ConnectionAdapter implements StorageAdapter, ConstraintDeferringAdapter {
  #db: DatabaseSyncType | null;

  constructor(db: DatabaseSyncType) {
    this.#db = db;
  }

  expire(): void {
    this.#db = null;
  }

  get #database(): DatabaseSyncType {
    if (this.#db === null) {
      throw new Error("NodeSqliteAdapter: transaction callback has already settled.");
    }
    return this.#db;
  }

  async open(): Promise<void> {
    throw new Error("NodeSqliteAdapter: transaction handles cannot open the shared connection.");
  }

  async close(): Promise<void> {
    throw new Error("NodeSqliteAdapter: transaction handles cannot close the shared connection.");
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
    // REPLACE deletes the old row, which would cascade into child records.
    const updates = keys.filter((key) => key !== "id").map((key) => `${key} = excluded.${key}`);
    const conflict = updates.length > 0 ? `DO UPDATE SET ${updates.join(", ")}` : "DO NOTHING";
    const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) ${conflict}`;
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

  /**
   * Defer FK checks to COMMIT (`D2c`). Effective only inside a transaction.
   *
   * TODO(cr/F20): SQLite defaults `PRAGMA foreign_keys` to OFF, so this deferral
   * currently guards nothing — `open()` would need `PRAGMA foreign_keys = ON`
   * (here and in the browser adapter for all VFS types) to actually enforce.
   * Deferred deliberately: turning enforcement on repo-wide can surface latent
   * violations in the habitat app's existing schema/seeds, so it needs its own
   * validated migration rather than riding in on this sync PR.
   */
  async deferForeignKeys(): Promise<void> {
    this.#database.exec("PRAGMA defer_foreign_keys = ON");
  }
}

export class NodeSqliteAdapter implements TransactableStorageAdapter, ConstraintDeferringAdapter {
  readonly #config: NodeSqliteConfig;
  #db: DatabaseSyncType | null = null;
  #connection: ConnectionAdapter | null = null;
  #queue: Promise<void> = Promise.resolve();

  constructor(config: NodeSqliteConfig = { vfs: { type: "memory" } }) {
    this.#config = config;
  }

  #serialize<T>(fn: () => T | Promise<T>): Promise<T> {
    const operation = this.#queue.then(fn);
    this.#queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  #view(): ConnectionAdapter {
    if (this.#connection === null) {
      throw new Error("NodeSqliteAdapter: call open() before using the adapter.");
    }
    return this.#connection;
  }

  /** Reuse the active connection until close(); all operations are FIFO. */
  open(): Promise<void> {
    return this.#serialize(() => {
      if (this.#db !== null) return;
      const path = this.#config.vfs.type === "memory" ? ":memory:" : this.#config.vfs.filename;
      const db = new DatabaseSync(path);
      this.#db = db;
      this.#connection = new ConnectionAdapter(db);
    });
  }

  exec<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.#serialize(() => this.#view().exec<T>(sql, params));
  }

  put(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    return this.#serialize(() => this.#view().put(table, id, data));
  }

  patch(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
    return this.#serialize(() => this.#view().patch(table, id, patch));
  }

  remove(table: string, id: string): Promise<void> {
    return this.#serialize(() => this.#view().remove(table, id));
  }

  runMigrations(migrations: readonly string[]): Promise<void> {
    return this.#serialize(() => this.#view().runMigrations(migrations));
  }

  deferForeignKeys(): Promise<void> {
    return this.#serialize(() => this.#view().deferForeignKeys());
  }

  /**
   * Exclusive transaction. Inside the callback use only its scoped `tx` handle:
   * calls on the outer adapter wait until this callback commits or rolls back.
   * The scoped handle cannot be used after the callback settles.
   */
  transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    return this.#serialize(async () => {
      this.#view();
      const db = this.#db;
      if (db === null) throw new Error("NodeSqliteAdapter: call open() before using the adapter.");
      const tx = new ConnectionAdapter(db);
      db.exec("BEGIN");
      try {
        const result = await fn(tx);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      } finally {
        tx.expire();
      }
    });
  }

  close(): Promise<void> {
    return this.#serialize(() => {
      if (this.#db === null) return;
      this.#db.close();
      this.#connection?.expire();
      this.#connection = null;
      this.#db = null;
    });
  }
}
