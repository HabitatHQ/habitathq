const SETTINGS_KEY = 'halcyon-settings'

interface AppSettings {
  theme: 'auto' | 'light' | 'dark'
  defaultVaultId: string | null
}

const defaults: AppSettings = {
  theme: 'auto',
  defaultVaultId: null,
}

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...defaults }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...JSON.parse(raw) } as AppSettings
  } catch {
    return { ...defaults }
  }
}

const _settings = ref<AppSettings>(loadSettings())

export function useAppSettings() {
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    _settings.value[key] = value
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(_settings.value))
    }
  }

  return {
    settings: readonly(_settings),
    set,
  }
}
