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
        dbg('habitat-worker', 'init start')
        await storage.open()
        await applySchema(storage, SCHEMA_CONFIG)
        adapter = toDbAdapter(storage)
        dbg('habitat-worker', 'init complete')
      },

      async ping(): Promise<true> {
        return true
      },

      async dispatch(req: WorkerRequestBody): Promise<unknown> {
        switch (req.type) {
          case 'EXPORT_DB':
            return storage.serialize()
          case 'NUKE_OPFS': {
            // Delete ONLY Habitat's OPFS directory. The previous code iterated
            // the origin's OPFS root and removed every entry — on a shared
            // origin that also wipes sibling apps' databases. Scope to our dir.
            //
            // The adapter is intentionally left open here: this flow never
            // closes it, so `dispatch` stays usable afterwards (the no-reload
            // "Wipe only" path). A true in-place wipe that also reclaims the
            // open SAH-pool files needs adapter-level support (`wipeFiles`) and
            // is tracked as a follow-up.
            const root = await navigator.storage.getDirectory()
            await root.removeEntry(OPFS_DIR, { recursive: true }).catch(() => {})
            return null
          }
          default:
            return shared.dispatch(adapter, req)
        }
      },
    }
  },
})
