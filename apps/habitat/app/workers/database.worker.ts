import { SahPoolAdapter, toDbAdapter } from '@habitathq/db'
import * as schema from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { WorkerRequest, WorkerResponse } from '~/types/database'

await (async () => {
  // ─── Exclusive lock ───────────────────────────────────────────────────────────
  // OPFS createSyncAccessHandle only works in dedicated workers. We use Web Locks
  // to detect when another tab already owns the DB and bail out gracefully.
  // Retries handle the brief race when COI service-worker or vite-pwa reloads.

  async function tryAcquireDbLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
      const got = await new Promise<boolean>((resolve) => {
        void navigator.locks.request('habitat-db', { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false)
            return Promise.resolve()
          }
          resolve(true)
          return new Promise(() => {}) // hold until this worker terminates
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
    const storage = new SahPoolAdapter({ directory: '/habitat', filename: '/habitat.db' })
    await storage.open()

    const adapter = toDbAdapter(storage)

    await adapter.exec(schema.SCHEMA_DDL)
    await schema.runMigrations(adapter)
    await schema.seedDefaults(adapter)

    // ─── Message loop ─────────────────────────────────────────────────────────────

    self.addEventListener('message', async (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      let result: unknown
      try {
        switch (req.type) {
          case 'EXPORT_DB':
            result = storage.serialize()
            break
          case 'NUKE_OPFS': {
            const root = await navigator.storage.getDirectory()
            // biome-ignore lint/suspicious/noTsIgnore: tsgo and vue-tsc disagree on FileSystemDirectoryHandle iterability
            // @ts-ignore — async-iterable at runtime but not in all lib.dom typings
            for await (const [name] of root) {
              await root.removeEntry(name, { recursive: true }).catch(() => {})
            }
            result = null
            break
          }
          default:
            result = await shared.dispatch(adapter, req)
            if (result === undefined)
              throw new Error(`Unknown request type: ${(req as WorkerRequest).type}`)
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
