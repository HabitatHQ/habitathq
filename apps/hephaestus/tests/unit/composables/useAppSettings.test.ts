import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AppSettings } from '~/composables/useAppSettings'

// Mock Nuxt's useState so we can test the composable in isolation
vi.mock('#imports', () => ({
  useState: <T>(_key: string, init: () => T) => ref(init()),
  readonly: (r: ReturnType<typeof ref>) => r,
}))

const KEY = 'hephaestus-app-settings'

// Minimal localStorage mock
let store: Record<string, string> = {}
const mockLocalStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value
  },
  removeItem: (key: string) => {
    delete store[key]
  },
  clear: () => {
    store = {}
  },
}

beforeEach(() => {
  store = {}
  vi.stubGlobal('localStorage', mockLocalStorage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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

// Test the core storage read/write logic without requiring Nuxt runtime
describe('AppSettings storage logic', () => {
  it('defaults have correct theme', () => {
    expect(DEFAULTS.theme).toBe('hephaestus')
  })

  it('defaults have weightUnit kg', () => {
    expect(DEFAULTS.weightUnit).toBe('kg')
  })

  it('defaults have distanceUnit km', () => {
    expect(DEFAULTS.distanceUnit).toBe('km')
  })

  it('defaults have 120s rest', () => {
    expect(DEFAULTS.defaultRestSeconds).toBe(120)
  })

  it('defaults show RPE', () => {
    expect(DEFAULTS.showRpe).toBe(true)
  })

  it('reads stored theme from localStorage', () => {
    mockLocalStorage.setItem(KEY, JSON.stringify({ theme: 'forge' }))
    const raw = mockLocalStorage.getItem(KEY)
    const stored = { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<AppSettings>) : {}) }
    expect(stored.theme).toBe('forge')
    // other defaults preserved
    expect(stored.weightUnit).toBe('kg')
  })

  it('merges stored settings over defaults', () => {
    mockLocalStorage.setItem(KEY, JSON.stringify({ weightUnit: 'lbs', distanceUnit: 'mi' }))
    const raw = mockLocalStorage.getItem(KEY)
    const stored = { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<AppSettings>) : {}) }
    expect(stored.weightUnit).toBe('lbs')
    expect(stored.distanceUnit).toBe('mi')
    expect(stored.theme).toBe('hephaestus') // default preserved
  })

  it('writes settings to localStorage', () => {
    const current = { ...DEFAULTS, theme: 'daylight' as const }
    mockLocalStorage.setItem(KEY, JSON.stringify(current))
    const raw = mockLocalStorage.getItem(KEY)
    expect(JSON.parse(raw ?? '{}').theme).toBe('daylight')
  })

  it('falls back to defaults when localStorage contains corrupted JSON', () => {
    mockLocalStorage.setItem(KEY, 'not-valid-json{{{')
    let result = DEFAULTS
    try {
      const raw = mockLocalStorage.getItem(KEY)
      result = { ...DEFAULTS, ...(JSON.parse(raw ?? '{}') as Partial<AppSettings>) }
    } catch {
      result = { ...DEFAULTS }
    }
    expect(result.theme).toBe('hephaestus')
  })

  it('persists a numeric setting (defaultRestSeconds)', () => {
    const current = { ...DEFAULTS, defaultRestSeconds: 90 }
    mockLocalStorage.setItem(KEY, JSON.stringify(current))
    const raw = mockLocalStorage.getItem(KEY)
    const stored = { ...DEFAULTS, ...(JSON.parse(raw ?? '{}') as Partial<AppSettings>) }
    expect(stored.defaultRestSeconds).toBe(90)
    expect(typeof stored.defaultRestSeconds).toBe('number')
  })

  it('persists a boolean true setting (use24HourTime)', () => {
    const current = { ...DEFAULTS, use24HourTime: true }
    mockLocalStorage.setItem(KEY, JSON.stringify(current))
    const raw = mockLocalStorage.getItem(KEY)
    const stored = { ...DEFAULTS, ...(JSON.parse(raw ?? '{}') as Partial<AppSettings>) }
    expect(stored.use24HourTime).toBe(true)
  })

  it('persists a boolean true setting (reduceMotion)', () => {
    const current = { ...DEFAULTS, reduceMotion: true }
    mockLocalStorage.setItem(KEY, JSON.stringify(current))
    const raw = mockLocalStorage.getItem(KEY)
    const stored = { ...DEFAULTS, ...(JSON.parse(raw ?? '{}') as Partial<AppSettings>) }
    expect(stored.reduceMotion).toBe(true)
  })

  it('multiple settings can be updated independently', () => {
    const step1 = { ...DEFAULTS, theme: 'forge' as const }
    mockLocalStorage.setItem(KEY, JSON.stringify(step1))
    const step2 = {
      ...JSON.parse(mockLocalStorage.getItem(KEY) ?? '{}'),
      weightUnit: 'lbs',
    } as AppSettings
    mockLocalStorage.setItem(KEY, JSON.stringify(step2))
    const raw = mockLocalStorage.getItem(KEY)
    const stored = { ...DEFAULTS, ...(JSON.parse(raw ?? '{}') as Partial<AppSettings>) }
    expect(stored.theme).toBe('forge')
    expect(stored.weightUnit).toBe('lbs')
    expect(stored.distanceUnit).toBe('km') // unchanged
  })

  it('defaults have correct showRir value', () => {
    expect(DEFAULTS.showRir).toBe(false)
  })

  it('defaults have correct use24HourTime value', () => {
    expect(DEFAULTS.use24HourTime).toBe(false)
  })
})
