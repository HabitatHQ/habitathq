/**
 * Simplified query interface implemented by both web and native paths.
 * App-level `db-shared.ts` files speak only this interface so domain
 * SQL works identically across environments.
 */
import type { StorageAdapter } from "./storage.js";

export interface DbAdapter {
  queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null>;
  exec(sql: string, bind?: unknown[]): Promise<void>;
}

/** Wrap a StorageAdapter (e.g. BrowserSqliteAdapter) as a DbAdapter. */
export function toDbAdapter(storage: StorageAdapter): DbAdapter {
  return {
    async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
      return storage.exec<T>(sql, bind);
    },
    async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
      const rows = await storage.exec<T>(sql, bind);
      return rows[0] ?? null;
    },
    async exec(sql: string, bind?: unknown[]): Promise<void> {
      await storage.exec(sql, bind);
    },
  };
}

/**
 * Wrap a StorageAdapter as a DbAdapter, intercepting BEGIN/COMMIT/ROLLBACK
 * to route through a dedicated transaction API. Capacitor SQLite doesn't
 * accept those statements as raw SQL.
 */
export function toCapacitorDbAdapter(
  storage: StorageAdapter,
  txControl: {
    beginTransaction: () => Promise<void>;
    commitTransaction: () => Promise<void>;
    rollbackTransaction: () => Promise<void>;
  },
): DbAdapter {
  return {
    async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
      return storage.exec<T>(sql, bind);
    },
    async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
      const rows = await storage.exec<T>(sql, bind);
      return rows[0] ?? null;
    },
    async exec(sql: string, bind?: unknown[]): Promise<void> {
      const s = sql.trim().toUpperCase();
      if (s === "BEGIN") {
        await txControl.beginTransaction();
        return;
      }
      if (s === "COMMIT") {
        await txControl.commitTransaction();
        return;
      }
      if (s === "ROLLBACK") {
        await txControl.rollbackTransaction();
        return;
      }
      await storage.exec(sql, bind);
    },
  };
}
