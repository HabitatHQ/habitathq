import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateRelative,
  formatDuration,
  formatRelativeTime,
  localDateString,
  parseDateString,
} from '~/utils/format'

// ─── localDateString edge cases ───────────────────────────────────────────────

describe('localDateString — edge cases', () => {
  it('zero-pads single-digit months', () => {
    expect(localDateString(new Date(2024, 0, 5))).toBe('2024-01-05') // Jan 5
  })

  it('zero-pads single-digit days', () => {
    expect(localDateString(new Date(2024, 11, 3))).toBe('2024-12-03') // Dec 3
  })

  it('handles year boundaries', () => {
    expect(localDateString(new Date(2024, 11, 31))).toBe('2024-12-31')
    expect(localDateString(new Date(2025, 0, 1))).toBe('2025-01-01')
  })
})

// ─── parseDateString edge cases ───────────────────────────────────────────────

describe('parseDateString — edge cases', () => {
  it('does not shift dates across UTC boundaries', () => {
    const d = parseDateString('2024-01-01')
    expect(d.getFullYear()).toBe(2024)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(1)
  })

  it('parses leap day correctly', () => {
    const d = parseDateString('2024-02-29')
    expect(d.getDate()).toBe(29)
    expect(d.getMonth()).toBe(1)
  })
})

// ─── formatDate edge cases ────────────────────────────────────────────────────

describe('formatDate — edge cases', () => {
  it('handles empty string', () => {
    expect(formatDate('')).toBe('')
  })

  it('formats dates with single-digit day correctly', () => {
    const result = formatDate('2024-01-05')
    expect(result).toContain('5')
    expect(result).toContain('2024')
  })
})

// ─── formatDateRelative edge cases ────────────────────────────────────────────

describe('formatDateRelative — edge cases', () => {
  it('returns Today for today', () => {
    const today = '2024-06-15'
    expect(formatDateRelative('2024-06-15', today)).toBe('Today')
  })

  it('handles exactly 7 days boundary', () => {
    const result = formatDateRelative('2024-06-22', '2024-06-15')
    expect(result).toBe('in 7d')
  })

  it('handles exactly -7 days boundary', () => {
    const result = formatDateRelative('2024-06-08', '2024-06-15')
    expect(result).toBe('7d ago')
  })

  it('uses short date format for dates >7 days away', () => {
    const result = formatDateRelative('2024-01-01', '2024-06-15')
    expect(result).toMatch(/Jan/)
  })

  it('uses short date format for dates >7 days past', () => {
    const result = formatDateRelative('2023-01-01', '2024-06-15')
    expect(result).toMatch(/Jan|2023/)
  })
})

// ─── formatRelativeTime edge cases ────────────────────────────────────────────

describe('formatRelativeTime — edge cases', () => {
  it('returns "just now" for 0 seconds ago', () => {
    const now = new Date().toISOString()
    expect(formatRelativeTime(now)).toBe('just now')
  })

  it('returns "just now" for 30 seconds ago', () => {
    const d = new Date(Date.now() - 30_000)
    expect(formatRelativeTime(d.toISOString())).toBe('just now')
  })

  it('returns "1 min ago" for exactly 60 seconds', () => {
    const d = new Date(Date.now() - 60_000)
    expect(formatRelativeTime(d.toISOString())).toBe('1 min ago')
  })

  it('handles plural days correctly', () => {
    const d = new Date(Date.now() - 3 * 86_400_000)
    expect(formatRelativeTime(d.toISOString())).toBe('3 days ago')
  })

  it('returns "1 day ago" (singular) for one day', () => {
    const d = new Date(Date.now() - 86_400_000)
    expect(formatRelativeTime(d.toISOString())).toBe('1 day ago')
  })
})

// ─── formatDuration edge cases ────────────────────────────────────────────────

describe('formatDuration — edge cases', () => {
  it('handles 0 minutes', () => {
    expect(formatDuration(0)).toBe('0 min')
  })

  it('handles exactly 2 hours', () => {
    expect(formatDuration(120)).toBe('2 h')
  })

  it('handles 2 hours 30 minutes', () => {
    expect(formatDuration(150)).toBe('2 h 30 min')
  })

  it('handles null', () => {
    expect(formatDuration(null)).toBeNull()
  })
})
