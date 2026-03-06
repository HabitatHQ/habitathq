/**
 * StorageAdapter — the single interface all storage backends must implement.
 *
 * The core engine talks to this interface. Implementations include:
 * - SQLite WASM via the Web Worker (browser)
 * - expo-sqlite (React Native)
 * - In-memory adapter (testing)
 */
export interface StorageAdapter {
  /**
   * Execute a SQL statement and return the result rows.
   * Use `?` placeholders for parameters.
   */
  exec<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;

  /**
   * Run numbered SQL migration scripts in order.
   * Each string is a complete SQL statement or multi-statement script.
   */
  runMigrations(migrations: readonly string[]): Promise<void>;

  /** Release all resources held by this adapter. */
  close(): Promise<void>;
}
