import {
  type PalladiumEngine,
  type SchemaMap,
  type StorageAdapter,
  toDbAdapter,
} from '@palladium/core'
import { forgetRowMetadata, untrackedRows } from '~/lib/palladium-local-state'
import {
  CAPTURED_TABLES,
  clearCapturedChanges,
  collectCapturedChanges,
  installChangeCapture,
} from '~/lib/sql-change-capture'
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

export interface PalladiumDatabase extends DbAdapter {
  replaceTransaction<T>(work: (tx: DbAdapter) => Promise<T>): Promise<T>
}

/** Every SQL script, including statements with RETURNING, shares engine transaction ownership. */
export async function createPalladiumDatabase(
  engine: PalladiumEngine<SchemaMap>,
): Promise<PalladiumDatabase> {
  await engine.withStorage(installChangeCapture)

  function transaction<T>(work: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return engine.captureLocal(async (storage) => {
      await clearCapturedChanges(storage)
      const result = await work(toAppDbAdapter(storage, false))
      const ops = await collectCapturedChanges(storage)
      return { result, ops }
    })
  }

  return {
    queryAll: <T>(sql: string, bind?: unknown[]) => transaction((tx) => tx.queryAll<T>(sql, bind)),
    queryOne: <T>(sql: string, bind?: unknown[]) => transaction((tx) => tx.queryOne<T>(sql, bind)),
    exec: (sql, bind) => transaction((tx) => tx.exec(sql, bind)),
    transaction,
    replaceTransaction: <T>(work: (tx: DbAdapter) => Promise<T>) =>
      engine.captureLocal(async (storage) => {
        await clearCapturedChanges(storage)
        await forgetRowMetadata(storage)
        const result = await work(toAppDbAdapter(storage, false))
        const ops = await collectCapturedChanges(storage)
        const net = new Map(ops.map((op) => [`${op.table}\0${op.id}`, op]))
        // Replace restores may retain identical rows whose prior metadata was forgotten.
        // Admit full remaining rows in the same commit, including unchanged columns.
        for (const table of CAPTURED_TABLES) {
          for (const op of await untrackedRows(storage, table)) {
            net.set(`${op.table}\0${op.id}`, op)
          }
        }
        return { result, ops: [...net.values()] }
      }),
  }
}
