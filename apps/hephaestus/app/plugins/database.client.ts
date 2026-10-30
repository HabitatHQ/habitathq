import { Capacitor } from '@capacitor/core'
import type { DbApi, PalladiumClient, WorkerConnection } from '@palladium/worker'
import { connect, createClient } from '@palladium/worker'
import type { HephaestusRequest } from '~/lib/hephaestus-backend'

interface HephaestusService extends DbApi {
  ping(): Promise<boolean>
  dispatch(request: HephaestusRequest): Promise<unknown>
}

export type DatabaseStatus = 'initializing' | 'ready' | 'error'

let connection: WorkerConnection<HephaestusService> | null = null
let client: PalladiumClient | null = null
let initializationError: string | null = null
let nativeUnavailable = false

export function sendToWorker<T>(request: HephaestusRequest): Promise<T> {
  if (nativeUnavailable) {
    return Promise.reject(
      new Error('Native database operations are unavailable; Hephaestus is PWA-only.'),
    )
  }
  if (initializationError) return Promise.reject(new Error(initializationError))
  if (!connection) return Promise.reject(new Error('Hephaestus database is still initializing.'))
  return connection.service.dispatch(request) as Promise<T>
}

export function databaseClient(): PalladiumClient {
  if (nativeUnavailable)
    throw new Error('Native database operations are unavailable; Hephaestus is PWA-only.')
  if (!client) throw new Error(initializationError ?? 'Hephaestus database is still initializing.')
  return client
}

function closeConnection(): void {
  connection = null
  client = null
}

export default defineNuxtPlugin({
  name: 'hephaestus-database',
  dependsOn: ['pwa-isolation'],
  async setup(nuxtApp) {
    const dbError = useState<string | null>('db-error', () => null)
    const dbStatus = useState<DatabaseStatus>('db-status', () => 'initializing')
    const dbRole = useState<'leader' | 'follower' | null>('db-role', () => null)
    const invalidation = useState<{ revision: number; tables: readonly string[] }>(
      'db-invalidation',
      () => ({ revision: 0, tables: [] }),
    )
    if (import.meta.server)
      return {
        provide: {
          dbError: readonly(dbError),
          dbStatus: readonly(dbStatus),
          dbRole: readonly(dbRole),
        },
      }

    if (Capacitor.isNativePlatform()) {
      nativeUnavailable = true
      initializationError = 'Native database operations are unavailable; Hephaestus is PWA-only.'
      dbError.value = initializationError
      dbStatus.value = 'error'
      return {
        provide: {
          dbError: readonly(dbError),
          dbStatus: readonly(dbStatus),
          dbRole: readonly(dbRole),
        },
      }
    }

    const worker = new Worker(new URL('../workers/database.worker.ts', import.meta.url), {
      type: 'module',
    })
    const connected = connect<HephaestusService>(worker)
    connection = connected
    client = createClient(connected)
    initializationError = null
    dbError.value = null
    dbStatus.value = 'initializing'
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let active = true
    function markReady() {
      if (connection !== connected) return
      clearTimeout(retryTimer)
      retryTimer = undefined
      initializationError = null
      dbError.value = null
      dbStatus.value = 'ready'
    }
    function scheduleRetry() {
      if (!active || retryTimer !== undefined) return
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void connected.service.ping().then(markReady, scheduleRetry)
      }, 2_000)
    }

    const unsubscribeRole = connected.onRole((role) => {
      dbRole.value = role
    })
    const unsubscribeError = connected.onError((message) => {
      initializationError = message
      dbError.value = message
      dbStatus.value = 'error'
      scheduleRetry()
    })
    const unsubscribeInvalidate = connected.onInvalidate((tables) => {
      invalidation.value = {
        revision: invalidation.value.revision + 1,
        tables,
      }
    })
    const startup = connected.service.ping()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const dispose = () => {
      if (!active) return
      active = false
      clearTimeout(timeout)
      clearTimeout(retryTimer)
      unsubscribeInvalidate()
      unsubscribeRole()
      unsubscribeError()
      closeConnection()
      worker.terminate()
    }
    nuxtApp.vueApp.onUnmount(dispose)
    import.meta.hot?.dispose(dispose)

    void startup.then(markReady, scheduleRetry)
    try {
      await Promise.race([
        startup,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Timed out waiting for the Hephaestus database owner.')),
            20_000,
          )
        }),
      ])
    } catch (error) {
      if (connection === connected) {
        const message = error instanceof Error ? error.message : String(error)
        initializationError = message
        dbError.value = message
        dbStatus.value = 'error'
        scheduleRetry()
      }
    } finally {
      clearTimeout(timeout)
    }

    return {
      provide: {
        dbError: readonly(dbError),
        dbStatus: readonly(dbStatus),
        dbRole: readonly(dbRole),
      },
    }
  },
})
