/**
 * Factory for creating a localStorage-backed reactive settings composable.
 *
 * Each app calls this once with its own `AppSettings` type and defaults:
 *
 * ```ts
 * const { settings, set } = createAppSettings<AppSettings>('habitat-settings', {
 *   theme: 'auto',
 *   enableTodos: true,
 * })
 * ```
 */
export function createAppSettings<T extends Record<string, unknown>>(
  storageKey: string,
  defaults: T,
) {
  const raw = ref<T>({ ...defaults }) as Ref<T>

  // Hydrate from localStorage on first call (client only)
  if (import.meta.client) {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<T>
        raw.value = { ...defaults, ...parsed }
      }
    } catch {
      // corrupt localStorage — keep defaults
    }
  }

  const settings = readonly(raw) as Readonly<Ref<Readonly<T>>>

  function set<K extends keyof T>(key: K, value: T[K]): void {
    raw.value = { ...raw.value, [key]: value }
    if (import.meta.client) {
      localStorage.setItem(storageKey, JSON.stringify(raw.value))
    }
  }

  return { settings, set }
}
