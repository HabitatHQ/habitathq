import { toDbAdapter } from '@habitathq/db'
import { BrowserSqliteAdapter } from '@palladium/sqlite-browser'
import * as schema from '~/lib/db-schema'
import type { WorkerResponse } from '~/types/database'

await (async () => {
  // ─── Exclusive lock ───────────────────────────────────────────────────────────
  async function tryAcquireDbLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
      const got = await new Promise<boolean>((resolve) => {
        void navigator.locks.request('hephaestus-db', { ifAvailable: true }, (lock) => {
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
    self.postMessage({ type: 'LOCK_UNAVAILABLE' } satisfies WorkerResponse as WorkerResponse)
    return
  }

  try {
    const storage = new BrowserSqliteAdapter({
      vfs: { type: 'opfs-sah-pool', directory: '/hephaestus', filename: '/hephaestus.db' },
    })
    await storage.open()

    const adapter = toDbAdapter(storage)

    await adapter.exec(schema.SCHEMA_DDL)
    await schema.runMigrations(adapter)

    // ─── Message loop ─────────────────────────────────────────────────────────────

    self.addEventListener('message', async (e: MessageEvent) => {
      const req = e.data as { id: string; type: string; payload?: unknown }
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
          case 'QUERY': {
            const { sql, bind } = req.payload as { sql: string; bind?: unknown[] }
            result = await adapter.queryAll(sql, bind)
            break
          }
          case 'EXEC': {
            const { sql, bind } = req.payload as { sql: string; bind?: unknown[] }
            await adapter.exec(sql, bind)
            result = null
            break
          }
          case 'IS_DEFAULT_APPLIED': {
            const { key } = req.payload as { key: string }
            const row = await adapter.queryOne('SELECT key FROM applied_defaults WHERE key = ?', [
              key,
            ])
            result = row !== null
            break
          }
          case 'MARK_DEFAULT_APPLIED': {
            const { key } = req.payload as { key: string }
            await adapter.exec('INSERT OR IGNORE INTO applied_defaults (key) VALUES (?)', [key])
            result = null
            break
          }
          default:
            throw new Error(`Unknown message type: ${req.type}`)
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

    self.postMessage({ type: 'READY' } satisfies WorkerResponse as WorkerResponse)
  } catch (err) {
    self.postMessage({
      type: 'INIT_ERROR',
      message: err instanceof Error ? err.message : String(err),
    } as WorkerResponse)
  }
})()
