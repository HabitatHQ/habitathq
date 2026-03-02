import type { Ref } from 'vue'
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const PARAM = 'modal'

/**
 * Syncs a string-enum modal state to the `?modal=` URL query param.
 *
 * The initial value is read synchronously from the URL during setup to avoid
 * the one-frame flicker that would occur if we waited until onMounted.
 *
 * Only values present in `validModals` are ever read from or written to the
 * URL. Setting the ref to a value NOT in `validModals` (e.g. an internal-only
 * modal like `'transcript'`) clears the URL param rather than writing an
 * invalid value.
 */
export function useModalQuery<T extends string>(validModals: readonly T[]): Ref<T | null> {
  const route = useRoute()
  const router = useRouter()

  const initial = route.query[PARAM]
  const startValue =
    typeof initial === 'string' && (validModals as readonly string[]).includes(initial)
      ? (initial as T)
      : null
  const modal = ref<T | null>(startValue) as Ref<T | null>

  watch(modal, (val) => {
    const query = { ...route.query }
    if (val !== null && (validModals as readonly string[]).includes(val)) {
      query[PARAM] = val
    } else {
      delete query[PARAM]
    }
    router.replace({ query })
  })

  return modal
}

/**
 * Syncs a boolean open/close modal state to `?modal=<modalName>` in the URL.
 *
 * The initial value is read synchronously from the URL during setup to avoid
 * the one-frame flicker that would occur if we waited until onMounted.
 *
 * Navigating to `?modal=add` with `useBoolModalQuery('add')` will open the
 * modal; closing the modal removes the query param.
 */
export function useBoolModalQuery(modalName: string): Ref<boolean> {
  const route = useRoute()
  const router = useRouter()
  const open = ref(route.query[PARAM] === modalName)

  watch(open, (val) => {
    const query = { ...route.query }
    if (val) {
      query[PARAM] = modalName
    } else {
      delete query[PARAM]
    }
    router.replace({ query })
  })

  return open
}
