import { BrowserSqliteAdapter } from '@palladium/sqlite-browser'
import { dispatchTransfer } from '~/lib/data-transfer'
import { createSerialQueue, executeBatch } from '~/lib/database-operations'
import { resetAppDatabase } from '~/lib/database-reset'
import { initializeSchema } from '~/lib/db-schema'
import { toAppDbAdapter } from '~/lib/palladium-database'
import { dispatchWorkout } from '~/lib/workout-storage'
import type { DbAdapter, WorkerRequest, WorkerResponse } from '~/types/database'

await (async () => {
  async function tryAcquireDbLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000))
      const { promise, resolve } = Promise.withResolvers<boolean>()
      void navigator.locks.request('hephaestus-db', { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false)
          return Promise.resolve()
        }
        resolve(true)
        return new Promise(() => {})
      })
      if (await promise) return true
    }
    return false
  }

  if (!(await tryAcquireDbLock())) {
    self.postMessage({ type: 'LOCK_UNAVAILABLE' } satisfies WorkerResponse)
    return
  }

  let storage: BrowserSqliteAdapter | null = null
  let db: DbAdapter | null = null

  async function openDatabase(): Promise<void> {
    const opened = new BrowserSqliteAdapter({
      vfs: { type: 'opfs-sah-pool', directory: '/hephaestus', filename: '/hephaestus.db' },
    })
    try {
      await opened.open()
      const adapter = toAppDbAdapter(opened)
      await initializeSchema(opened, adapter)
      storage = opened
      db = adapter
    } catch (error) {
      await opened.close()
      throw error
    }
  }

  const enqueue = createSerialQueue()

  try {
    await openDatabase()
    self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
      const request = event.data
      void enqueue(async () => {
        try {
          const result = await dispatch(request.type, request.payload)
          self.postMessage({ id: request.id, ok: true, data: result } satisfies WorkerResponse)
        } catch (error) {
          self.postMessage({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies WorkerResponse)
        }
      })
    })
    self.postMessage({ type: 'READY' } satisfies WorkerResponse)
  } catch (error) {
    self.postMessage({
      type: 'INIT_ERROR',
      message: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse)
  }

  async function dispatch(type: string, payload: unknown): Promise<unknown> {
    if (type === 'RESET_LOCAL_DATA') {
      const adapter = db
      if (!adapter) throw new Error('Database is not initialized')
      await resetAppDatabase(adapter)
      return null
    }
    if (type === 'EXPORT_DB') {
      if (!storage) throw new Error('Database is not initialized')
      return storage.serialize()
    }
    const adapter = db
    if (!adapter) throw new Error('Database is not initialized')
    if (type === 'QUERY') {
      const { sql, bind } = payload as { sql: string; bind?: unknown[] }
      return adapter.queryAll(sql, bind)
    }
    if (type === 'EXEC') {
      const { sql, bind } = payload as { sql: string; bind?: unknown[] }
      await adapter.exec(sql, bind)
      return null
    }
    if (type === 'BATCH') {
      const { statements } = payload as { statements: Array<{ sql: string; bind?: unknown[] }> }
      await executeBatch(adapter, statements)
      return null
    }
    if (type === 'IS_DEFAULT_APPLIED') {
      const { key } = payload as { key: string }
      return (
        (await adapter.queryOne('SELECT key FROM applied_defaults WHERE key = ?', [key])) !== null
      )
    }
    if (type === 'MARK_DEFAULT_APPLIED') {
      const { key } = payload as { key: string }
      await adapter.exec('INSERT OR IGNORE INTO applied_defaults (key) VALUES (?)', [key])
      return null
    }
    if (type.startsWith('WORKOUT_')) {
      return adapter.transaction((tx) => dispatchWorkout(tx, type, payload))
    }
    if (type.startsWith('TRANSFER_')) return dispatchTransfer(adapter, type, payload)
    throw new Error(`Unknown message type: ${type}`)
  }
})()
