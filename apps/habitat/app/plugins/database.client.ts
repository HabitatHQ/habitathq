import { Capacitor } from '@capacitor/core'
import type { WorkerRequestBody, WorkerResponse } from '~/types/database'

let worker: Worker | null = null
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

export function sendToWorker<T>(req: WorkerRequestBody): Promise<T> {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ ...req, id })
  })
}

export default defineNuxtPlugin(async () => {
  if (Capacitor.isNativePlatform()) return  // OPFS is web-only

  const dbError = useState<string | null>('db-error', () => null)

  worker = new Worker(
    new URL('../workers/database.worker.ts', import.meta.url),
    { type: 'module' },
  )

  worker.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as WorkerResponse | { type: string }
    if ('type' in msg) return  // READY / LOCK_UNAVAILABLE / other lifecycle signals
    const p = pending.get((msg as WorkerResponse).id)
    if (!p) return
    pending.delete((msg as WorkerResponse).id)
    const r = msg as WorkerResponse
    r.ok ? p.resolve(r.data) : p.reject(new Error(r.error))
  })

  // Block app mount until DB is ready (or we know it can't start).
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      dbError.value = 'Database took too long to start. Try closing other tabs or refreshing.'
      resolve()
    }, 10_000)

    worker!.addEventListener('message', function handler(e: MessageEvent) {
      const type = e.data?.type
      if (type === 'READY') {
        clearTimeout(t)
        worker!.removeEventListener('message', handler)
        resolve()
      } else if (type === 'LOCK_UNAVAILABLE') {
        clearTimeout(t)
        worker!.removeEventListener('message', handler)
        dbError.value = 'Habitat is already open in another tab. Close that tab and refresh this one.'
        resolve()
      } else if (type === 'INIT_ERROR') {
        clearTimeout(t)
        worker!.removeEventListener('message', handler)
        dbError.value = `Database failed to start: ${(e.data as { message: string }).message}`
        resolve()
      }
    })

    worker!.onerror = () => {
      clearTimeout(t)
      if (!dbError.value) {
        dbError.value = 'Database failed to initialize. Try refreshing.'
      }
      resolve()
    }
  })

  return {
    provide: { dbError: readonly(dbError) },
  }
})
