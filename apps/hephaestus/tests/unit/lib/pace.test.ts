import { describe, expect, it } from 'vitest'
import { formatPace, paceToSpeed, secondsToMinKm } from '~/lib/pace'

describe('secondsToMinKm', () => {
  it('calculates pace for a 5km run in 25 minutes', () => {
    // 25 min = 1500 sec, 5000m → 300 sec/km = 5:00/km
    expect(secondsToMinKm(1500, 5000)).toBe(300)
  })

  it('calculates pace for a 10km run in 50 minutes', () => {
    // 50 min = 3000 sec, 10000m → 300 sec/km
    expect(secondsToMinKm(3000, 10000)).toBe(300)
  })

  it('returns 0 for zero distance', () => {
    expect(secondsToMinKm(600, 0)).toBe(0)
  })

  it('returns 0 for zero duration', () => {
    expect(secondsToMinKm(0, 5000)).toBe(0)
  })

  it('calculates a sub-4 minute km pace', () => {
    // 3:30/km = 210 sec/km; for 10km: 2100 sec total
    expect(secondsToMinKm(2100, 10000)).toBe(210)
  })
})

describe('formatPace', () => {
  it('formats 300 sec/km as 5:00/km', () => {
    expect(formatPace(300, 'km')).toBe('5:00/km')
  })

  it('formats 330 sec/km as 5:30/km', () => {
    expect(formatPace(330, 'km')).toBe('5:30/km')
  })

  it('formats pace in miles', () => {
    // 300 sec/km × 1.60934 ≈ 483 sec/mi ≈ 8:03/mi
    const _secPerMi = Math.round(300 * 1.60934)
    const result = formatPace(300, 'mi')
    expect(result).toContain('/mi')
    // Verify the minutes part is correct
    expect(result.startsWith('8:')).toBe(true)
  })

  it('pads seconds with leading zero', () => {
    // 303 sec/km = 5:03/km
    expect(formatPace(303, 'km')).toBe('5:03/km')
  })

  it('returns "--" for zero or negative pace', () => {
    expect(formatPace(0, 'km')).toBe('--')
    expect(formatPace(-1, 'km')).toBe('--')
  })
})

describe('paceToSpeed', () => {
  it('converts 300 sec/km to 12 km/h', () => {
    // 1km in 300 sec → 3600/300 = 12 km/h
    expect(paceToSpeed(300)).toBeCloseTo(12, 2)
  })

  it('converts 360 sec/km to 10 km/h', () => {
    expect(paceToSpeed(360)).toBeCloseTo(10, 2)
  })

  it('returns 0 for zero pace', () => {
    expect(paceToSpeed(0)).toBe(0)
  })
})
