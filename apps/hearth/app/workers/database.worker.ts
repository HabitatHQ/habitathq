import { SahPoolAdapter, toDbAdapter } from '@habitathq/db'
import * as schema from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { WorkerRequest, WorkerResponse } from '~/types/database'

await (async () => {
  // ─── Exclusive lock ───────────────────────────────────────────────────────────
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
          return new Promise(() => {}) // hold until worker terminates
        })
      })
      if (got) return true
    }
    // Retries exhausted — steal the stale lock
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
    const storage = new SahPoolAdapter({ directory: '/hearth', filename: '/hearth.db' })
    await storage.open()

    const adapter = toDbAdapter(storage)

    await adapter.exec('PRAGMA journal_mode = WAL')
    await adapter.exec(schema.SCHEMA_DDL)
    await schema.runMigrations(adapter)

    // ─── Message loop ─────────────────────────────────────────────────────────────

    self.addEventListener('message', async (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      let result: unknown
      try {
        switch (req.type) {
          case 'EXPORT_DB':
            result = storage.serialize()
            break
          case 'EXPORT_JSON':
            result = {
              version: '1.0',
              exported_at: new Date().toISOString(),
              users: await adapter.queryAll('SELECT * FROM users'),
              accounts: await adapter.queryAll('SELECT * FROM accounts'),
              categories: await adapter.queryAll('SELECT * FROM categories'),
              transactions: await adapter.queryAll('SELECT * FROM transactions'),
              envelopes: await adapter.queryAll('SELECT * FROM envelopes'),
              envelope_periods: await adapter.queryAll('SELECT * FROM envelope_periods'),
              iou_splits: await adapter.queryAll('SELECT * FROM iou_splits'),
              savings_goals: await adapter.queryAll('SELECT * FROM savings_goals'),
              chores: await adapter.queryAll('SELECT * FROM chores'),
            }
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
