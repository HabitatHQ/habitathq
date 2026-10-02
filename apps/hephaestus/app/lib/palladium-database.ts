import { type StorageAdapter, toDbAdapter } from '@palladium/core'
import type { DbAdapter } from '~/types/database'

export function toAppDbAdapter(storage: StorageAdapter, transactional = true): DbAdapter {
  const adapter = toDbAdapter(storage)
  return {
    ...adapter,
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      if (
        !transactional ||
        !('transaction' in storage) ||
        typeof storage.transaction !== 'function'
      ) {
        throw new Error('This database transaction is already scoped or unavailable.')
      }
      return storage.transaction((tx: StorageAdapter) => fn(toAppDbAdapter(tx, false)))
    },
  }
}
