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

// ─── Low-level helpers ────────────────────────────────────────────────────────

async function queryRaw(sql: string, bind?: unknown[]): Promise<Record<string, unknown>[]> {
  const result = await db().query(sql, bind as (string | number | null)[] | undefined)
  return (result.values ?? []) as Record<string, unknown>[]
}

async function exec(sql: string, bind?: unknown[]): Promise<void> {
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
}

// ─── NativeDbAdapter ──────────────────────────────────────────────────────────
// Wraps the async Capacitor SQLite API to satisfy the DbAdapter interface
// shared with the web worker path.

class NativeDbAdapter implements DbAdapter {
  async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
    return queryRaw(sql, bind) as Promise<T[]>
  }

  async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
    const rows = await queryRaw(sql, bind)
    return rows.length > 0 ? (rows[0] as T) : null
  }

  async exec(sql: string, bind?: unknown[]): Promise<void> {
    return exec(sql, bind)
  }
}

const adapter = new NativeDbAdapter()

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initNativeDb(): Promise<void> {
  _db = await sqliteConn.createConnection('habitat', false, 'no-encryption', 1, false)
  await _db.open()
  await exec('PRAGMA foreign_keys = ON')
  await exec(schema.SCHEMA_DDL)
  await schema.runMigrations(adapter)
  await schema.seedDefaults(adapter)
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchNative(req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'NUKE_OPFS':
      return null // no-op on native (no OPFS)
    case 'EXPORT_DB':
      throw new Error('EXPORT_DB not supported on native')
    default: {
      const result = await shared.dispatch(adapter, req)
      if (result === undefined)
        throw new Error(`Unknown request type: ${(req as { type: string }).type}`)
      return result
    }
  }
}
