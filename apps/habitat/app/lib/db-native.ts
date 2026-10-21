import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { dbg } from '@palladium/core'
import { CapacitorSqliteAdapter } from '@palladium/sqlite-capacitor'
import { createHabitatBackend, type HabitatBackend } from '~/lib/habitat-backend'
import type { WorkerRequestBody } from '~/types/database'

// ─── Adapter singleton ─────────────────────────────────────────────────────

const sqliteConn = new SQLiteConnection(CapacitorSQLite)
const storage = new CapacitorSqliteAdapter(sqliteConn, {
  dbName: 'habitat',
  blobBindingFormat: Capacitor.getPlatform() === 'android' ? 'android-buffer' : 'byte-array',
})
let backend: HabitatBackend | undefined

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initNativeDb(): Promise<void> {
  dbg('habitat-native', 'init start')
  backend ??= await createHabitatBackend(storage)
  dbg('habitat-native', 'init complete')
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchNative(req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'EXPORT_DB':
      throw new Error('EXPORT_DB not supported on native')
    default:
      if (!backend) throw new Error('Database is not open')
      return backend.dispatch(req)
  }
}
