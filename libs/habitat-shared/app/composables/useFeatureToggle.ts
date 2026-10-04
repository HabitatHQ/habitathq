import { computed, type Ref, readonly, ref, shallowRef } from 'vue'
import { AsyncOperationBusyError } from './useAsyncOperation'

export interface FeatureToggleOptions<
  Features extends Record<string, boolean>,
  Key extends keyof Features,
> {
  key: Key
  value: Readonly<Ref<Features[Key]>>
  /** The app owns persistence, dependent updates, and any confirmation policy. */
  update: (key: Key, next: Features[Key]) => void | PromiseLike<void>
}

/** Bind one key from an app-defined feature map without assuming policy or storage. */
export function useFeatureToggle<
  Features extends Record<string, boolean>,
  Key extends keyof Features,
>(options: FeatureToggleOptions<Features, Key>) {
  const busy = ref(false)
  const error = shallowRef<Error | null>(null)

  async function set(next: Features[Key]): Promise<void> {
    if (busy.value) throw new AsyncOperationBusyError()
    if (options.value.value === next) return
    busy.value = true
    error.value = null
    try {
      await options.update(options.key, next)
    } catch (cause) {
      const failure =
        cause instanceof Error
          ? cause
          : new Error(typeof cause === 'string' ? cause : 'The feature could not be updated', {
              cause,
            })
      error.value = failure
      throw failure
    } finally {
      busy.value = false
    }
  }

  return {
    key: options.key,
    value: computed(() => options.value.value),
    busy: readonly(busy),
    error: readonly(error),
    set,
  }
}
