import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import * as schema from '~/lib/db-schema'
import type { DbAdapter } from '~/types/database'

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
    if (s === 'BEGIN') {
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
  _db = await sqliteConn.createConnection('hephaestus', false, 'no-encryption', 1, false)
  await _db.open()
  await adapter.exec('PRAGMA foreign_keys = ON')
  await adapter.exec(schema.SCHEMA_DDL)
  await schema.runMigrations(adapter)
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchNative(req: unknown): Promise<unknown> {
  const { type, payload } = req as { type: string; payload?: unknown }
  switch (type) {
    case 'NUKE_OPFS':
      return null
    case 'EXPORT_DB':
      throw new Error('EXPORT_DB not supported on native')
    case 'QUERY': {
      const { sql, bind } = payload as { sql: string; bind?: unknown[] }
      return adapter.queryAll(sql, bind)
    }
    case 'EXEC': {
      const { sql, bind } = payload as { sql: string; bind?: unknown[] }
      await adapter.exec(sql, bind)
      return null
    }
    case 'IS_DEFAULT_APPLIED': {
      const { key } = payload as { key: string }
      const row = await adapter.queryOne('SELECT key FROM applied_defaults WHERE key = ?', [key])
      return row !== null
    }
    case 'MARK_DEFAULT_APPLIED': {
      const { key } = payload as { key: string }
      await adapter.exec('INSERT OR IGNORE INTO applied_defaults (key) VALUES (?)', [key])
      return null
    }
    default:
      throw new Error(`Unknown request type: ${type}`)
  }
}
