// Capacitor SQLite mirror — native platform path.
// This file mirrors database.worker.ts operations using @capacitor-community/sqlite
// instead of the WASM worker. For now it delegates to the web worker approach
// to unblock development; native implementation follows the same pattern as Habitat.

import type { WorkerRequestBody } from '~/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null

export async function initNativeDb(): Promise<void> {
  const { CapacitorSQLite } = await import('@capacitor-community/sqlite')
  await CapacitorSQLite.createConnection({
    database: 'halcyon',
    version: 1,
    encrypted: false,
    mode: 'no-encryption',
    readonly: false,
  })
  await CapacitorSQLite.open({ database: 'halcyon' })
  _db = CapacitorSQLite
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dispatchNative(_req: WorkerRequestBody): Promise<any> {
  // TODO: Implement native SQLite mirror matching database.worker.ts operations.
  // This is a stub that will be implemented in a follow-up iteration.
  throw new Error('Native DB dispatch not yet implemented — use PWA build for development')
}
