import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SETTINGS_KEY = 'halcyon-settings'

beforeEach(() => localStorage.clear())

// Reload the module after seeding storage because hydration creates its singleton at module load.

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useAppSettings', () => {
  it('hydrates a partial object and keeps missing preferences at defaults', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }))
    vi.resetModules()
    const { useAppSettings } = await import('../../app/composables/useAppSettings')
    const { settings } = useAppSettings()
    expect(settings.value.theme).toBe('dark')
    expect(settings.value.defaultVaultId).toBeNull()
  })

  it.each(['{', 'null', '[]', '42'])('uses defaults for malformed or non-record JSON (%s)', async (raw) => {
    localStorage.setItem(SETTINGS_KEY, raw)
    vi.resetModules()
    const { useAppSettings } = await import('../../app/composables/useAppSettings')
    expect(useAppSettings().settings.value).toEqual({ theme: 'auto', defaultVaultId: null })
  })

  it('propagates storage write failures from set', async () => {
    vi.resetModules()
    const { useAppSettings } = await import('../../app/composables/useAppSettings')
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => useAppSettings().set('theme', 'light')).toThrow('quota exceeded')
  })
})
