import { toDbAdapter } from '@palladium/core'
import { BrowserSqliteAdapter } from '@palladium/sqlite-browser'
import { initializeDatabase, resetDatabaseStorage } from '~/lib/db-lifecycle'
import * as shared from '~/lib/db-shared'
import type { WorkerRequest, WorkerResponse } from '~/types/database'

await (async () => {
  // ─── Exclusive lock ───────────────────────────────────────────────────────────
  async function tryAcquireDbLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
      const got = await new Promise<boolean>((resolve) => {
        void navigator.locks.request('halcyon-db', { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false)
            return Promise.resolve()
          }
          resolve(true)
          return new Promise(() => {}) // hold until worker terminates
        })
      })
      if (got) return true
    }
    return false
  }

  const hasLock = await tryAcquireDbLock()
  if (!hasLock) {
    self.postMessage({ type: 'LOCK_UNAVAILABLE' })
    return
  }

  try {
    const storage = new BrowserSqliteAdapter({
      vfs: { type: 'opfs-sah-pool', directory: '/halcyon', filename: '/halcyon.db' },
    })
    await storage.open()

    const adapter = toDbAdapter(storage)

    await initializeDatabase(adapter)

    // ─── Message loop ─────────────────────────────────────────────────────────────

    self.addEventListener('message', async (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      let result: unknown
      try {
        switch (req.type) {
          case 'RESET_DATABASE':
            await resetDatabaseStorage(storage, adapter)
            result = null
            break
          default:
            // shared.dispatch's own default throws on truly unknown types;
            // void-returning ops legitimately resolve to undefined.
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
