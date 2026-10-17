/**
 * Habitat's dedicated database worker.
 *
 * The multi-tab ownership, leader election, failover, and RPC transport all
 * live in `@palladium/worker`. This file only describes Habitat's *service*:
 * open the OPFS database and answer `WorkerRequestBody` dispatches. Exactly one
 * tab (the leader) opens the DB; every other tab forwards its calls to the
 * leader and takes over automatically if the leader goes away.
 */

import { dbg } from '@palladium/core'
import { BrowserSqliteAdapter } from '@palladium/sqlite-browser'
import { startDbOwner } from '@palladium/worker/owner'
import { createHabitatBackend, type HabitatBackend } from '~/lib/habitat-backend'
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
  syncNow(): Promise<void>
  getSyncInfo(): Promise<ReturnType<HabitatBackend['getSyncInfo']>>
}

startDbOwner<HabitatService>({
  dbName: 'habitat',
  methods: ['ping', 'dispatch', 'getSyncInfo', 'syncNow'],
  create(context) {
    const storage = new BrowserSqliteAdapter({
      vfs: { type: 'opfs-sah-pool', directory: `/${OPFS_DIR}`, filename: '/habitat.db' },
    })
    let backend: HabitatBackend | undefined

    return {
      async open(): Promise<void> {
        const startedAt = Date.now()
        dbg('habitat-worker', 'init start', { opfsDirectory: OPFS_DIR })
        backend = await createHabitatBackend(storage, {
          ...(import.meta.env.DEV
            ? { serverUrl: new URL('/api/palladium', self.location.origin).href }
            : {}),
          invalidate: context.invalidate,
        })
        dbg('habitat-worker', 'init complete', { elapsedMs: Date.now() - startedAt })
      },

      async ping(): Promise<true> {
        return true
      },

      async close(): Promise<void> {
        if (backend) await backend.close()
        else await storage.close()
      },

      async syncNow() {
        if (!backend) throw new Error('Database is not open')
        await backend.syncNow()
      },

      async getSyncInfo() {
        if (!backend) throw new Error('Database is not open')
        return backend.getSyncInfo()
      },

      async dispatch(req: WorkerRequestBody): Promise<unknown> {
        if (!backend) throw new Error('Database is not open')
        return backend.dispatch(req)
      },
    }
  },
  onDiagnostic(diagnostic) {
    dbg('habitat-worker-bus', diagnostic.event, { ...diagnostic })
  },
})
