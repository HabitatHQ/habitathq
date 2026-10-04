import { applySchema, dbg, toDbAdapter } from '@palladium/core'
import { BrowserSqliteAdapter } from '@palladium/sqlite-browser'
import { SCHEMA_CONFIG } from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { WorkerRequest, WorkerResponse } from '~/types/database'

export const OPFS_DIR = 'hearth'

export async function removeHearthOpfs(): Promise<void> {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(OPFS_DIR, { recursive: true }).catch(() => {})
}

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

    self.addEventListener('message', async (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      let result: unknown
      try {
        switch (req.type) {
          case 'EXPORT_DB':
            result = storage.serialize()
            break
          case 'EXPORT_JSON':
            result = await shared.exportJson(adapter)
            break
          case 'NUKE_OPFS': {
            // The origin's OPFS root is shared by every suite app. Remove only
            // Hearth's directory so resetting Hearth cannot delete sibling data.
            await removeHearthOpfs()
            result = null
            break
          }
          default:
            result = await shared.dispatch(adapter, req)
        }
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
