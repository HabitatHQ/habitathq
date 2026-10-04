import { readStoredSettings, writeStoredSettings } from '@habitathq/utils'
export type AppTheme = 'habitat' | 'forest' | 'ocean'
export type AppProfile = 'minimalist' | 'journaler' | 'productivity' | 'mindful'

export interface AppSettings {
  hasCompletedOnboarding: boolean
  enableToday: boolean
  enableJournalling: boolean
  enableHealth: boolean
  enableTodos: boolean
  enableBored: boolean
  autoShowBored: boolean
  enableContextFilter: boolean
  enableTimer: boolean
  pomodoroWorkMinutes: number
  pomodoroShortBreakMinutes: number
  pomodoroLongBreakMinutes: number
  pomodoroCyclesBeforeLong: number
  weekDays: number
  matrixReverseDays: boolean
  showTagsOnHabits: boolean
  showAnnotationsOnHabits: boolean
  showTagsOnToday: boolean
  showAnnotationsOnToday: boolean
  stickyNav: boolean
  navExtraPadding: boolean
  headerExtraPadding: boolean
  logInputMode: 'absolute' | 'increment'
  saveTranscribedNotes: boolean
  use24HourTime: boolean
  theme: AppTheme
  reduceMotion: boolean
  enableHaptics: boolean
  strictCsp: boolean
  tabOrder: string[]
}

export const POMODORO_SETTING_KEYS = [
  'pomodoroWorkMinutes',
  'pomodoroShortBreakMinutes',
  'pomodoroLongBreakMinutes',
  'pomodoroCyclesBeforeLong',
] as const

export type PomodoroSettingKey = (typeof POMODORO_SETTING_KEYS)[number]

export const POMODORO_SETTING_RULES = {
  pomodoroWorkMinutes: { min: 1, max: 90, defaultValue: 25 },
  pomodoroShortBreakMinutes: { min: 1, max: 60, defaultValue: 5 },
  pomodoroLongBreakMinutes: { min: 1, max: 60, defaultValue: 15 },
  pomodoroCyclesBeforeLong: { min: 1, max: 10, defaultValue: 4 },
} as const satisfies Record<PomodoroSettingKey, { min: number; max: number; defaultValue: number }>

const KEY = 'habitat-app-settings'
const DEFAULTS: AppSettings = {
  hasCompletedOnboarding: false,
  enableToday: true,
  enableJournalling: true,
  enableHealth: false,
  enableTodos: true,
  enableBored: false,
  autoShowBored: true,
  enableContextFilter: false,
  enableTimer: true,
  pomodoroWorkMinutes: POMODORO_SETTING_RULES.pomodoroWorkMinutes.defaultValue,
  pomodoroShortBreakMinutes: POMODORO_SETTING_RULES.pomodoroShortBreakMinutes.defaultValue,
  pomodoroLongBreakMinutes: POMODORO_SETTING_RULES.pomodoroLongBreakMinutes.defaultValue,
  pomodoroCyclesBeforeLong: POMODORO_SETTING_RULES.pomodoroCyclesBeforeLong.defaultValue,
  weekDays: 3,
  matrixReverseDays: false,
  showTagsOnHabits: false,
  showAnnotationsOnHabits: false,
  showTagsOnToday: false,
  showAnnotationsOnToday: false,
  stickyNav: true,
  navExtraPadding: false,
  headerExtraPadding: true,
  logInputMode: 'absolute',
  saveTranscribedNotes: true,
  use24HourTime: false,
  theme: 'habitat',
  reduceMotion: false,
  enableHaptics: true,
  strictCsp: false,
  tabOrder: [],
}

function freshDefaults(): AppSettings {
  return { ...DEFAULTS, tabOrder: [...DEFAULTS.tabOrder] }
}

export function isPomodoroSettingKey(key: keyof AppSettings): key is PomodoroSettingKey {
  return key in POMODORO_SETTING_RULES
}

