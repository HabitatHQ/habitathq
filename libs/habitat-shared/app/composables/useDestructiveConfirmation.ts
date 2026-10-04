import { computed, type Ref, shallowRef } from 'vue'

export interface DestructiveConfirmationController<Args extends unknown[]> {
  pending: Readonly<Ref<boolean>>
  request: (...args: Args) => void
  cancel: () => void
  confirm: () => Args | null
}

/** Stages destructive arguments; only explicit confirm returns them for execution. */
export function useDestructiveConfirmation<
  Args extends unknown[],
>(): DestructiveConfirmationController<Args> {
  const staged = shallowRef<Args | null>(null)
  const pending = computed(() => staged.value !== null)

  function request(...args: Args): void {
    staged.value = args
  }

  function cancel(): void {
    staged.value = null
  }

  function confirm(): Args | null {
    const args = staged.value
    staged.value = null
    return args
  }

  return { pending, request, cancel, confirm }
}
