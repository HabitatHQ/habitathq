/**
 * Habitat's dedicated database worker.
 *
 * The multi-tab ownership, leader election, failover, and RPC transport all
 * live in `@palladium/worker`. This file only describes Habitat's *service*:
 * open the OPFS database and answer `WorkerRequestBody` dispatches. Exactly one
 * tab (the leader) opens the DB; every other tab forwards its calls to the
 * leader and takes over automatically if the leader goes away.
 */

import { applySchema, type DbAdapter, dbg, toDbAdapter } from '@palladium/core'
import { BrowserSqliteAdapter } from '@palladium/sqlite-browser'
import { startDbOwner } from '@palladium/worker/owner'
import { SCHEMA_CONFIG } from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { WorkerRequestBody } from '~/types/database'

/**
 * OPFS directory Habitat's SAH-pool database lives under. The origin's OPFS
 * root is shared across the suite (habitat/hearth/halcyon/hephaestus deploy
 * under one origin), so anything touching OPFS must stay scoped to this dir.
 */
const OPFS_DIR = 'habitat'

/** The surface Habitat's main thread calls (via `connect<HabitatService>`). */
export interface HabitatService {
  /** Resolves once a leader has opened the DB — the main thread's readiness probe. */
  ping(): Promise<true>
  /** Run one database request. Handles storage-level ops, delegates the rest. */
  dispatch(req: WorkerRequestBody): Promise<unknown>
}

startDbOwner<HabitatService>({
  dbName: 'habitat',
  methods: ['ping', 'dispatch'],
  create() {
    const storage = new BrowserSqliteAdapter({
      vfs: { type: 'opfs-sah-pool', directory: `/${OPFS_DIR}`, filename: '/habitat.db' },
    })
    let adapter: DbAdapter

    return {
      async open(): Promise<void> {
        const startedAt = Date.now()
        dbg('habitat-worker', 'init start', { opfsDirectory: OPFS_DIR })
        await storage.open()
        dbg('habitat-worker', 'storage open', { elapsedMs: Date.now() - startedAt })
        await applySchema(storage, SCHEMA_CONFIG)
        adapter = toDbAdapter(storage)
        dbg('habitat-worker', 'init complete', { elapsedMs: Date.now() - startedAt })
      },

      async ping(): Promise<true> {
        return true
      },

      async close(): Promise<void> {
        await storage.close()
      },

      async dispatch(req: WorkerRequestBody): Promise<unknown> {
        switch (req.type) {
          case 'EXPORT_DB':
            return storage.serialize()
          case 'RESET_DATABASE':
            await storage.resetStorage()
            await applySchema(storage, SCHEMA_CONFIG)
            return null
          default:
            return shared.dispatch(adapter, req)
        }
      },
    }
  },
  onDiagnostic(diagnostic) {
    dbg('habitat-worker-bus', diagnostic.event, { ...diagnostic })
  },
})