export function isValidPomodoroSettingValue(
  key: PomodoroSettingKey,
  value: unknown,
): value is number {
  const { min, max } = POMODORO_SETTING_RULES[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function normalizePomodoroSettingValue(key: PomodoroSettingKey, value: unknown): number {
  return isValidPomodoroSettingValue(key, value) ? value : POMODORO_SETTING_RULES[key].defaultValue
}

export function applyAppSetting<K extends keyof AppSettings>(
  current: AppSettings,
  key: K,
  value: AppSettings[K],
): AppSettings {
  if (isPomodoroSettingKey(key) && !isValidPomodoroSettingValue(key, value)) {
    const safeCurrent = normalizePomodoroSettingValue(key, current[key])
    return safeCurrent === current[key] ? current : { ...current, [key]: safeCurrent }
  }
  return { ...current, [key]: value }
}

export function applyAppSettingsPatch(
  current: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  const next = { ...current, ...patch }
  for (const key of POMODORO_SETTING_KEYS) {
    if (Object.hasOwn(patch, key) && !isValidPomodoroSettingValue(key, patch[key])) {
      next[key] = normalizePomodoroSettingValue(key, current[key])
    }
  }
  return next
}

/**
 * Feature profile definitions for onboarding and debugging.
 * Each profile specifies which top-level modules are active.
 */
export const PROFILE_SETTINGS: Record<AppProfile, Partial<AppSettings>> = {
  minimalist: {
    enableJournalling: false,
    enableHealth: false,
    enableTodos: false,
    enableContextFilter: false,
    enableTimer: false,
    enableBored: false,
  },
  journaler: {
    enableJournalling: true,
    enableHealth: false,
    enableTodos: false,
    enableContextFilter: false,
    enableTimer: false,
    enableBored: false,
  },
  productivity: {
    enableJournalling: false,
    enableHealth: false,
    enableTodos: true,
    enableContextFilter: true,
    enableTimer: true,
    enableBored: true,
  },
  mindful: {
    enableJournalling: true,
    enableHealth: false,
    enableTodos: true,
    enableContextFilter: true,
    enableTimer: true,
    enableBored: true,
  },
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

export function normalizeAppSettings(
  parsed: Record<string, unknown>,
  isExistingUser = false,
  defaults: AppSettings = freshDefaults(),
): AppSettings {
  const {
    enablePlanner: _enablePlanner,
    todoCalendarView: _todoCalendarView,
    todoCalendarGrain: _todoCalendarGrain,
    ...currentSettings
  } = parsed
  const stored = { ...defaults, ...currentSettings } as AppSettings

  if (isExistingUser && typeof parsed['hasCompletedOnboarding'] === 'undefined') {
    stored.hasCompletedOnboarding = true
  }

  if (!Number.isFinite(stored.weekDays) || stored.weekDays < 3 || stored.weekDays > 7) {
    stored.weekDays = 3
  }
  for (const key of POMODORO_SETTING_KEYS) {
    stored[key] = normalizePomodoroSettingValue(key, stored[key])
  }
  stored.tabOrder = Array.isArray(stored.tabOrder) ? [...stored.tabOrder] : [...defaults.tabOrder]
  return stored
}

function readFromStorage(): AppSettings {
  return readStoredSettings<AppSettings>(KEY, {
    defaults: freshDefaults,
    normalize: (parsed, defaults, raw) => {
      let existingData = false
      try {
        existingData = localStorage.getItem('habitat-has-data') === '1'
      } catch {
        // Storage access failure falls back to the safe defaults.
      }
      return normalizeAppSettings(parsed, !!raw || existingData, defaults)
    },
  })
}

export function useAppSettings() {
  // useState gives a singleton ref shared across all composable calls (key-deduplicated)
  const settings = useState<AppSettings>('app-settings', () =>
    import.meta.client ? readFromStorage() : freshDefaults(),
  )

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const next = applyAppSetting(settings.value, key, value)
    if (next === settings.value) return
    settings.value = next
    if (import.meta.client) writeStoredSettings(KEY, settings.value)
  }

  /**
   * Update multiple settings at once to trigger only a single reactive update
   * and single localStorage write.
   */
  function patch(patch: Partial<AppSettings>) {
    settings.value = applyAppSettingsPatch(settings.value, patch)
    if (import.meta.client) writeStoredSettings(KEY, settings.value)
  }

  function applyProfile(id: AppProfile) {
    patch(PROFILE_SETTINGS[id])
  }

  return { settings: readonly(settings), set, patch, applyProfile }
}
