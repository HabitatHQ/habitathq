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
  _db = await sqliteConn.createConnection('hearth', false, 'no-encryption', 1, false)
  await _db.open()
  await adapter.exec('PRAGMA foreign_keys = ON')
  // PRAGMA journal_mode returns the new mode as a row, which Capacitor
  // SQLite's execute() (Android execSQL) rejects with "Queries can be
  // performed using SQLiteDatabase query or rawQuery methods only".
  // Habitat doesn't set this; SQLite falls back to rollback journal — fine.
  await adapter.exec(schema.SCHEMA_DDL)
  await schema.runMigrations(adapter)
}

// ─── Reset (Capacitor) ────────────────────────────────────────────────────────

async function resetNativeDb(): Promise<void> {
  if (_db) {
    await _db.close()
    _db = null
  }
  await sqliteConn.closeConnection('hearth', false)
  await CapacitorSQLite.deleteDatabase({ database: 'hearth' })
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchNative(req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'NUKE_OPFS':
      // Same UX as web: wipe everything. The page reloads after this and
      // initNativeDb() runs again from scratch.
      await resetNativeDb()
      return null
    case 'EXPORT_DB':
      throw new Error('EXPORT_DB not supported on native')
    case 'EXPORT_JSON':
      return {
        version: '1.0',
        exported_at: new Date().toISOString(),
        users: await adapter.queryAll('SELECT * FROM users'),
        accounts: await adapter.queryAll('SELECT * FROM accounts'),
        categories: await adapter.queryAll('SELECT * FROM categories'),
        transactions: await adapter.queryAll('SELECT * FROM transactions'),
        envelopes: await adapter.queryAll('SELECT * FROM envelopes'),
        envelope_periods: await adapter.queryAll('SELECT * FROM envelope_periods'),
        iou_splits: await adapter.queryAll('SELECT * FROM iou_splits'),
        savings_goals: await adapter.queryAll('SELECT * FROM savings_goals'),
        chores: await adapter.queryAll('SELECT * FROM chores'),
      }
    default:
      // shared.dispatch's own default case throws for truly unknown types;
      // void-returning ops legitimately resolve to undefined, so don't treat
      // that as a missing handler.
      return shared.dispatch(adapter, req)
  }
}
