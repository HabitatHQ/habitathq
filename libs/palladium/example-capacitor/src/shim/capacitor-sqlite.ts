/**
 * Electron shim for @capacitor-community/sqlite.
 *
 * Implements the structural interfaces expected by CapacitorSqliteAdapter using
 * the `window.__sqlite__` API exposed by the Electron preload script via
 * contextBridge. The preload uses node:sqlite (available in Node.js >= 22.5).
 *
 * This file is aliased to "@capacitor-community/sqlite" in vite.config.ts so
 * the renderer bundle never loads the real native Capacitor plugin.
 */

import type {
  CapSQLiteChanges,
  CapSQLiteResult,
  CapSQLiteValues,
} from "@palladium/sqlite-capacitor";
import type { SQLiteDBConnection } from "@palladium/sqlite-capacitor";

interface ElectronSqliteApi {
  open(dbName: string): Promise<void>;
  query(dbName: string, sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  run(dbName: string, sql: string, params: unknown[]): Promise<void>;
  execute(dbName: string, sql: string): Promise<void>;
  beginTx(dbName: string): Promise<void>;
  commitTx(dbName: string): Promise<void>;
  rollbackTx(dbName: string): Promise<void>;
  close(dbName: string): Promise<void>;
}

declare global {
  interface Window {
    __sqlite__: ElectronSqliteApi;
  }
}

function api(): ElectronSqliteApi {
  if (!("__sqlite__" in window)) {
    throw new Error(
      "window.__sqlite__ is not defined. Ensure the Electron preload script is loaded.",
    );
  }
  return window.__sqlite__;
}

class ShimSQLiteDBConnection implements SQLiteDBConnection {
  constructor(private readonly dbName: string) {}

  async open(): Promise<void> {
    await api().open(this.dbName);
  }

  async query(sql: string, values?: unknown[]): Promise<CapSQLiteValues> {
    const rows = await api().query(this.dbName, sql, values ?? []);
    return { values: rows };
  }

  async run(sql: string, values?: unknown[], _transaction?: boolean): Promise<CapSQLiteChanges> {
    await api().run(this.dbName, sql, values ?? []);
    return {};
  }

  async execute(sql: string, _transaction?: boolean): Promise<CapSQLiteChanges> {
    await api().execute(this.dbName, sql);
    return {};
  }

  async beginTransaction(): Promise<CapSQLiteChanges> {
    await api().beginTx(this.dbName);
    return {};
  }

  async commitTransaction(): Promise<CapSQLiteChanges> {
    await api().commitTx(this.dbName);
    return {};
  }

  async rollbackTransaction(): Promise<CapSQLiteChanges> {
    await api().rollbackTx(this.dbName);
    return {};
  }
}

const connections = new Map<string, ShimSQLiteDBConnection>();

export class SQLiteConnection {
  async checkConnectionsConsistency(): Promise<CapSQLiteResult> {
    return { result: true };
  }

  async isConnection(dbName: string, _readonly: boolean): Promise<CapSQLiteResult> {
    return { result: connections.has(dbName) };
  }

  async createConnection(
    dbName: string,
    _encrypted: boolean,
    _mode: string,
    _version: number,
    _readonly: boolean,
  ): Promise<ShimSQLiteDBConnection> {
    const conn = new ShimSQLiteDBConnection(dbName);
    connections.set(dbName, conn);
    return conn;
  }

  async retrieveConnection(dbName: string, _readonly: boolean): Promise<ShimSQLiteDBConnection> {
    const conn = connections.get(dbName);
    if (conn === undefined) {
      throw new Error(`CapacitorSQLite shim: no connection found for database "${dbName}".`);
    }
    return conn;
  }

  async closeConnection(dbName: string, _readonly: boolean): Promise<void> {
    await api().close(dbName);
    connections.delete(dbName);
  }
}

// Stub — the real CapacitorSQLite plugin object is only needed by the
// SQLiteConnection constructor, which ignores it in this shim.
export const CapacitorSQLite = {};
