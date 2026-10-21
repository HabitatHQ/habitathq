import {
  applySchema,
  type BlobAdapter,
  createEngine,
  dbg,
  IDBBlobAdapter,
  isSyncRow,
  type SchemaMap,
  SyncTransport,
  type TransactableStorageAdapter,
} from '@palladium/core'
import { migrateLegacyIds } from '~/lib/db-identity'
import { SCHEMA_CONFIG } from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import { HABITAT_TABLES, toHabitatDatabase } from '~/lib/palladium-database'
import type { WorkerRequestBody } from '~/types/database'
import { logError } from '~/utils/error'

export interface HabitatBackendOptions {
  serverUrl?: string
  invalidate?: (tables: readonly string[]) => void
  blobs?: BlobAdapter
  fetch?: typeof globalThis.fetch
}

async function migrateOwnedBlobs(
  storage: TransactableStorageAdapter,
  external?: BlobAdapter,
): Promise<void> {
  if (external) return migrateLegacyIds(storage, external)
  const blobs = new IDBBlobAdapter('habitat-blobs')
  try {
    await migrateLegacyIds(storage, blobs)
  } finally {
    await blobs.dispose()
  }
}

/** One engine, durable outbox, and transport per database owner (web or native). */
export async function createHabitatBackend(
  storage: TransactableStorageAdapter,
  options: HabitatBackendOptions = {},
) {
  const engine = createEngine<SchemaMap>(storage)
  let transport: SyncTransport<SchemaMap> | undefined
  let stopInvalidating: (() => void) | undefined
  let closed = false
  try {
    await engine.init(SCHEMA_CONFIG)
    await storage.exec('PRAGMA foreign_keys = ON')
    await migrateOwnedBlobs(storage, options.blobs)
    const database = toHabitatDatabase(engine)
    // Register the durable outbox even when sync is disabled or the server is offline.
    transport = new SyncTransport(engine, {
      serverUrl: options.serverUrl ?? 'http://localhost',
      requestTimeoutMs: 5_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
    stopInvalidating = engine.on('tables:changed', (tables) => options.invalidate?.(tables))

    // Existing remote edits take precedence over pristine defaults on a new
    // device. The request deadline still permits offline startup.
    if (options.serverUrl) await transport.poll()

    async function captureUntrackedRows(): Promise<void> {
      for (const table of HABITAT_TABLES) {
        while (true) {
          const rows = await database.queryAll<Record<string, unknown>>(
            `SELECT t.* FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM _sync_row_meta m WHERE m.tbl = ? AND m.row_id = t.id) LIMIT 50`,
            [table],
          )
          if (!rows.length) break
          await engine.tx((tx) => {
            for (const row of rows) {
              if (!isSyncRow(row)) throw new TypeError(`Invalid legacy row in ${table}`)
              tx.insert(table, row)
            }
          })
        }
      }
    }

    // Capture existing rows once. Sync metadata doubles as a durable backfill checkpoint.
    // Each batch is bounded and commits with its outbox entry, so crashes cannot lose rows.
    await captureUntrackedRows()
    if (options.serverUrl) {
      // Continue uplink and polling in the background after initial hydration.
      void transport.start().catch((error) => {
        if (!closed) {
          engine.setStatus('degraded')
          logError('habitat-sync/start', error)
        }
      })
    }

    let queue: Promise<void> = Promise.resolve()
    return {
      engine,
      transport,
      dispatch(req: WorkerRequestBody): Promise<unknown> {
        const result = queue.then(async () => {
          if (closed) throw new Error('Habitat database is closed')
          if (req.type === 'EXPORT_DB') {
            if (!('serialize' in storage) || typeof storage.serialize !== 'function')
              throw new Error('EXPORT_DB not supported on native')
            const serialize = storage.serialize.bind(storage)
            return engine.withStorage(() => serialize())
          }
          if (req.type === 'RESET_DATABASE') {
            // Replicate erasure. Physical deletion would discard the outbox and rehydrate old server data.
            await database.transaction(async (db) => {
              for (const table of [...HABITAT_TABLES].reverse()) await db.deleteWhere(table)
            })
            // Reset seed bookkeeping, restore default rows immediately, and capture
            // those rows in the outbox rather than waiting for a reload.
            await engine.withStorage(async (adapter) => {
              await adapter.exec('DELETE FROM applied_defaults')
              await adapter.exec('DELETE FROM _palladium_seeds')
              await applySchema(adapter, SCHEMA_CONFIG)
            })
            await migrateOwnedBlobs(storage, options.blobs)
            await captureUntrackedRows()
            return null
          }
          return shared.dispatch(database, req)
        })
        queue = result.then(
          () => undefined,
          () => undefined,
        )
        return result
      },
      async syncNow() {
        if (!options.serverUrl) return
        await transport?.syncOnce()
      },
      getSyncInfo() {
        return {
          enabled: Boolean(options.serverUrl),
          status: engine.getSyncStatus(),
          error: transport?.lastError ?? null,
        }
      },
      async close() {
        closed = true
        // An in-flight local transaction still needs its durable outbox checkpoint.
        await queue
        await transport?.dispose()
        stopInvalidating?.()
        await storage.close()
        dbg('habitat-sync', 'closed')
      },
    }
  } catch (error) {
    await transport?.dispose()
    stopInvalidating?.()
    await storage.close()
    throw error
  }
}

export type HabitatBackend = Awaited<ReturnType<typeof createHabitatBackend>>
