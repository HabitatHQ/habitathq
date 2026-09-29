import { Capacitor } from '@capacitor/core'
import { dbg, enableDebug, isDebugEnabled } from '@palladium/core'
import { connect } from '@palladium/worker'
import { dispatchNative, initNativeDb } from '~/lib/db-native'
import type { WorkerRequestBody } from '~/types/database'
import type { HabitatService } from '~/workers/database.worker'

// The UI stops blocking after this deadline. The worker keeps electing and
// opening in the background, then clears the startup error once ping succeeds.
const STARTUP_TIMEOUT_MS = 10_000

let webDispatch: ((req: WorkerRequestBody) => Promise<unknown>) | null = null
let nativeReady = false

class StartupTimeoutError extends Error {}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function enableStartupDebugIfRequested(): void {
  if (!isDebugEnabled() && localStorage.getItem('palladium:debug') === '1') enableDebug()
}

function recordStartup(
  startupId: string,
  startedAt: number,
  stage: string,
  fields: Record<string, unknown> = {},
): void {
  dbg('habitat-db-startup', stage, {
    startupId,
    elapsedMs: Math.round(performance.now() - startedAt),
    visibility: document.visibilityState,
    displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
    hasBroadcastChannel: typeof BroadcastChannel === 'function',
    hasWebLocks: typeof navigator.locks !== 'undefined',
    hasOpfs: typeof navigator.storage?.getDirectory === 'function',
    hasSharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    ...fields,
  })
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  // Habitat's browser target includes Safari versions before Promise.withResolvers.
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StartupTimeoutError('timeout')), ms)
    p.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Send one request to the database. On native (Capacitor) it runs in-process;
 * on web it goes to whichever tab currently owns the OPFS database, with the
 * `@palladium/worker` bus handling leadership and failover transparently.
 *
 * Boundary casts: both dispatchers resolve `Promise<unknown>` — the RPC
 * boundary is untyped by construction, and `T` is the response shape the
 * *caller* asserts for this request type (`useDatabase` maps each op to its
 * result). There is nothing to structurally verify against here, so the
 * `as Promise<T>` is a deliberate boundary assertion, not error-silencing. The
 * source of truth for correctness is the caller-side `WorkerRequestBody` → `T`
 * mapping, not this generic pass-through.
 */
export function sendToWorker<T>(req: WorkerRequestBody): Promise<T> {
  if (nativeReady) return dispatchNative(req) as Promise<T>
  if (!webDispatch) return Promise.reject(new Error('Database is not available.'))
  return webDispatch(req) as Promise<T>
}

async function initialize(
  isNativePlatform: boolean,
  onStatus: (msg: string | null) => void,
): Promise<void> {
  const startupId = crypto.randomUUID()
  const startedAt = performance.now()
  recordStartup(startupId, startedAt, 'initialize', {
    platform: isNativePlatform ? 'native' : 'web',
  })

  // ── Native path (Capacitor) ─────────────────────────────────────────────
  if (isNativePlatform) {
    try {
      await initNativeDb()
      nativeReady = true
      recordStartup(startupId, startedAt, 'native-ready')
      onStatus(null)
    } catch (err) {
      const message = errMessage(err)
      recordStartup(startupId, startedAt, 'native-failed', { error: message })
      onStatus(`Database failed to start: ${message}`)
    }
    return
  }

  recordStartup(startupId, startedAt, 'worker-creating')
  const worker = new Worker(new URL('../workers/database.worker.ts', import.meta.url), {
    type: 'module',
  })
  const conn = connect<HabitatService>(worker)
  webDispatch = (req) => conn.service.dispatch(req)
  conn.onDiagnostic((diagnostic) => {
    recordStartup(startupId, startedAt, `worker-${diagnostic.event}`, { ...diagnostic })
  })
  conn.onRole((role) => recordStartup(startupId, startedAt, 'worker-role', { role }))
  // A promotion that fails to open the DB surfaces here (e.g. corrupt OPFS).
  conn.onError((message) => {
    recordStartup(startupId, startedAt, 'worker-error', { error: message })
    onStatus(`Database failed to start: ${message}`)
  })

  // Block first paint until a leader has opened the DB, but do not strand the
  // app if iOS temporarily suspends the leader. The original ping remains live
  // and clears the alert once a queued/reconnected worker becomes ready.
  const readiness = conn.service.ping()
  void readiness.then(
    () => {
      recordStartup(startupId, startedAt, 'ready')
      onStatus(null)
    },
    (err) => {
      const message = errMessage(err)
      recordStartup(startupId, startedAt, 'readiness-failed', { error: message })
      onStatus(`Database failed to start: ${message}`)
    },
  )
  try {
    await withTimeout(readiness, STARTUP_TIMEOUT_MS)
  } catch (err) {
    if (err instanceof StartupTimeoutError) {
      recordStartup(startupId, startedAt, 'first-paint-timeout')
      onStatus('Database took too long to start. The app will keep recovering in the background.')
      return
    }
    const message = errMessage(err)
    recordStartup(startupId, startedAt, 'initialization-failed', { error: message })
    onStatus(`Database failed to start: ${message}`)
  }
}

export default defineNuxtPlugin(async () => {
  enableStartupDebugIfRequested()
  const dbError = useState<string | null>('db-error', () => null)

  await initialize(Capacitor.isNativePlatform(), (message) => {
    dbError.value = message
  })

  return {
    provide: { dbError: readonly(dbError) },
  }
})
