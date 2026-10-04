import { computed, type Ref, readonly, ref, shallowRef } from 'vue'

export type AsyncOperationStatus = 'idle' | 'running' | 'success' | 'error'

type Awaitable<T> = T | PromiseLike<T>

/** App-owned work and the optional callback that runs before success is published. */
export interface AsyncOperationOptions<Args extends unknown[], Result> {
  action: (...args: Args) => Awaitable<Result>
  onSuccess?: (result: Result, ...args: Args) => Awaitable<void>
}

/** Reactive state for one non-overlapping asynchronous operation. */
export interface AsyncOperationController<Args extends unknown[], Result> {
  status: Readonly<Ref<AsyncOperationStatus>>
  busy: Readonly<Ref<boolean>>
  error: Readonly<Ref<Error | null>>
  success: Readonly<Ref<boolean>>
  result: Readonly<Ref<Result | undefined>>
  run: (...args: Args) => Promise<Result>
  reset: () => boolean
}

/** Raised without invoking the action when an operation is already running. */
export class AsyncOperationBusyError extends Error {
  constructor() {
    super('The operation is already running')
    this.name = 'AsyncOperationBusyError'
  }
}

function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause
  return new Error(typeof cause === 'string' ? cause : 'The operation failed', { cause })
}

/**
 * Runs app-owned work while exposing shared busy/error/success mechanics.
 * Failures are retained for presentation and rethrown so callers keep control.
 */
export function useAsyncOperation<Args extends unknown[], Result>(
  options: AsyncOperationOptions<Args, Result>,
): AsyncOperationController<Args, Result> {
  const status = ref<AsyncOperationStatus>('idle')
  const error = shallowRef<Error | null>(null)
  const result = shallowRef<Result | undefined>(undefined)
  const busy = computed(() => status.value === 'running')
  const success = computed(() => status.value === 'success')

  async function run(...args: Args): Promise<Result> {
    if (busy.value) throw new AsyncOperationBusyError()

    status.value = 'running'
    error.value = null
    result.value = undefined

    try {
      const value = await options.action(...args)
      await options.onSuccess?.(value, ...args)
      result.value = value
      status.value = 'success'
      return value
    } catch (cause) {
      const failure = toError(cause)
      error.value = failure
      status.value = 'error'
      throw failure
    }
  }

  function reset(): boolean {
    if (busy.value) return false
    status.value = 'idle'
    error.value = null
    result.value = undefined
    return true
  }

  return {
    status: readonly(status),
    busy,
    error: readonly(error),
    success,
    result: readonly(result) as Readonly<Ref<Result | undefined>>,
    run,
    reset,
  }
}
