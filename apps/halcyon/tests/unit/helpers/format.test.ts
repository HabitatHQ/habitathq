import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateRelative,
  formatDuration,
  formatRelativeTime,
  localDateString,
  parseDateString,
} from '~/utils/format'

// ─── localDateString ──────────────────────────────────────────────────────────

describe('localDateString', () => {
  it('returns YYYY-MM-DD string from a Date object', () => {
    const d = new Date(2024, 2, 15) // March 15 2024 (local)
    expect(localDateString(d)).toBe('2024-03-15')
  })
})

// ─── parseDateString ──────────────────────────────────────────────────────────

describe('parseDateString', () => {
  it('parses YYYY-MM-DD without timezone shifting', () => {
    const d = parseDateString('2024-03-15')
    expect(d.getFullYear()).toBe(2024)
    expect(d.getMonth()).toBe(2) // 0-indexed
    expect(d.getDate()).toBe(15)
  })
})

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats a YYYY-MM-DD string to a human-readable date', () => {
    const result = formatDate('2024-03-15')
    expect(result).toMatch(/March 15,? 2024/)
  })

  it('returns empty string for null/undefined', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
  })
})

// ─── formatDateRelative ───────────────────────────────────────────────────────

describe('formatDateRelative', () => {
  it('returns "Today" for today', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(formatDateRelative(today, today)).toBe('Today')
  })

  it('returns "Yesterday" for yesterday', () => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const yesterday = d.toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    expect(formatDateRelative(yesterday, today)).toBe('Yesterday')
  })

  it('returns "Tomorrow" for tomorrow', () => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const tomorrow = d.toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    expect(formatDateRelative(tomorrow, today)).toBe('Tomorrow')
  })

  it('returns "in Nd" for dates within 7 days', () => {
    expect(formatDateRelative('2024-03-20', '2024-03-15')).toBe('in 5d')
  })

  it('returns "Nd ago" for dates within past 7 days', () => {
    expect(formatDateRelative('2024-03-10', '2024-03-15')).toBe('5d ago')
  })

  it('formats older dates as a short date string', () => {
    const result = formatDateRelative('2024-01-01', '2024-03-15')
    expect(result).toMatch(/Jan|January/)
  })
})

// ─── formatRelativeTime ───────────────────────────────────────────────────────

describe('formatRelativeTime', () => {
  it('returns "just now" for very recent timestamps', () => {
    const now = new Date().toISOString()
    expect(formatRelativeTime(now)).toBe('just now')
  })

  it('returns "X min ago" for timestamps within the hour', () => {
    const d = new Date()
    d.setMinutes(d.getMinutes() - 45)
    expect(formatRelativeTime(d.toISOString())).toBe('45 min ago')
  })

  it('returns "X h ago" for timestamps within the day', () => {
    const d = new Date()
    d.setHours(d.getHours() - 3)
    expect(formatRelativeTime(d.toISOString())).toBe('3 h ago')
  })
})

// ─── formatDuration ───────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('returns "1 min" for 1 minute', () => {
    expect(formatDuration(1)).toBe('1 min')
  })

  it('returns "45 min" for 45 minutes', () => {
    expect(formatDuration(45)).toBe('45 min')
  })

  it('returns "1 h" for 60 minutes', () => {
    expect(formatDuration(60)).toBe('1 h')
  })

  it('returns "1 h 30 min" for 90 minutes', () => {
    expect(formatDuration(90)).toBe('1 h 30 min')
  })

  it('returns null for null input', () => {
    expect(formatDuration(null)).toBeNull()
  })
})
