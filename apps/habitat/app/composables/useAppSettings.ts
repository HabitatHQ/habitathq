export interface AppSettings {
  enableToday: boolean
  enableJournalling: boolean
  enableHealth: boolean
  enableWeek: boolean
  enableTodos: boolean
  enableBored: boolean
  weekDays: number
  showTagsOnHabits: boolean
  showAnnotationsOnHabits: boolean
  showTagsOnToday: boolean
  showAnnotationsOnToday: boolean
  stickyNav: boolean
  navExtraPadding: boolean
  logInputMode: 'absolute' | 'increment'
  saveTranscribedNotes: boolean
  use24HourTime: boolean
}

const KEY = 'habitat-app-settings'
const DEFAULTS: AppSettings = {
  enableToday: true,
  enableJournalling: true,
  enableHealth: false,
  enableWeek: false,
  enableTodos: false,
  enableBored: false,
  weekDays: 3,
  showTagsOnHabits: false,
  showAnnotationsOnHabits: false,
  showTagsOnToday: false,
  showAnnotationsOnToday: false,
  stickyNav: false,
  navExtraPadding: false,
  logInputMode: 'absolute',
  saveTranscribedNotes: true,
  use24HourTime: false,
}

/**
 * Format a Date's time portion respecting the user's 12/24-hour preference.
 * Uses Intl.DateTimeFormat with the runtime locale.
 */
export function formatTime(date: Date, use24h: boolean): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: use24h ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !use24h,
  }).format(date)
}

function readFromStorage(): AppSettings {
  try {
    const stored = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as AppSettings
    if (!Number.isFinite(stored.weekDays) || stored.weekDays < 3) stored.weekDays = 3
    return stored
  } catch (err) {
    console.warn('[useAppSettings] Failed to parse stored settings, using defaults:', err)
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
