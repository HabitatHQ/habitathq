export interface AppSettings {
  enableToday: boolean
  enableJournalling: boolean
  enableHealth: boolean
  enableWeek: boolean
  weekDays: number
  showTagsOnHabits: boolean
  showAnnotationsOnHabits: boolean
  showTagsOnToday: boolean
  showAnnotationsOnToday: boolean
  stickyNav: boolean
  navExtraPadding: boolean
  logInputMode: 'absolute' | 'increment'
}

const KEY = 'habitat-app-settings'
const DEFAULTS: AppSettings = {
  enableToday: true,
  enableJournalling: true,
  enableHealth: false,
  enableWeek: false,
  weekDays: 3,
  showTagsOnHabits: false,
  showAnnotationsOnHabits: false,
  showTagsOnToday: false,
  showAnnotationsOnToday: false,
  stickyNav: false,
  navExtraPadding: false,
  logInputMode: 'absolute',
}

function readFromStorage(): AppSettings {
  try {
    const stored = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as AppSettings
    if (!Number.isFinite(stored.weekDays) || stored.weekDays < 3) stored.weekDays = 3
    return stored
  } catch {
    return { ...DEFAULTS }
  }
}

export function useAppSettings() {
  // useState gives a singleton ref shared across all composable calls (key-deduplicated)
  const settings = useState<AppSettings>('app-settings', () =>
    import.meta.client ? readFromStorage() : { ...DEFAULTS },
  )

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    settings.value = { ...settings.value, [key]: value }
    if (import.meta.client) localStorage.setItem(KEY, JSON.stringify(settings.value))
  }

  return { settings: readonly(settings), set }
}
