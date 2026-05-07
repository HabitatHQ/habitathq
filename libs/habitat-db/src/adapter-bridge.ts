/**
 * Bridge functions that wrap a palladium StorageAdapter to satisfy the
 * shared `DbAdapter` interface used by every app's `db-shared.ts`.
 */
import type { StorageAdapter } from '@palladium/core'
import type { DbAdapter } from './types.js'

/** Wrap a StorageAdapter (e.g. SahPoolAdapter) as a DbAdapter. */
export function toDbAdapter(storage: StorageAdapter): DbAdapter {
  return {
    async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
      return storage.exec<T>(sql, bind)
    },
    async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
      const rows = await storage.exec<T>(sql, bind)
      return rows[0] ?? null
    },
    async exec(sql: string, bind?: unknown[]): Promise<void> {
      await storage.exec(sql, bind)
    },
  }
}

/**
 * Wrap a CapacitorSqliteAdapter (or any StorageAdapter) as a DbAdapter,
 * intercepting `BEGIN`/`COMMIT`/`ROLLBACK` to route through Capacitor's
 * dedicated transaction API. Capacitor SQLite doesn't accept those
 * statements as raw SQL — they must go through beginTransaction /
 * commitTransaction / rollbackTransaction.
 */
export function toCapacitorDbAdapter(
  storage: StorageAdapter,
  txControl: {
    beginTransaction: () => Promise<void>
    commitTransaction: () => Promise<void>
    rollbackTransaction: () => Promise<void>
  },
): DbAdapter {
  return {
    async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
      return storage.exec<T>(sql, bind)
    },
    async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
      const rows = await storage.exec<T>(sql, bind)
      return rows[0] ?? null
    },
    async exec(sql: string, bind?: unknown[]): Promise<void> {
      const s = sql.trim().toUpperCase()
      if (s === 'BEGIN') {
        await txControl.beginTransaction()
        return
      }
      if (s === 'COMMIT') {
        await txControl.commitTransaction()
        return
      }
      if (s === 'ROLLBACK') {
        await txControl.rollbackTransaction()
        return
      }
      await storage.exec(sql, bind)
    },
  }
}
