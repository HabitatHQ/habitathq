import type { Page } from '@playwright/test'
import { parseHearthExport } from '../../../app/lib/hearth-export'
import type { WorkerRequestBody } from '../../../app/types/database'

declare global {
  interface Window {
    __hearthDatabaseRequest: (request: WorkerRequestBody) => Promise<unknown>
  }
}

/** Observe the app's real worker; fixture commands share its actual persistence boundary. */
export async function installDatabaseProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let databaseWorker: Worker | undefined
    let resolveReady: () => void = () => {}
    let rejectReady: (reason: Error) => void = () => {}
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // Register a rejection handler even before the first fixture request.
    void ready.catch(() => {})
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (!String(url).includes('database.worker')) return
        databaseWorker = this
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          const message = event.data
          if (typeof message !== 'object' || message === null || !('type' in message)) return
          if (message.type === 'READY') resolveReady()
          if (message.type === 'INIT_ERROR' || message.type === 'LOCK_UNAVAILABLE') {
            rejectReady(new Error(`Database fixture startup failed: ${JSON.stringify(message)}`))
          }
        })
        this.addEventListener('error', (event) => rejectReady(new Error(event.message)))
      }
    }
    window.__hearthDatabaseRequest = async (request) => {
      let startupTimer: number | undefined
      try {
        await Promise.race([
          ready,
          new Promise<never>((_, reject) => {
            startupTimer = window.setTimeout(() => reject(new Error('Database fixture startup timed out')), 15_000)
          }),
        ])
      } finally {
        window.clearTimeout(startupTimer)
      }
      const worker = databaseWorker
      if (!worker) throw new Error('Hearth database worker was not created')
      return new Promise<unknown>((resolve, reject) => {
        const id = crypto.randomUUID()
        const cleanup = () => {
          clearTimeout(timeout)
          worker.removeEventListener('message', onMessage)
        }
        const onMessage = (event: MessageEvent<unknown>) => {
          const response = event.data
          if (typeof response !== 'object' || response === null || !('id' in response) || response.id !== id) return
          cleanup()
          if ('ok' in response && response.ok && 'data' in response) resolve(response.data)
          else reject(new Error('error' in response ? String(response.error) : 'Invalid database fixture response'))
        }
        const timeout = setTimeout(() => {
          cleanup()
          reject(new Error(`Database fixture command timed out: ${request.type}`))
        }, 15_000)
        worker.addEventListener('message', onMessage)
        try {
          worker.postMessage({ ...request, id })
        } catch (error) {
          cleanup()
          reject(error)
        }
      })
    }
  })
}

export async function databaseRequest(page: Page, request: WorkerRequestBody): Promise<unknown> {
  return page.evaluate((request) => window.__hearthDatabaseRequest(request), request)
}

export async function exportBackup(page: Page) {
  return parseHearthExport(await databaseRequest(page, { type: 'EXPORT_JSON' }))
}
