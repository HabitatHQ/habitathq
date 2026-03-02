import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fmtDuration,
  timeAgo,
  fmtLogDate,
  fmtLogTime,
  fmtArchived,
  dayLabel,
  dayNum,
  fmtDate,
} from '~/utils/format'

// ─── fmtDuration ─────────────────────────────────────────────────────────────

describe('fmtDuration', () => {
  it('formats zero seconds', () => {
    expect(fmtDuration(0)).toBe('0:00')
  })

  it('formats under a minute', () => {
    expect(fmtDuration(45)).toBe('0:45')
  })

  it('formats exactly one minute', () => {
    expect(fmtDuration(60)).toBe('1:00')
  })

  it('pads single-digit seconds with a leading zero', () => {
    expect(fmtDuration(125)).toBe('2:05')
  })

  it('handles durations over an hour', () => {
    expect(fmtDuration(3661)).toBe('61:01')
  })
})

// ─── timeAgo ─────────────────────────────────────────────────────────────────

describe('timeAgo', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns "just now" for less than 1 minute', () => {
    vi.setSystemTime(new Date('2024-03-01T12:00:30Z'))
    expect(timeAgo('2024-03-01T12:00:00Z')).toBe('just now')
  })

  it('returns Xm ago for less than 1 hour', () => {
    vi.setSystemTime(new Date('2024-03-01T12:30:00Z'))
    expect(timeAgo('2024-03-01T12:00:00Z')).toBe('30m ago')
  })

  it('returns Xh ago for less than 24 hours', () => {
    vi.setSystemTime(new Date('2024-03-01T15:00:00Z'))
    expect(timeAgo('2024-03-01T12:00:00Z')).toBe('3h ago')
  })

  it('returns Xd ago for less than 7 days', () => {
    vi.setSystemTime(new Date('2024-03-04T12:00:00Z'))
    expect(timeAgo('2024-03-01T12:00:00Z')).toBe('3d ago')
  })

  it('returns a locale date string for 7+ days ago', () => {
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'))
    const result = timeAgo('2024-03-01T12:00:00Z')
    expect(result).toMatch(/Mar/)
    expect(result).toMatch(/1/)
  })
})

// ─── fmtLogDate ──────────────────────────────────────────────────────────────

describe('fmtLogDate', () => {
  // 2024-01-15 is a Monday
  it('includes weekday abbreviation', () => {
    expect(fmtLogDate('2024-01-15T09:05:00')).toMatch(/Mon/)
  })

  it('includes month abbreviation', () => {
    expect(fmtLogDate('2024-01-15T09:05:00')).toMatch(/Jan/)
  })

  it('includes day of month', () => {
    expect(fmtLogDate('2024-01-15T09:05:00')).toMatch(/15/)
  })
})

// ─── fmtLogTime ──────────────────────────────────────────────────────────────

describe('fmtLogTime', () => {
  it('pads minutes with a leading zero', () => {
    expect(fmtLogTime('2024-01-15T09:05:00')).toMatch(/05/)
  })

  it('returns a non-empty string', () => {
    expect(fmtLogTime('2024-01-15T14:30:00')).toBeTruthy()
  })
})

// ─── fmtArchived ─────────────────────────────────────────────────────────────

describe('fmtArchived', () => {
  it('includes month, day, and year', () => {
    const result = fmtArchived('2024-03-15T00:00:00')
    expect(result).toMatch(/Mar/)
    expect(result).toMatch(/15/)
    expect(result).toMatch(/2024/)
  })

  it('does not include a time component', () => {
    expect(fmtArchived('2024-03-15T14:30:00')).not.toMatch(/\d+:\d+/)
  })
})

// ─── dayLabel ────────────────────────────────────────────────────────────────

describe('dayLabel', () => {
  it('returns "Today" when date matches today string', () => {
    expect(dayLabel('2024-03-15', '2024-03-15')).toBe('Today')
  })

  it('returns abbreviated weekday for other dates', () => {
    // 2024-01-15 is a Monday
    expect(dayLabel('2024-01-15', '2024-03-15')).toBe('Mon')
  })

  it('returns a different weekday for a different date', () => {
    // 2024-01-17 is a Wednesday
    expect(dayLabel('2024-01-17', '2024-03-15')).toBe('Wed')
  })
})

// ─── dayNum ──────────────────────────────────────────────────────────────────

describe('dayNum', () => {
  it('includes abbreviated month and day', () => {
    const result = dayNum('2024-01-15')
    expect(result).toMatch(/Jan/)
    expect(result).toMatch(/15/)
  })

  it('does not include the year', () => {
    expect(dayNum('2024-01-15')).not.toMatch(/2024/)
  })
})

// ─── fmtDate ─────────────────────────────────────────────────────────────────

describe('fmtDate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('prefixes "Today" for a timestamp on the current day', () => {
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'))
    const result = fmtDate('2024-03-15T09:00:00Z', false)
    expect(result).toMatch(/^Today/)
  })

  it('prefixes "Yesterday" for a timestamp on the previous day', () => {
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'))
    const result = fmtDate('2024-03-14T09:00:00Z', false)
    expect(result).toMatch(/^Yesterday/)
  })

  it('returns a locale date for older timestamps', () => {
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'))
    const result = fmtDate('2024-03-01T09:00:00Z', false)
    expect(result).not.toMatch(/^Today/)
    expect(result).not.toMatch(/^Yesterday/)
    expect(result).toMatch(/Mar/)
  })

  it('respects the 24-hour flag', () => {
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'))
    const result24 = fmtDate('2024-03-15T14:05:00Z', true)
    const result12 = fmtDate('2024-03-15T14:05:00Z', false)
    expect(result24).not.toMatch(/[ap]m/i)
    expect(result12).toMatch(/[ap]m/i)
  })
})
