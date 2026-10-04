import { describe, expect, it, vi } from 'vitest'
import { readStoredSettings, type SettingsStorage, writeStoredSettings } from './settings.js'

type Prefs = { theme: string; days: number[] }

function storageWith(value: string | null): SettingsStorage {
  return {
    getItem: () => value,
    setItem: vi.fn(),
  }
}

const defaults = (): Prefs => ({ theme: 'default', days: [1, 2] })

describe('settings persistence', () => {
  it.each([null, '{', 'null', 'false', '42', '"string"', '[]'])(
    'returns fresh defaults for absent, malformed, or non-record JSON: %s',
    (raw) => {
      const storage = storageWith(raw)
      const first = readStoredSettings<Prefs>('prefs', { storage, defaults })
      const second = readStoredSettings<Prefs>('prefs', { storage, defaults })
      expect(first).toEqual({ theme: 'default', days: [1, 2] })
      expect(first).not.toBe(second)
      expect(first.days).not.toBe(second.days)
    },
  )

  it('merges a stored object over fresh defaults and delegates app normalization', () => {
    const storage = storageWith('{"theme":"dark","days":[7]}')
    const normalize = vi.fn((record: Record<string, unknown>, fresh: Prefs) => ({
      ...fresh,
      ...record,
      days: [...fresh.days],
    }))
    const result = readStoredSettings<Prefs>('prefs', { storage, defaults, normalize })
    expect(result).toEqual({ theme: 'dark', days: [1, 2] })
  })

  it.each(['{', 'null', '[]', 'false'])(
    'does not apply stored-record migrations to invalid preferences: %s',
    (raw) => {
      const result = readStoredSettings<Prefs>('prefs', {
        storage: storageWith(raw),
        defaults,
        normalize: (_stored, fresh, storedRaw) => ({
          ...fresh,
          theme: storedRaw ? 'migrated' : 'new',
        }),
      })
      expect(result).toEqual({ theme: 'default', days: [1, 2] })
    },
  )

  it('falls back on inaccessible reads and propagates storage write failures', () => {
    const storage: SettingsStorage = {
      getItem: () => {
        throw new Error('read denied')
      },
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    expect(readStoredSettings<Prefs>('prefs', { storage, defaults })).toEqual({
      theme: 'default',
      days: [1, 2],
    })
    expect(() => writeStoredSettings('prefs', { theme: 'saved' }, storage)).toThrow(
      'quota exceeded',
    )
  })
})
