import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import * as schema from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { DbAdapter, WorkerRequestBody } from '~/types/database'

// ─── Connection singleton ─────────────────────────────────────────────────────

const sqliteConn = new SQLiteConnection(CapacitorSQLite)
let _db: SQLiteDBConnection | null = null

function db(): SQLiteDBConnection {
  if (!_db) throw new Error('Native DB not initialized')
  return _db
}

// ─── DbAdapter via raw Capacitor SQLite ──────────────────────────────────────

const adapter: DbAdapter = {
  async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
    const result = await db().query(sql, bind as (string | number | null)[] | undefined)
    return (result.values ?? []) as T[]
  },

  async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
    const result = await db().query(sql, bind as (string | number | null)[] | undefined)
    const rows = (result.values ?? []) as T[]
    return rows[0] ?? null
  },

  async exec(sql: string, bind?: unknown[]): Promise<void> {
    const s = sql.trim().toUpperCase()
    if (s === 'BEGIN' || s === 'BEGIN TRANSACTION') {
      await db().beginTransaction()
      return
    }
    if (s === 'COMMIT') {
      await db().commitTransaction()
      return
    }
    if (s === 'ROLLBACK') {
      await db().rollbackTransaction()
      return
    }
    if (bind && bind.length > 0) {
      await db().run(sql, bind as (string | number | boolean | null)[], false)
    } else {
      await db().execute(sql, false)
    }
  },
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initNativeDb(): Promise<void> {
  _db = await sqliteConn.createConnection('halcyon', false, 'no-encryption', 1, false)
  await _db.open()
  await adapter.exec('PRAGMA foreign_keys = ON')
  await adapter.exec(schema.SCHEMA_DDL)
  await schema.runMigrations(adapter)
  await schema.seedDefaults(adapter)
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchNative(req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'NUKE_OPFS':
      return null
    default: {
      const result = await shared.dispatch(adapter, req)
      if (result === undefined)
        throw new Error(`Unknown request type: ${(req as { type: string }).type}`)
      return result
    }
  }
}
