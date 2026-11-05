import { applySchema, dbg, toDbAdapter } from '@palladium/core'
import { BrowserSqliteAdapter } from '@palladium/sqlite-browser'
import { SCHEMA_CONFIG } from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import { createSerializedDbDispatcher } from '~/lib/worker-helpers'
import type { WorkerRequest, WorkerResponse } from '~/types/database'

const OPFS_DIR = 'hearth'

await (async () => {
  async function tryAcquireDbLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
      const got = await new Promise<boolean>((resolve) => {
        void navigator.locks.request('hearth-db', { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false)
            return Promise.resolve()
          }
          resolve(true)
          return new Promise(() => {})
        })
      })
      if (got) return true
    }
    return new Promise<boolean>((resolve) => {
      void navigator.locks.request('hearth-db', { steal: true }, (lock) => {
        if (!lock) {
          resolve(false)
          return Promise.resolve()
        }
        resolve(true)
        return new Promise(() => {})
      })
    })
  }

  const hasLock = await tryAcquireDbLock()
  if (!hasLock) {
    self.postMessage({ type: 'LOCK_UNAVAILABLE' })
    return
  }

  try {
    dbg('hearth-worker', 'init start')
    const storage = new BrowserSqliteAdapter({
      vfs: { type: 'opfs-sah-pool', directory: `/${OPFS_DIR}`, filename: '/hearth.db' },
    })
    await storage.open()

    // WAL mode for better concurrent read performance (web only)
    await storage.exec('PRAGMA journal_mode = WAL')

    await applySchema(storage, SCHEMA_CONFIG)

    const adapter = toDbAdapter(storage)
    dbg('hearth-worker', 'init complete')

    const executeRequest = createSerializedDbDispatcher(async (req) => {
      switch (req.type) {
        case 'EXPORT_DB':
          return storage.serialize()
        case 'EXPORT_JSON':
          return shared.exportJson(adapter)
        case 'RESET_DATABASE':
          await storage.resetStorage()
          await storage.open()
          await storage.exec('PRAGMA journal_mode = WAL')
          await applySchema(storage, SCHEMA_CONFIG)
          return null
        default:
          return shared.dispatch(adapter, req)
      }
    })

    self.addEventListener('message', async (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      try {
        const result = await executeRequest(req)
        self.postMessage({ id: req.id, ok: true, data: result } satisfies WorkerResponse)
      } catch (err) {
        self.postMessage({
          id: req.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies WorkerResponse)
      }
    })

    self.postMessage({ type: 'READY' })
  } catch (err) {
    self.postMessage({
      type: 'INIT_ERROR',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})()
