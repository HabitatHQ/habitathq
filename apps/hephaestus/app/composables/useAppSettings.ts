export type AppTheme = 'hephaestus' | 'forge' | 'daylight'
export type WeightUnit = 'kg' | 'lbs'
export type DistanceUnit = 'km' | 'mi'

export interface AppSettings {
  theme: AppTheme
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  use24HourTime: boolean
  reduceMotion: boolean
  defaultRestSeconds: number
  showRpe: boolean
  showRir: boolean
}

const KEY = 'hephaestus-app-settings'

const DEFAULTS: AppSettings = {
  theme: 'hephaestus',
  weightUnit: 'kg',
  distanceUnit: 'km',
  use24HourTime: false,
  reduceMotion: false,
  defaultRestSeconds: 120,
  showRpe: true,
  showRir: false,
}

function readFromStorage(): AppSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as AppSettings
  } catch (err) {
    console.warn('[useAppSettings] Failed to parse stored settings, using defaults:', err)
    return { ...DEFAULTS }
  }
}

export function useAppSettings() {
  const settings = useState<AppSettings>('app-settings', () =>
    import.meta.client ? readFromStorage() : { ...DEFAULTS },
  )

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    settings.value = { ...settings.value, [key]: value }
    if (import.meta.client) localStorage.setItem(KEY, JSON.stringify(settings.value))
  }

  return { settings: readonly(settings), set }
}
