import type { WorkerRequest, WorkerResponse } from '~/types/database'

type PendingEntry = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type DbStatus = 'initializing' | 'ready' | 'lock_unavailable' | 'error'

let worker: Worker | null = null
const pending = new Map<string, PendingEntry>()
const status = ref<DbStatus>('initializing')
const error = ref<string | null>(null)

// Resolved when the worker posts READY. rpc() awaits this before sending any
// message, so calls made before the worker finishes initialising are queued
// naturally by Promise chaining instead of being silently dropped.
let _readyResolve: (() => void) | null = null
let _readyReject: ((err: Error) => void) | null = null
const readyPromise = new Promise<void>((resolve, reject) => {
  _readyResolve = resolve
  _readyReject = reject
})

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL('../workers/database.worker.ts', import.meta.url), { type: 'module' })

  worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    const { id, type, payload, error: workerError } = e.data

    if (type === 'READY') {
      status.value = 'ready'
      _readyResolve?.()
      return
    }
    if (type === 'LOCK_UNAVAILABLE') {
      status.value = 'lock_unavailable'
      error.value = 'Database is in use by another tab.'
      _readyReject?.(new Error(error.value))
      return
    }
    if (type === 'INIT_ERROR') {
      status.value = 'error'
      error.value = workerError ?? 'Unknown init error'
      _readyReject?.(new Error(error.value))
      return
    }

    if (!id) return
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)

    if (type === 'ERROR' || workerError) {
      entry.reject(new Error(workerError ?? 'Worker error'))
    } else {
      entry.resolve(payload)
    }
  })

  return worker
}

async function rpc<T>(type: string, payload?: unknown): Promise<T> {
  await readyPromise
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    })
    const request: WorkerRequest = { id, type, payload }
    getWorker().postMessage(request)
  })
}

export function useDatabase() {
  if (import.meta.client && status.value === 'initializing') {
    // Trigger worker initialization on first call
    getWorker()
  }

  function query<T = Record<string, unknown>>(sql: string, bind?: unknown[]): Promise<T[]> {
    return rpc<T[]>('QUERY', { sql, bind })
  }

  function exec(sql: string, bind?: unknown[]): Promise<void> {
    return rpc<void>('EXEC', { sql, bind })
  }

  function isDefaultApplied(key: string): Promise<boolean> {
    return rpc<boolean>('IS_DEFAULT_APPLIED', { key })
  }

  function markDefaultApplied(key: string): Promise<void> {
    return rpc<void>('MARK_DEFAULT_APPLIED', { key })
  }

  return {
    status: readonly(status),
    error: readonly(error),
    query,
    exec,
    isDefaultApplied,
    markDefaultApplied,
  }
}
