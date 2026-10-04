import type { BlobAdapter, BlobAdapterOptions, BlobStoreLifecycle } from "./blob-adapter.js";
import type { DbAdapter } from "./db-adapter.js";
import type { StorageAdapter } from "./storage.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Configuration for SQLite-backed binary storage. */
export type SqliteBlobAdapterOptions = {
  readonly table: string;
} & (
  | { readonly namespace: string }
  | {
      /** Existing app-owned table; metadata rows must exist before writing bytes. */
      readonly columns: { readonly id: string; readonly data: string };
    }
);

/** SQLite BLOB backend. Supply transaction-scoped options to couple changes atomically. */
export class SqliteBlobAdapter implements BlobAdapter, BlobStoreLifecycle {
  readonly #storage: StorageAdapter | DbAdapter;
  readonly #table: string;
  readonly #namespace: string | null;
  readonly #idColumn: string;
  readonly #dataColumn: string;
  #disposed = false;
  #ready: Promise<void> | null = null;

  constructor(storage: StorageAdapter | DbAdapter, options: SqliteBlobAdapterOptions) {
    assertIdentifier(options.table, "table");
    this.#storage = storage;
    this.#table = options.table;
    if ("namespace" in options) {
      if (!options.namespace) throw new TypeError("Blob namespace must not be empty");
      this.#namespace = options.namespace;
      this.#idColumn = "id";
      this.#dataColumn = "data";
    } else {
      assertIdentifier(options.columns.id, "id column");
      assertIdentifier(options.columns.data, "data column");
      this.#namespace = null;
      this.#idColumn = options.columns.id;
      this.#dataColumn = options.columns.data;
    }
  }

  async put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const db = this.#database(options);
    await this.#ensureTable(db, options?.transaction !== undefined);
    if (this.#namespace === null) {
      const rows = await this.#query(
        db,
        `SELECT 1 FROM "${this.#table}" WHERE "${this.#idColumn}" = ?`,
        [id],
      );
      if (rows.length === 0) throw new Error("Create media metadata before writing its bytes");
      await db.exec(
        `UPDATE "${this.#table}" SET "${this.#dataColumn}" = ? WHERE "${this.#idColumn}" = ?`,
        [bytes, id],
      );
      return;
    }
    await db.exec(
      `INSERT INTO "${this.#table}" (namespace, id, data) VALUES (?, ?, ?)
       ON CONFLICT (namespace, id) DO UPDATE SET data = excluded.data`,
      [this.#namespace, id, bytes],
    );
  }

  async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    options?.signal?.throwIfAborted();
    const db = this.#database(options);
    await this.#ensureTable(db, options?.transaction !== undefined);
    const rows = await this.#query<{ data: Uint8Array | number[] | null }>(
      db,
      `SELECT "${this.#dataColumn}" AS data FROM "${this.#table}" WHERE ${this.#where()}`,
      this.#bindings(id),
    );
    const data = rows[0]?.data;
    if (data === undefined || data === null) return null;
    if (data instanceof Uint8Array) return data;
    if (Array.isArray(data)) {
      for (const byte of data) {
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
          throw new TypeError("SQLite blob driver returned an invalid byte array");
        }
      }
      return Uint8Array.from(data);
    }
    throw new TypeError("SQLite blob driver returned a non-binary BLOB value");
  }

  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const db = this.#database(options);
    await this.#ensureTable(db, options?.transaction !== undefined);
    await db.exec(`DELETE FROM "${this.#table}" WHERE ${this.#where()}`, this.#bindings(id));
  }

  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    const db = this.#database(options);
    await this.#ensureTable(db, options?.transaction !== undefined);
    const rows = await this.#query(
      db,
      `SELECT 1 AS found FROM "${this.#table}" WHERE ${this.#where()} LIMIT 1`,
      this.#bindings(id),
    );
    return rows.length > 0;
  }

  async clear(options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const db = this.#database(options);
    await this.#ensureTable(db, options?.transaction !== undefined);
    await db.exec(
      `DELETE FROM "${this.#table}"${this.#namespace === null ? "" : " WHERE namespace = ?"}`,
      this.#namespace === null ? [] : [this.#namespace],
    );
  }

  /** Release this adapter's logical ownership; shared database remains open. */
  async dispose(): Promise<void> {
    this.#disposed = true;
  }

  #database(options?: BlobAdapterOptions): StorageAdapter | DbAdapter {
    if (this.#disposed) throw new Error("SqliteBlobAdapter has been disposed");
    return options?.transaction ?? this.#storage;
  }

  #where(): string {
    return this.#namespace === null
      ? `"${this.#idColumn}" = ?`
      : `namespace = ? AND "${this.#idColumn}" = ?`;
  }

  #bindings(id: string): unknown[] {
    return this.#namespace === null ? [id] : [this.#namespace, id];
  }

  #query<T = Record<string, unknown>>(
    db: StorageAdapter | DbAdapter,
    sql: string,
    bind: unknown[],
  ): Promise<T[]> {
    return "queryAll" in db ? db.queryAll<T>(sql, bind) : db.exec<T>(sql, bind);
  }

  #ensureTable(db: StorageAdapter | DbAdapter, transactional: boolean): Promise<void> {
    if (this.#namespace === null) return Promise.resolve();
    if (!transactional) {
      this.#ready ??= this.#createTable(db).catch((error: unknown) => {
        this.#ready = null;
        throw error;
      });
      return this.#ready;
    }
    // Transactional DDL may roll back even when its executor is this.#storage;
    // never cache that table as ready beyond the caller's transaction.
    return this.#createTable(db);
  }

  async #createTable(db: StorageAdapter | DbAdapter): Promise<void> {
    await db.exec(
      `CREATE TABLE IF NOT EXISTS "${this.#table}" (
        namespace TEXT NOT NULL,
        id TEXT NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (namespace, id)
      )`,
    );
  }
}

function assertIdentifier(value: string, field: string): void {
  if (!IDENTIFIER.test(value) || value.toLowerCase().startsWith("sqlite_")) {
    throw new TypeError(`Invalid SQLite blob ${field} identifier: ${JSON.stringify(value)}`);
  }
}
