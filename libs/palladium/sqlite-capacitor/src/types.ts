/**
 * Minimal structural interfaces for the @capacitor-community/sqlite API.
 *
 * The real SQLiteConnection from @capacitor-community/sqlite satisfies these
 * interfaces via duck typing, so no direct dependency on that package is
 * required. Pass a real SQLiteConnection in production Capacitor apps, or a
 * compatible shim (e.g. the one in packages/example-capacitor) for Electron
 * testing.
 */

export interface CapSQLiteValues {
  values?: Record<string, unknown>[];
}

export interface CapSQLiteChanges {
  changes?: { changes?: number; lastId?: number } | null;
  message?: string;
}

export interface CapSQLiteResult {
  result?: boolean;
  message?: string;
}

/** Structural type for SQLiteDBConnection from @capacitor-community/sqlite. */
export interface SQLiteDBConnection {
  open(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<CapSQLiteValues>;
  run(sql: string, values?: unknown[], transaction?: boolean): Promise<CapSQLiteChanges>;
  execute(sql: string, transaction?: boolean): Promise<CapSQLiteChanges>;
  beginTransaction(): Promise<CapSQLiteChanges>;
  commitTransaction(): Promise<CapSQLiteChanges>;
  rollbackTransaction(): Promise<CapSQLiteChanges>;
}

/** Structural type for SQLiteConnection from @capacitor-community/sqlite. */
export interface SQLiteConnection {
  checkConnectionsConsistency(): Promise<CapSQLiteResult>;
  isConnection(dbName: string, readonly: boolean): Promise<CapSQLiteResult>;
  createConnection(
    dbName: string,
    encrypted: boolean,
    mode: string,
    version: number,
    readonly: boolean,
  ): Promise<SQLiteDBConnection>;
  retrieveConnection(dbName: string, readonly: boolean): Promise<SQLiteDBConnection>;
  closeConnection(dbName: string, readonly: boolean): Promise<void>;
}
