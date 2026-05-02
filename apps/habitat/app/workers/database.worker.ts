import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import * as schema from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { DbAdapter, WorkerRequest, WorkerResponse } from '~/types/database'

// Wrapped in an async IIFE so we can return early (e.g. lock unavailable)
// without leaking unguarded top-level awaits.
await (async () => {
  // ─── Exclusive lock ───────────────────────────────────────────────────────────
  // OPFS createSyncAccessHandle is only available in *dedicated* workers — there
  // is no multi-tab SharedWorker workaround. We use the Web Locks API to detect
  // when another tab already owns the DB and bail out gracefully instead of
  // crashing with a cryptic NoModificationAllowedError.
  //
  // We retry up to 3 times with 1 s gaps because the COI service-worker and the
  // vite-pwa autoUpdate handler can both trigger page reloads in quick succession.
  // The old worker's lock releases the instant that worker is terminated, but the
  // new page can start fast enough to race it. A genuine second-tab conflict still
  // fails after ~2 s of retries.

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
    // ─── DB init ──────────────────────────────────────────────────────────────────

    // Suppress sqlite-wasm's verbose console output and COOP/COEP probe warnings
    // @ts-expect-error — sqlite-wasm types omit the optional config argument
    const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} })

    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/habitat',
      clearOnInit: false,
    })
    const db = new poolUtil.OpfsSAHPoolDb('/habitat.db')
    db.exec('PRAGMA foreign_keys = ON')

    // ─── Low-level helpers ────────────────────────────────────────────────────────

    /** Run a SELECT and collect plain object rows. */
    function queryRaw(sql: string, bind?: unknown[]): Record<string, unknown>[] {
      const rows: Record<string, unknown>[] = []
      db.exec({
        sql,
        ...(bind !== undefined && { bind }),
        rowMode: 'object',
        // @ts-expect-error — sqlite-wasm types don't model rowMode:'object' callback signature
        callback: (row: Record<string, unknown>) => rows.push({ ...row }),
      })
      return rows
    }

    /** Run an INSERT / UPDATE / DELETE / PRAGMA. */
    function exec(sql: string, bind?: unknown[]): void {
      // @ts-expect-error — sqlite-wasm bind type narrower than unknown[]
      db.exec({ sql, ...(bind !== undefined && { bind }) })
    }

    // ─── WorkerDbAdapter ─────────────────────────────────────────────────────────
    // Wraps the synchronous wa-sqlite API in Promise.resolve() to satisfy the
    // async DbAdapter interface shared with the native (Capacitor) path.

    class WorkerDbAdapter implements DbAdapter {
      async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
        return Promise.resolve(queryRaw(sql, bind) as T[])
      }

      async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
        const rows = queryRaw(sql, bind)
        return Promise.resolve(rows.length > 0 ? (rows[0] as T) : null)
      }

      async exec(sql: string, bind?: unknown[]): Promise<void> {
        return Promise.resolve(exec(sql, bind))
      }
    }

    const adapter = new WorkerDbAdapter()

    // ─── Schema ───────────────────────────────────────────────────────────────────

    db.exec(schema.SCHEMA_DDL)

    // ─── Migrations ───────────────────────────────────────────────────────────────

    await schema.runMigrations(adapter)

    // ─── Default seeds ────────────────────────────────────────────────────────────

    await schema.seedDefaults(adapter)

    // ─── DB export ────────────────────────────────────────────────────────────────

    /** Serialize the live database to a Uint8Array using the sqlite3_serialize C API.
     *  OpfsSAHPoolDb does not expose OO1's serialize(), so we go through wasm directly.
     *  sqlite3_serialize returns a heap-allocated buffer; we copy it into a JS
     *  Uint8Array and then free the buffer.
     */
    function exportDbBytes(): Uint8Array {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (sqlite3 as any).wasm
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (sqlite3 as any).capi
      const savedStack = w.pstack.pointer
      try {
        const pSize = w.pstack.alloc(8) // sqlite3_int64* for the byte count output
        const pData = c.sqlite3_serialize(db.pointer, 'main', pSize, 0)
        if (!pData) throw new Error('sqlite3_serialize returned null')
        const nBytes = Number(w.peek(pSize, 'i64'))
        const bytes = new Uint8Array(nBytes)
        bytes.set(w.heap8u().subarray(pData, pData + nBytes))
        c.sqlite3_free(pData)
        return bytes
      } finally {
        w.pstack.restore(savedStack)
      }
    }

    // ─── Message loop ─────────────────────────────────────────────────────────────

    self.addEventListener('message', async (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      let result: unknown
      try {
        switch (req.type) {
          case 'EXPORT_DB':
            result = exportDbBytes()
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
