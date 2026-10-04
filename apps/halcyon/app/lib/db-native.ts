import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { toCapacitorDbAdapter } from '@palladium/core'
import { CapacitorSqliteAdapter } from '@palladium/sqlite-capacitor'
import { initializeDatabase, resetDatabaseStorage } from '~/lib/db-lifecycle'
import * as shared from '~/lib/db-shared'
import type { WorkerRequestBody } from '~/types/database'

const sqliteConn = new SQLiteConnection(CapacitorSQLite)
const storage = new CapacitorSqliteAdapter(sqliteConn, {
  dbName: 'halcyon',
  blobBindingFormat: Capacitor.getPlatform() === 'android' ? 'android-buffer' : 'byte-array',
})
const adapter = toCapacitorDbAdapter(storage, storage)

export async function initNativeDb(): Promise<void> {
  await storage.open()
  await initializeDatabase(adapter)
}

export async function dispatchNative(req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'RESET_DATABASE':
      await resetDatabaseStorage(storage, adapter)
      return null
    default:
      return shared.dispatch(adapter, req)
  }
}
