import { readStoredSettings, writeStoredSettings } from '@habitathq/utils'
import { readonly, ref } from 'vue'

export type AppTheme = 'hearth' | 'forest' | 'ocean'
export type ColorMode = 'dark' | 'light' | 'system'
export type NlpTier = 'regex' | 'embeddings' | 'llm'

export interface AppSettings {
  theme: AppTheme
  colorMode: ColorMode
  reduceMotion: boolean
  stickyNav: boolean
  headerExtraPadding: boolean
  navExtraPadding: boolean
  currency: string
  nlpTier: NlpTier
  defaultExpenseAccount: string | null
  defaultIncomeAccount: string | null
  voiceAutoSubmitTimeout: 0 | 1 | 2 | 3
}

const DEFAULTS = (): AppSettings => ({
  theme: 'hearth',
  colorMode: 'dark',
  reduceMotion: false,
  stickyNav: true,
  headerExtraPadding: false,
  navExtraPadding: false,
  currency: 'USD',
  nlpTier: 'regex',
  defaultExpenseAccount: null,
  defaultIncomeAccount: null,
  voiceAutoSubmitTimeout: 2,
})

const STORAGE_KEY = 'hearth-settings'

function load(): AppSettings {
  if (!import.meta.client) return DEFAULTS()
  return readStoredSettings<AppSettings>(STORAGE_KEY, { defaults: DEFAULTS })
}

function save(settings: AppSettings) {
  if (!import.meta.client) return
  writeStoredSettings(STORAGE_KEY, settings)
}

// Module-level reactive state — shared across all composable calls
const settings = ref<AppSettings>(load())

export function useAppSettings() {
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    settings.value = { ...settings.value, [key]: value }
    save(settings.value)
  }

  function reset() {
    settings.value = DEFAULTS()
    save(settings.value)
  }

  return { settings: readonly(settings), set, reset }
}
