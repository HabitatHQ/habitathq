/**
 * Composable for long-press detection.
 *
 * The callback is passed to start() rather than the constructor so it can
 * close over per-press context (e.g. which item was pressed).
 *
 * Usage:
 *   const { start, cancel, activated } = useLongPress()
 *   // In template: @pointerdown="start(() => openMenuFor(item))"
 *   //              @pointerup="cancel" @pointerleave="cancel"
 *   // In click handler: if (activated.value) return  (suppress tap)
 */
export function useLongPress(duration = 600) {
  const activated = ref(false)
  let timeout: ReturnType<typeof setTimeout> | null = null

  function start(cb: () => void) {
    activated.value = false
    timeout = setTimeout(() => {
      activated.value = true
      cb()
    }, duration)
  }

  function cancel() {
    if (timeout !== null) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  return { start, cancel, activated }
}
