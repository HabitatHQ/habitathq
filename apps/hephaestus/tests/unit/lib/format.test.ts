import { describe, expect, it } from 'vitest'
import { formatDuration, formatVolume, formatWeight, isoWeek, kgToLbs, lbsToKg } from '~/lib/format'

describe('kgToLbs', () => {
  it('converts 100kg to 220.46 lbs', () => {
    expect(kgToLbs(100)).toBeCloseTo(220.46, 1)
  })

  it('converts 0 kg to 0 lbs', () => {
    expect(kgToLbs(0)).toBe(0)
  })

  it('converts 80 kg', () => {
    expect(kgToLbs(80)).toBeCloseTo(176.37, 1)
  })
})

describe('lbsToKg', () => {
  it('converts 220 lbs to ~99.79 kg', () => {
    expect(lbsToKg(220)).toBeCloseTo(99.79, 1)
  })

  it('converts 0 lbs to 0 kg', () => {
    expect(lbsToKg(0)).toBe(0)
  })

  it('round-trips correctly', () => {
    const original = 82.5
    expect(lbsToKg(kgToLbs(original))).toBeCloseTo(original, 1)
  })
})

describe('formatWeight', () => {
  it('formats kg with 1 decimal when needed', () => {
    expect(formatWeight(80, 'kg')).toBe('80 kg')
    expect(formatWeight(82.5, 'kg')).toBe('82.5 kg')
  })

  it('formats lbs by converting from kg', () => {
    // 100 kg → 220.46 lbs → "220.5 lbs"
    const result = formatWeight(100, 'lbs')
    expect(result).toContain('lbs')
    expect(result).toMatch(/^220/)
  })

  it('returns "0 kg" for zero weight', () => {
    expect(formatWeight(0, 'kg')).toBe('0 kg')
  })

  it('trims trailing decimal zeros for whole numbers', () => {
    expect(formatWeight(100, 'kg')).toBe('100 kg')
  })
})

describe('formatDuration', () => {
  it('formats sub-minute as seconds', () => {
    expect(formatDuration(45)).toBe('45s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1m 30s')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(3661)).toBe('1h 1m')
  })

  it('formats exactly 1 hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m')
  })

  it('formats zero as 0s', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('formats 65 minutes as 1h 5m', () => {
    expect(formatDuration(65 * 60)).toBe('1h 5m')
  })
})

describe('formatVolume', () => {
  it('formats thousands with k suffix', () => {
    expect(formatVolume(12500)).toBe('12.5k kg')
  })

  it('formats small volumes without suffix', () => {
    expect(formatVolume(800)).toBe('800 kg')
  })

  it('formats zero', () => {
    expect(formatVolume(0)).toBe('0 kg')
  })

  it('formats in lbs when unit is lbs', () => {
    const result = formatVolume(1000, 'lbs')
    expect(result).toContain('lbs')
  })
})

describe('formatDuration (additional)', () => {
  it('formats exactly 60 seconds as 1m', () => {
    expect(formatDuration(60)).toBe('1m')
  })

  it('formats exactly 59 seconds as 59s (sub-minute)', () => {
    expect(formatDuration(59)).toBe('59s')
  })

  it('formats 2 minutes exactly as 2m', () => {
    expect(formatDuration(120)).toBe('2m')
  })
})

describe('formatVolume (additional)', () => {
  it('formats 999 kg without k suffix', () => {
    expect(formatVolume(999)).toBe('999 kg')
  })

  it('formats exactly 1000 kg with k suffix', () => {
    // Math.round(1000/100)/10 = 1 → "1k kg"
    expect(formatVolume(1000)).toBe('1k kg')
  })

  it('formats 1500 kg as 1.5k', () => {
    expect(formatVolume(1500)).toBe('1.5k kg')
  })

  it('formats lbs volume with k suffix when large enough', () => {
    // 1000 kg in lbs ≈ 2204 → "2.2k lbs"
    const result = formatVolume(1000, 'lbs')
    expect(result).toContain('k lbs')
  })
})

describe('kgToLbs / lbsToKg (additional)', () => {
  it('round-trips 45 kg accurately', () => {
    expect(lbsToKg(kgToLbs(45))).toBeCloseTo(45, 3)
  })

  it('round-trips 140 kg accurately', () => {
    expect(lbsToKg(kgToLbs(140))).toBeCloseTo(140, 3)
  })
})

describe('isoWeek', () => {
  it('formats a date as ISO week string', () => {
    // 2025-03-10 is week 11 of 2025
    const result = isoWeek(new Date('2025-03-10'))
    expect(result).toMatch(/^\d{4}-W\d{2}$/)
  })

  it('returns the correct week number', () => {
    // Jan 6 2025 is Monday of week 2 (ISO week 1 starts Dec 30 2024)
    expect(isoWeek(new Date('2025-01-06'))).toBe('2025-W02')
  })

  it('returns different weeks for dates 7 days apart', () => {
    const w1 = isoWeek(new Date('2025-01-06'))
    const w2 = isoWeek(new Date('2025-01-13'))
    expect(w1).not.toBe(w2)
  })

  it('returns same week for dates in the same week', () => {
    // Mon Jan 6 and Fri Jan 10 are in same ISO week (week 2, 2025)
    const w1 = isoWeek(new Date('2025-01-06'))
    const w2 = isoWeek(new Date('2025-01-10'))
    expect(w1).toBe(w2)
  })

  it('week string always has zero-padded week number', () => {
    // Week 2 should be W02 not W2
    const result = isoWeek(new Date('2025-01-06'))
    expect(result).toMatch(/W\d{2}$/)
  })
})
