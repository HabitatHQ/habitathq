import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { applySchema, dbg, toCapacitorDbAdapter } from '@palladium/core'
import { CapacitorSqliteAdapter } from '@palladium/sqlite-capacitor'
import { SCHEMA_CONFIG } from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { WorkerRequestBody } from '~/types/database'

// ─── Adapter singleton ─────────────────────────────────────────────────────

const sqliteConn = new SQLiteConnection(CapacitorSQLite)
const storage = new CapacitorSqliteAdapter(sqliteConn, { dbName: 'habitat' })
const adapter = toCapacitorDbAdapter(storage, storage)

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initNativeDb(): Promise<void> {
  dbg('habitat-native', 'init start')
  await storage.open()
  await storage.exec('PRAGMA foreign_keys = ON')
  await applySchema(storage, SCHEMA_CONFIG)
  dbg('habitat-native', 'init complete')
}

// ─── Reset (Capacitor) ────────────────────────────────────────────────────────

async function resetNativeDb(): Promise<void> {
  await storage.close()
  await CapacitorSQLite.deleteDatabase({ database: 'habitat' })
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchNative(req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'NUKE_OPFS':
      await resetNativeDb()
      return null
    case 'EXPORT_DB':
      throw new Error('EXPORT_DB not supported on native')
    default:
      return shared.dispatch(adapter, req)
  }
}
