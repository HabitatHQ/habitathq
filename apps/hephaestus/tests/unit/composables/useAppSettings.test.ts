import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readonly, ref } from 'vue'
import type { AppSettings } from '../../../app/composables/useAppSettings'
import { useAppSettings } from '../../../app/composables/useAppSettings'

const KEY = 'hephaestus-app-settings'
let store: Record<string, string> = {}
let failWrites = false
const mockLocalStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    if (failWrites) throw new Error('quota exceeded')
    store[key] = value
  },
}

beforeEach(() => {
  store = {}
  failWrites = false
  vi.stubGlobal('useState', <T>(_key: string, init: () => T) => ref(init()))
  vi.stubGlobal('readonly', readonly)
  vi.stubGlobal('localStorage', mockLocalStorage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function replacement(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    theme: 'forge',
    weightUnit: 'kg',
    distanceUnit: 'km',
    use24HourTime: false,
    reduceMotion: false,
    defaultRestSeconds: 120,
    showRpe: true,
    showRir: false,
    warmupRamps: [25, 50],
    showWarmupSuggestions: true,
    showFailurePrompt: true,
    showSessionNotes: true,
    showSetSchemes: false,
    showVariableRest: false,
    showSupersets: false,
    ...overrides,
  }
}

describe('useAppSettings', () => {
  it('hydrates stored object values over defaults and clones warmup ramps', async () => {
    store[KEY] = JSON.stringify({ theme: 'daylight', warmupRamps: [30, 55] })
    const { settings } = useAppSettings()
    expect(settings.value.theme).toBe('daylight')
    expect(settings.value.defaultRestSeconds).toBe(120)
    expect(settings.value.warmupRamps).toEqual([30, 55])
  })

  it.each(['{', 'null', '[]', '42'])(
    'falls back on malformed or non-record JSON (%s)',
    async (raw) => {
      store[KEY] = raw
      expect(useAppSettings().settings.value.theme).toBe('hephaestus')
    },
  )

  it('propagates write errors from set', async () => {
    const { set } = useAppSettings()
    failWrites = true
    expect(() => set('theme', 'forge')).toThrow('quota exceeded')
  })

  it('writes persistent replacements before changing state or cloning ramps', async () => {
    const { settings, replace } = useAppSettings()
    const before = settings.value
    const candidate = replacement()
    failWrites = true

    expect(() => replace(candidate)).toThrow('quota exceeded')
    expect(settings.value).toBe(before)
    expect(settings.value.theme).toBe('hephaestus')
    expect(settings.value.warmupRamps).toEqual([40, 60, 80])
    expect(candidate.warmupRamps).toEqual([25, 50])
  })

  it('persists replacement settings without retaining the caller’s mutable ramps', async () => {
    const { settings, replace } = useAppSettings()
    const candidate = replacement()

    replace(candidate)
    candidate.warmupRamps.push(75)
    expect(settings.value.warmupRamps).toEqual([25, 50])
    const persisted = store[KEY]
    if (persisted === undefined) throw new Error('Replacement settings were not persisted')
    expect(JSON.parse(persisted)).toEqual(replacement())
  })

  it('clones replacement ramps before publishing a successful non-persistent restore', async () => {
    const { settings, replace } = useAppSettings()
    const candidate = replacement()

    replace(candidate, false)
    expect(settings.value).toEqual(candidate)
    expect(settings.value.warmupRamps).not.toBe(candidate.warmupRamps)
    candidate.warmupRamps.push(75)
    expect(settings.value.warmupRamps).toEqual([25, 50])
  })
})
