// Native Capacitor SQLite stub — mirrors database.worker.ts operations.
// Fully implement when adding native builds.
import type { WorkerRequestBody } from '~/types/database'

export async function initNativeDb(): Promise<void> {
  throw new Error('Native DB not yet implemented. Use PWA build.')
}

export function dispatchNative(_req: WorkerRequestBody): Promise<unknown> {
  return Promise.reject(new Error('Native DB not yet implemented.'))
}
