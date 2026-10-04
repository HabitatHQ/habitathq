import { readStoredSettings, writeStoredSettings } from '@habitathq/utils'
import { readonly, ref } from 'vue'

const SETTINGS_KEY = 'halcyon-settings'

interface AppSettings {
  theme: 'auto' | 'light' | 'dark'
  defaultVaultId: string | null
}

const defaults = (): AppSettings => ({
  theme: 'auto',
  defaultVaultId: null,
})

const _settings = ref<AppSettings>(
  typeof window === 'undefined'
    ? defaults()
    : readStoredSettings<AppSettings>(SETTINGS_KEY, { defaults }),
)

export function useAppSettings() {
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    _settings.value[key] = value
    if (typeof window !== 'undefined') writeStoredSettings(SETTINGS_KEY, _settings.value)
  }

  return {
    settings: readonly(_settings),
    set,
  }
}
