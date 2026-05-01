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
  warmupRamps: number[]
  // ── Feature toggles ──────────────────────────────────────────────────────
  /** Show "Suggest warm-ups" button in the add-set sheet */
  showWarmupSuggestions: boolean
  /** Show "Take extra rest?" toast after logging a failure set */
  showFailurePrompt: boolean
  /** Show session notes textarea on the finish-workout sheet */
  showSessionNotes: boolean
  /** Enable set scheme wizard (pyramid, drop sets, rest-pause) in template builder */
  showSetSchemes: boolean
  /** Enable per-set rest overrides in template builder */
  showVariableRest: boolean
  /** Enable superset / circuit group creation in template builder */
  showSupersets: boolean
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
  warmupRamps: [40, 60, 80],
  // Feature toggles — core features on, advanced off
  showWarmupSuggestions: true,
  showFailurePrompt: true,
  showSessionNotes: true,
  showSetSchemes: false,
  showVariableRest: false,
  showSupersets: false,
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
