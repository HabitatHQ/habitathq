import { describe, it, expect } from 'vitest'
import {
  STRICT_CSP,
  STRICT_CSP_DIRECTIVES,
  SETTINGS_STORAGE_KEY,
  parseStrictCspSetting,
} from '~/utils/csp'

// ─── STRICT_CSP_DIRECTIVES ────────────────────────────────────────────────────

describe('STRICT_CSP_DIRECTIVES', () => {
  it('is a non-empty readonly array', () => {
    expect(Array.isArray(STRICT_CSP_DIRECTIVES)).toBe(true)
    expect(STRICT_CSP_DIRECTIVES.length).toBeGreaterThan(0)
  })

  it('contains connect-src none to block all fetch/XHR', () => {
    expect(STRICT_CSP_DIRECTIVES).toContain("connect-src 'none'")
  })

  it('does NOT contain connect-src self (would allow network)', () => {
    expect(STRICT_CSP_DIRECTIVES).not.toContain("connect-src 'self'")
  })

  it('contains wasm-unsafe-eval for SQLite WASM compilation', () => {
    const scriptSrc = STRICT_CSP_DIRECTIVES.find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBeDefined()
    expect(scriptSrc).toContain("'wasm-unsafe-eval'")
  })

  it('allows worker blob: URLs for the DB worker', () => {
    const workerSrc = STRICT_CSP_DIRECTIVES.find((d) => d.startsWith('worker-src'))
    expect(workerSrc).toBeDefined()
    expect(workerSrc).toContain('blob:')
  })

  it('allows img blob: and data: for cached assets', () => {
    const imgSrc = STRICT_CSP_DIRECTIVES.find((d) => d.startsWith('img-src'))
    expect(imgSrc).toBeDefined()
    expect(imgSrc).toContain('blob:')
    expect(imgSrc).toContain('data:')
  })

  it('allows media blob: for voice note playback', () => {
    const mediaSrc = STRICT_CSP_DIRECTIVES.find((d) => d.startsWith('media-src'))
    expect(mediaSrc).toBeDefined()
    expect(mediaSrc).toContain('blob:')
  })

  it('blocks object-src to prevent plugin execution', () => {
    expect(STRICT_CSP_DIRECTIVES).toContain("object-src 'none'")
  })

  it('restricts base-uri to self', () => {
    expect(STRICT_CSP_DIRECTIVES).toContain("base-uri 'self'")
  })

  it('restricts form-action to self', () => {
    expect(STRICT_CSP_DIRECTIVES).toContain("form-action 'self'")
  })

  it('does NOT include frame-ancestors (meta tag limitation)', () => {
    const hasFrameAncestors = STRICT_CSP_DIRECTIVES.some((d) =>
      d.startsWith('frame-ancestors'),
    )
    expect(hasFrameAncestors).toBe(false)
  })

  it('has exactly one connect-src directive', () => {
    const connectSrcCount = STRICT_CSP_DIRECTIVES.filter((d) =>
      d.startsWith('connect-src'),
    ).length
    expect(connectSrcCount).toBe(1)
  })

  it('has exactly one default-src directive', () => {
    const count = STRICT_CSP_DIRECTIVES.filter((d) => d.startsWith('default-src')).length
    expect(count).toBe(1)
  })

  it('has no empty or whitespace-only directives', () => {
    for (const directive of STRICT_CSP_DIRECTIVES) {
      expect(directive.trim().length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate directives', () => {
    const names = STRICT_CSP_DIRECTIVES.map((d) => d.split(' ')[0])
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })
})

// ─── STRICT_CSP string ───────────────────────────────────────────────────────

describe('STRICT_CSP', () => {
  it('is a non-empty string', () => {
    expect(typeof STRICT_CSP).toBe('string')
    expect(STRICT_CSP.length).toBeGreaterThan(0)
  })

  it('is the directives joined with "; "', () => {
    expect(STRICT_CSP).toBe(STRICT_CSP_DIRECTIVES.join('; '))
  })

  it('contains connect-src none', () => {
    expect(STRICT_CSP).toContain("connect-src 'none'")
  })

  it('does not contain connect-src self', () => {
    expect(STRICT_CSP).not.toContain("connect-src 'self'")
  })

  it('has no trailing semicolon', () => {
    expect(STRICT_CSP.trimEnd().endsWith(';')).toBe(false)
  })

  it('has no newlines', () => {
    expect(STRICT_CSP).not.toMatch(/\n/)
  })

  it('is strictly more restrictive than a self-connect policy', () => {
    // The strict policy's connect-src must be 'none', not 'self'
    expect(STRICT_CSP).toMatch(/connect-src\s+'none'/)
    expect(STRICT_CSP).not.toMatch(/connect-src\s+'self'/)
  })
})

// ─── SETTINGS_STORAGE_KEY ─────────────────────────────────────────────────────

describe('SETTINGS_STORAGE_KEY', () => {
  it('is the correct localStorage key', () => {
    expect(SETTINGS_STORAGE_KEY).toBe('habitat-app-settings')
  })
})

// ─── parseStrictCspSetting ────────────────────────────────────────────────────

describe('parseStrictCspSetting', () => {
  it('returns false for null (no item in storage)', () => {
    expect(parseStrictCspSetting(null)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(parseStrictCspSetting('')).toBe(false)
  })

  it('returns false for invalid JSON', () => {
    expect(parseStrictCspSetting('not json')).toBe(false)
    expect(parseStrictCspSetting('{bad')).toBe(false)
    expect(parseStrictCspSetting('undefined')).toBe(false)
  })

  it('returns false for valid JSON that is not an object', () => {
    expect(parseStrictCspSetting('true')).toBe(false)
    expect(parseStrictCspSetting('42')).toBe(false)
    expect(parseStrictCspSetting('"string"')).toBe(false)
    expect(parseStrictCspSetting('null')).toBe(false)
    expect(parseStrictCspSetting('[]')).toBe(false)
  })

  it('returns false for object without strictCsp key', () => {
    expect(parseStrictCspSetting('{}')).toBe(false)
    expect(parseStrictCspSetting('{"enableToday":true}')).toBe(false)
    expect(parseStrictCspSetting('{"theme":"forest","reduceMotion":false}')).toBe(false)
  })

  it('returns false when strictCsp is false', () => {
    expect(parseStrictCspSetting('{"strictCsp":false}')).toBe(false)
  })

  it('returns false when strictCsp is a truthy non-boolean (strict equality)', () => {
    expect(parseStrictCspSetting('{"strictCsp":1}')).toBe(false)
    expect(parseStrictCspSetting('{"strictCsp":"true"}')).toBe(false)
    expect(parseStrictCspSetting('{"strictCsp":{}}')).toBe(false)
  })

  it('returns false when strictCsp is null or undefined', () => {
    expect(parseStrictCspSetting('{"strictCsp":null}')).toBe(false)
    expect(parseStrictCspSetting('{"strictCsp":undefined}')).toBe(false) // invalid JSON → parse error → false
  })

  it('returns true when strictCsp is boolean true', () => {
    expect(parseStrictCspSetting('{"strictCsp":true}')).toBe(true)
  })

  it('returns true even when other settings are present', () => {
    const settings = JSON.stringify({
      enableToday: true,
      theme: 'habitat',
      reduceMotion: false,
      strictCsp: true,
    })
    expect(parseStrictCspSetting(settings)).toBe(true)
  })

  it('returns false for a realistic default settings object (strictCsp: false)', () => {
    const defaults = JSON.stringify({
      enableToday: true,
      enableJournalling: true,
      enableHealth: false,
      enableWeek: false,
      enableTodos: false,
      enableBored: false,
      enableContextFilter: false,
      enableTimer: false,
      pomodoroWorkMinutes: 25,
      pomodoroShortBreakMinutes: 5,
      pomodoroLongBreakMinutes: 15,
      pomodoroCyclesBeforeLong: 4,
      weekDays: 3,
      matrixReverseDays: false,
      todoCalendarView: false,
      todoCalendarGrain: 'month',
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
      strictCsp: false,
    })
    expect(parseStrictCspSetting(defaults)).toBe(false)
  })

  it('returns true for a realistic enabled settings object', () => {
    const enabled = JSON.stringify({
      enableToday: true,
      theme: 'habitat',
      strictCsp: true,
    })
    expect(parseStrictCspSetting(enabled)).toBe(true)
  })
})

// ─── CSP composition (header + meta tag interaction) ─────────────────────────

describe('CSP composition: strict overrides base connect-src', () => {
  // When both a base CSP (connect-src 'self') and the strict CSP
  // (connect-src 'none') are present, the browser ANDs them.
  // The combined result must not allow any connections.
  it('strict CSP connect-src none wins over self in AND semantics', () => {
    const basePolicies = ["connect-src 'self'"]
    const strictPolicies = STRICT_CSP_DIRECTIVES.filter((d) => d.startsWith('connect-src'))

    // Simulate AND: a request is allowed only if ALL policies allow it
    function isAllowed(source: string): boolean {
      return basePolicies.every((p) => p.includes(source)) &&
             strictPolicies.every((p) => p.includes(source))
    }

    // 'self' connections are NOT allowed when strict adds 'none'
    expect(isAllowed("'self'")).toBe(false)
    // 'none' means nothing is allowed
    expect(isAllowed("'none'")).toBe(false)
  })

  it('strict CSP preserves all required non-network directives', () => {
    const required = ['script-src', 'style-src', 'img-src', 'worker-src', 'object-src']
    for (const directive of required) {
      const found = STRICT_CSP_DIRECTIVES.find((d) => d.startsWith(directive))
      expect(found, `missing ${directive}`).toBeDefined()
    }
  })
})
