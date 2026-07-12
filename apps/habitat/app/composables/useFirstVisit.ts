// Tracks which keys have been mounted during the current app session.
// Module-level so it survives SPA route changes but resets on a cold start /
// full reload — i.e. it maps to "first load", not "first ever".
const visited = new Set<string>()

/**
 * Returns `true` only the first time `key` is seen in this app session, then
 * `false` on every subsequent mount. Use it to gate one-shot entrance
 * animations (e.g. `stagger-list`) so they play on first load but don't replay
 * when the user navigates away from a tab and comes back.
 *
 * Call once in `setup`; the returned boolean is captured for the component's
 * lifetime (the stagger runs on mount, so it never needs to be reactive).
 *
 *   const staggerOnce = useFirstVisit('jots-list')
 *   <ul :class="['space-y-2', { 'stagger-list': staggerOnce }]">
 */
export function useFirstVisit(key: string): boolean {
  if (visited.has(key)) return false
  visited.add(key)
  return true
}
