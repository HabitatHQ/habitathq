import { Capacitor } from '@capacitor/core'
import { createDatabasePlugin } from '@palladium/nuxt'

const { sendToWorker: dispatchToWorker, initialize } = createDatabasePlugin({
  appName: 'Hephaestus',
  createWorker: () =>
    new Worker(new URL('../workers/database.worker.ts', import.meta.url), { type: 'module' }),
})

let initializationError: string | null = null
let nativeUnavailable = false

export function sendToWorker<T>(req: Record<string, unknown>): Promise<T> {
  if (nativeUnavailable) {
    return Promise.reject(
      new Error('Native database operations are unavailable; Hephaestus is PWA-only.'),
    )
  }
  if (initializationError) return Promise.reject(new Error(initializationError))
  return dispatchToWorker<T>(req)
}

export default defineNuxtPlugin({
  name: 'hephaestus-database',
  dependsOn: ['pwa-isolation'],
  async setup() {
    const dbError = useState<string | null>('db-error', () => null)
    const dbStatus = useState<'initializing' | 'ready' | 'lock_unavailable' | 'error'>(
      'db-status',
      () => 'initializing',
    )
    if (dbError.value) {
      initializationError = dbError.value
      dbStatus.value = dbError.value.includes('already open in another tab')
        ? 'lock_unavailable'
        : 'error'
      return { provide: { dbError: readonly(dbError), dbStatus: readonly(dbStatus) } }
    }

    if (Capacitor.isNativePlatform()) {
      nativeUnavailable = true
      initializationError = 'Native database operations are unavailable; Hephaestus is PWA-only.'
      dbError.value = initializationError
      dbStatus.value = 'error'
    } else {
      await initialize(false, (message) => {
        initializationError = message
        dbError.value = message
        dbStatus.value = message.includes('already open in another tab')
          ? 'lock_unavailable'
          : 'error'
      })
      if (!dbError.value) dbStatus.value = 'ready'
    }

    return {
      provide: { dbError: readonly(dbError), dbStatus: readonly(dbStatus) },
    }
  },
})
