/**
 * Session-only context filter. State lives in Nuxt useState (survives
 * navigation within a session, resets on page reload). Tags shared by
 * ≥ 2 item types (habits / todos / bored) are loaded once per session.
 */
export function useContextFilter() {
  const activeContexts = useState<string[]>('context-filter', () => [])
  const contextTags = useState<string[]>('context-tags', () => [])
  const contextTagsLoaded = useState<boolean>('context-tags-loaded', () => false)

  const anyActive = computed(() => activeContexts.value.length > 0)

  function toggleContext(tag: string) {
    const idx = activeContexts.value.indexOf(tag)
    if (idx === -1) {
      activeContexts.value = [...activeContexts.value, tag]
    } else {
      activeContexts.value = activeContexts.value.filter((t) => t !== tag)
    }
  }

  function clearAll() {
    activeContexts.value = []
  }

  function isActive(tag: string): boolean {
    return activeContexts.value.includes(tag)
  }

  /** Returns true if the item matches the active filter (or no filter is active). */
  function matchesContext(tags: string[]): boolean {
    if (activeContexts.value.length === 0) return true
    return activeContexts.value.some((ctx) => tags.includes(ctx))
  }

  async function loadContextTags(db: { getContextTags: () => Promise<string[]> }) {
    if (contextTagsLoaded.value) return
    contextTags.value = await db.getContextTags()
    contextTagsLoaded.value = true
  }

  return {
    activeContexts: readonly(activeContexts),
    contextTags: readonly(contextTags),
    contextTagsLoaded: readonly(contextTagsLoaded),
    anyActive,
    toggleContext,
    clearAll,
    isActive,
    matchesContext,
    loadContextTags,
  }
}
