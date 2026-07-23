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
      vfs: { type: 'opfs-sah-pool', directory: '/habitat', filename: '/habitat.db' },
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
            const root = await navigator.storage.getDirectory()
            // biome-ignore lint/suspicious/noTsIgnore: tsgo and vue-tsc disagree on FileSystemDirectoryHandle iterability
            // @ts-ignore — async-iterable at runtime but not in all lib.dom typings
            for await (const [name] of root) {
              await root.removeEntry(name, { recursive: true }).catch(() => {})
            }
            return null
          }
          default:
            return shared.dispatch(adapter, req)
        }
      },
    }
  },
})
