/**
 * StorageAdapter — the single interface all storage backends must implement.
 *
 * Implementations include:
 * - @palladium/sqlite-node  (Node.js, node:sqlite)
 * - @palladium/sqlite-browser (browser, @sqlite.org/sqlite-wasm)
 * - @palladium/sqlite-capacitor (Capacitor, coming soon)
 * - @palladium/sqlite-expo (Expo, coming soon)
 */

/** Value types natively supported by SQLite. */
export type SqlValue = string | number | bigint | boolean | null;

export interface StorageAdapter {
  /** Open (or create) the underlying database. Must be called before any other method. */
  open(): Promise<void>;

  /**
   * Execute a SQL statement and return the result rows.
   * Use `?` placeholders for parameters.
   */
  exec<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;

  /** Insert or replace a row by id. */
  put(table: string, id: string, data: Record<string, unknown>): Promise<void>;

  /** Partially update an existing row. No-op if the row does not exist. */
  patch(table: string, id: string, patch: Record<string, unknown>): Promise<void>;

  /** Delete a row by id. */
  remove(table: string, id: string): Promise<void>;

  /**
   * Run SQL migration scripts in order.
   * Each string is a complete SQL statement or multi-statement script.
   */
  runMigrations(migrations: readonly string[]): Promise<void>;

  /** Release all resources held by this adapter. */
  close(): Promise<void>;
}

/**
 * Optional extension for adapters that support atomic transactions.
 * Use `isTransactable()` to check at runtime before calling `transaction()`.
 */
export interface TransactableStorageAdapter extends StorageAdapter {
  /**
   * Execute `fn` inside a database transaction.
   * On success the transaction is committed; on error it is rolled back.
   * The `tx` argument passed to `fn` is scoped to the transaction.
   */
  transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T>;
}

/** Type guard — true when `a` implements `TransactableStorageAdapter`. */
export function isTransactable(a: StorageAdapter): a is TransactableStorageAdapter {
  return "transaction" in a && typeof (a as TransactableStorageAdapter).transaction === "function";
}

/**
 * Optional capability: defer foreign-key constraint enforcement to the end of
 * the current transaction. This lets the engine apply a change whose ops touch
 * a child before its parent (or delete a parent before its child) within one
 * atomic change without tripping a mid-transaction FK violation — the
 * constraint is still enforced, just at COMMIT (`G4`/`D2a`).
 *
 * Keeping this behind a capability keeps `@palladium/core` storage-agnostic
 * (`D2c`): the engine calls the hook when present and gets immediate
 * enforcement otherwise; the SQLite adapters implement it as
 * `PRAGMA defer_foreign_keys`.
 */
export interface ConstraintDeferringAdapter extends StorageAdapter {
  /**
   * Within an open transaction, defer FK checks until COMMIT. Must be called
   * inside a transaction; a no-op (or harmless) outside one.
   */
  deferForeignKeys(): Promise<void>;
}

/** Type guard — true when `a` can defer FK constraint checks to commit. */
export function supportsConstraintDeferral(a: StorageAdapter): a is ConstraintDeferringAdapter {
  return (
    "deferForeignKeys" in a &&
    typeof (a as ConstraintDeferringAdapter).deferForeignKeys === "function"
  );
}
