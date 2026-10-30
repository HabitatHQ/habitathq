import {
  createEngine,
  isTransactable,
  type SchemaMap,
  type TransactableStorageAdapter,
} from '@palladium/core'
import { createSerialQueue } from '~/lib/database-operations'
import { resetDatabase } from '~/lib/database-reset'
import { HEPHAESTUS_SCHEMA, initializeSchema } from '~/lib/db-schema'
import { createRequestRouter, type HephaestusRequest } from '~/lib/hephaestus-requests'
import { createPalladiumDatabase, toAppDbAdapter } from '~/lib/palladium-database'
import { forgetRowMetadata, untrackedRows } from '~/lib/palladium-local-state'
import { CAPTURED_TABLES, withoutDeleteCapture } from '~/lib/sql-change-capture'
import type { DbAdapter } from '~/types/database'

export type { HephaestusRequest }

export interface HephaestusBackend {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  mutate(sql: string, params?: readonly unknown[]): Promise<number>
  dispatch(request: HephaestusRequest): Promise<unknown>
  close(): Promise<void>
}

interface BackendOptions {
  invalidate?: (tables: readonly string[]) => void
}

/** One local-only engine per elected owner; no transport or network endpoint exists here. */
export async function createHephaestusBackend(
  storage: TransactableStorageAdapter,
  options: BackendOptions = {},
): Promise<HephaestusBackend> {
  const engine = createEngine<SchemaMap>(storage)
  let stopInvalidating: (() => void) | undefined
  const enqueue = createSerialQueue()
  let closed = false
  try {
    await storage.open()
    await storage.exec('PRAGMA foreign_keys = ON')
    await initializeSchema(storage)
    await engine.init(HEPHAESTUS_SCHEMA)
    // Metadata backfill is bounded and does not replay immutable revision rows.
    for (const table of CAPTURED_TABLES) {
      while (
        await engine.captureLocal(async (tx) => {
          const ops = await untrackedRows(tx, table, 100)
          return { result: ops.length > 0, ops }
        })
      ) {
        /* Continue from committed metadata after a crash or owner handoff. */
      }
    }
    const database = await createPalladiumDatabase(engine)
    stopInvalidating = engine.on('tables:changed', (tables) => options.invalidate?.(tables))

    function run<T>(work: () => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(new Error('Hephaestus database is closed'))
      return enqueue(work)
    }

    async function resetLocalDatabase(): Promise<void> {
      // A local-only reset forgets row metadata as well as app data. It must not
      // leave retired seed identities that prevent a later import or reseed.
      await engine.withStorage(async (owned) => {
        if (!isTransactable(owned)) throw new Error('Database reset requires transaction support')
        const resetAdapter: DbAdapter = {
          ...toAppDbAdapter(owned),
          transaction: (work) =>
            owned.transaction(async (transaction) => {
              return withoutDeleteCapture(transaction, async () => {
                const result = await work(toAppDbAdapter(transaction, false))
                await forgetRowMetadata(transaction)
                return result
              })
            }),
        }
        await resetDatabase(resetAdapter)
      })
      options.invalidate?.(CAPTURED_TABLES)
    }

    const route = createRequestRouter({ database, engine, storage, resetLocalDatabase })

    return {
      query<T = Record<string, unknown>>(
        sql: string,
        params: readonly unknown[] = [],
      ): Promise<T[]> {
        return run(() => database.queryAll<T>(sql, [...params]))
      },
      mutate(sql: string, params: readonly unknown[] = []): Promise<number> {
        return run(() =>
          database.transaction(async (tx) => {
            await tx.exec(sql, [...params])
            const result = await tx.queryOne<{ count: number }>('SELECT changes() AS count')
            return result?.count ?? 0
          }),
        )
      },
      dispatch(request: HephaestusRequest): Promise<unknown> {
        return run(() => route(request))
      },
      async close(): Promise<void> {
        if (closed) return
        closed = true
        await enqueue(async () => {
          stopInvalidating?.()
          await storage.close()
        })
      },
    }
  } catch (error) {
    stopInvalidating?.()
    await storage.close()
    throw error
  }
}
