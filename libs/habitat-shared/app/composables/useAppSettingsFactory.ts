import { readStoredSettings, writeStoredSettings } from '@habitathq/utils'

/**
 * Factory for creating a localStorage-backed reactive settings composable.
 * Apps own their defaults and normalization; this factory only shares persistence.
 */
export function createAppSettings<T extends object>(storageKey: string, defaults: T) {
  const freshDefaults = () => ({ ...defaults }) as T
  const raw = ref<T>(
    import.meta.client
      ? readStoredSettings(storageKey, { defaults: freshDefaults })
      : freshDefaults(),
  ) as Ref<T>

  const settings = readonly(raw) as Readonly<Ref<Readonly<T>>>

  function set<K extends keyof T>(key: K, value: T[K]): void {
    raw.value = { ...raw.value, [key]: value }
    if (import.meta.client) writeStoredSettings(storageKey, raw.value)
  }

  return { settings, set }
}
