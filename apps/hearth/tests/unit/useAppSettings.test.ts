import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

// ── useAppSettings ────────────────────────────────────────────────────────
// Import fresh module state via vi.resetModules() + dynamic import so each
// describe block gets isolated module-level reactive state.

const STORAGE_KEY = 'hearth-settings'

function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Silence unused – localDate is a helper for copy-paste safety. Just a sanity reference.
void localDate

// ── Defaults ──────────────────────────────────────────────────────────────

describe('useAppSettings — defaults', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default theme "hearth"', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, reset } = useAppSettings()
    reset() // ensure clean state in case module was already loaded
    expect(settings.value.theme).toBe('hearth')
  })

  it('returns default colorMode "dark"', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, reset } = useAppSettings()
    reset()
    expect(settings.value.colorMode).toBe('dark')
  })

  it('returns default currency "USD"', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, reset } = useAppSettings()
    reset()
    expect(settings.value.currency).toBe('USD')
  })

  it('returns reduceMotion false by default', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, reset } = useAppSettings()
    reset()
    expect(settings.value.reduceMotion).toBe(false)
  })

  it('returns stickyNav true by default', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, reset } = useAppSettings()
    reset()
    expect(settings.value.stickyNav).toBe(true)
  })
})

// ── set() ─────────────────────────────────────────────────────────────────

describe('useAppSettings — set()', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('updates a single key without affecting others', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, set, reset } = useAppSettings()
    reset()
    set('theme', 'ocean')
    expect(settings.value.theme).toBe('ocean')
    expect(settings.value.colorMode).toBe('dark') // unchanged
    expect(settings.value.currency).toBe('USD') // unchanged
  })

  it('updates colorMode', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, set, reset } = useAppSettings()
    reset()
    set('colorMode', 'light')
    expect(settings.value.colorMode).toBe('light')
  })

  it('updates boolean flag', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, set, reset } = useAppSettings()
    reset()
    set('reduceMotion', true)
    expect(settings.value.reduceMotion).toBe(true)
  })

  it('persists to localStorage after set()', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { set, reset } = useAppSettings()
    reset()
    set('currency', 'EUR')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(stored.currency).toBe('EUR')
  })

  it('multiple set() calls accumulate correctly', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, set, reset } = useAppSettings()
    reset()
    set('theme', 'forest')
    set('colorMode', 'system')
    set('reduceMotion', true)
    expect(settings.value.theme).toBe('forest')
    expect(settings.value.colorMode).toBe('system')
    expect(settings.value.reduceMotion).toBe(true)
  })

  it('all three themes are accepted', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, set, reset } = useAppSettings()
    reset()
    for (const theme of ['hearth', 'forest', 'ocean'] as const) {
      set('theme', theme)
      expect(settings.value.theme).toBe(theme)
    }
  })
})

// ── reset() ───────────────────────────────────────────────────────────────

describe('useAppSettings — reset()', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('restores all defaults after mutation', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, set, reset } = useAppSettings()
    reset()
    set('theme', 'ocean')
    set('colorMode', 'light')
    set('reduceMotion', true)
    reset()
    expect(settings.value.theme).toBe('hearth')
    expect(settings.value.colorMode).toBe('dark')
    expect(settings.value.reduceMotion).toBe(false)
  })

  it('persists defaults to localStorage after reset()', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { set, reset } = useAppSettings()
    reset()
    set('theme', 'ocean')
    reset()
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(stored.theme).toBe('hearth')
  })
})

// ── localStorage persistence ──────────────────────────────────────────────

describe('useAppSettings — localStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('hydrates partial object records over defaults', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'forest' }))
    vi.resetModules()
    const { useAppSettings } = await import('../../app/composables/useAppSettings')
    const { settings } = useAppSettings()
    expect(settings.value.theme).toBe('forest')
    expect(settings.value.currency).toBe('USD')
  })

  it.each(['{', 'null', '[]', '42'])('defaults malformed or non-record stored JSON (%s)', async (raw) => {
    localStorage.setItem(STORAGE_KEY, raw)
    vi.resetModules()
    const { useAppSettings } = await import('../../app/composables/useAppSettings')
    expect(useAppSettings().settings.value.theme).toBe('hearth')
  })

  it('propagates storage write errors from set', async () => {
    vi.resetModules()
    const { useAppSettings } = await import('../../app/composables/useAppSettings')
    const { set } = useAppSettings()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => set('theme', 'ocean')).toThrow('quota exceeded')
  })

  it('set() stores complete settings object (not partial)', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { set, reset } = useAppSettings()
    reset()
    set('theme', 'ocean')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    // All keys should be present
    expect(stored).toHaveProperty('theme', 'ocean')
    expect(stored).toHaveProperty('colorMode')
    expect(stored).toHaveProperty('currency')
    expect(stored).toHaveProperty('reduceMotion')
    expect(stored).toHaveProperty('stickyNav')
  })
})

// ── shared reactive state ─────────────────────────────────────────────────

describe('useAppSettings — shared state', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('two calls to useAppSettings() share the same reactive ref', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const a = useAppSettings()
    const b = useAppSettings()
    a.reset()
    a.set('theme', 'forest')
    // b.settings should reflect the mutation from a
    expect(b.settings.value.theme).toBe('forest')
  })
})

// ── voiceAutoSubmitTimeout ───────────────────────────────────────────────

describe('useAppSettings — voiceAutoSubmitTimeout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to 2 seconds', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, reset } = useAppSettings()
    reset()
    expect(settings.value.voiceAutoSubmitTimeout).toBe(2)
  })

  it('accepts 0 (off), 1, 2, 3 as valid values', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, set, reset } = useAppSettings()
    reset()
    for (const val of [0, 1, 2, 3] as const) {
      set('voiceAutoSubmitTimeout', val)
      expect(settings.value.voiceAutoSubmitTimeout).toBe(val)
    }
  })

  it('persists to localStorage', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { set, reset } = useAppSettings()
    reset()
    set('voiceAutoSubmitTimeout', 3)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(stored.voiceAutoSubmitTimeout).toBe(3)
  })

  it('resets to default 2', async () => {
    const { useAppSettings } = await import('~/composables/useAppSettings')
    const { settings, set, reset } = useAppSettings()
    set('voiceAutoSubmitTimeout', 0)
    reset()
    expect(settings.value.voiceAutoSubmitTimeout).toBe(2)
  })
})
