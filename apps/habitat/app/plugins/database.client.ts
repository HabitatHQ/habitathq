import { Capacitor } from '@capacitor/core'
import { connect } from '@palladium/worker'
import { dispatchNative, initNativeDb } from '~/lib/db-native'
import type { WorkerRequestBody } from '~/types/database'
import type { HabitatService } from '~/workers/database.worker'

// How long to wait for a leader to open the DB before surfacing a startup error.
// The worker keeps trying past this; the app just stops blocking on first paint.
const STARTUP_TIMEOUT_MS = 10_000

let webDispatch: ((req: WorkerRequestBody) => Promise<unknown>) | null = null
let nativeReady = false

/**
 * Send one request to the database. On native (Capacitor) it runs in-process;
 * on web it goes to whichever tab currently owns the OPFS database, with the
 * `@palladium/worker` bus handling leadership and failover transparently.
 */
export function sendToWorker<T>(req: WorkerRequestBody): Promise<T> {
  if (nativeReady) return dispatchNative(req) as Promise<T>
  if (!webDispatch) return Promise.reject(new Error('Database is not available.'))
  return webDispatch(req) as Promise<T>
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

async function initialize(
  isNativePlatform: boolean,
  onError: (msg: string) => void,
): Promise<void> {
  // ── Native path (Capacitor) ─────────────────────────────────────────────
  if (isNativePlatform) {
    try {
      await initNativeDb()
      nativeReady = true
    } catch (err) {
      onError(`Database failed to start: ${errMessage(err)}`)
    }
    return
  }

  // ── Web path: the ownership bus ──────────────────────────────────────────
  const worker = new Worker(new URL('../workers/database.worker.ts', import.meta.url), {
    type: 'module',
  })
  const conn = connect<HabitatService>(worker)
  webDispatch = (req) => conn.service.dispatch(req)
  // A promotion that fails to open the DB surfaces here (e.g. corrupt OPFS).
  conn.onError((message) => onError(`Database failed to start: ${message}`))

  // Block first paint until a leader has opened the DB, but don't hang forever.
  try {
    await withTimeout(conn.service.ping(), STARTUP_TIMEOUT_MS)
  } catch {
    onError('Database took too long to start. Try refreshing.')
  }
}

export default defineNuxtPlugin(async () => {
  const dbError = useState<string | null>('db-error', () => null)

  await initialize(Capacitor.isNativePlatform(), (msg) => {
    dbError.value = msg
  })

  return {
    provide: { dbError: readonly(dbError) },
  }
})
