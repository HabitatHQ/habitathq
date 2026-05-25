import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { applySchema, dbg, toCapacitorDbAdapter } from '@palladium/core'
import { CapacitorSqliteAdapter } from '@palladium/sqlite-capacitor'
import { SCHEMA_CONFIG } from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { WorkerRequestBody } from '~/types/database'

// ─── Adapter singleton ─────────────────────────────────────────────────────

const sqliteConn = new SQLiteConnection(CapacitorSQLite)
const storage = new CapacitorSqliteAdapter(sqliteConn, { dbName: 'hearth' })
const adapter = toCapacitorDbAdapter(storage, storage)

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initNativeDb(): Promise<void> {
  dbg('hearth-native', 'init start')
  await storage.open()
  await storage.exec('PRAGMA foreign_keys = ON')
  await applySchema(storage, SCHEMA_CONFIG)
  dbg('hearth-native', 'init complete')
}

// ─── Reset (Capacitor) ────────────────────────────────────────────────────────

async function resetNativeDb(): Promise<void> {
  await storage.close()
  await CapacitorSQLite.deleteDatabase({ database: 'hearth' })
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchNative(req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'NUKE_OPFS':
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
      return shared.dispatch(adapter, req)
  }
}
