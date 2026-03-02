import { describe, it, expect } from 'vitest'
import { formatTime } from '~/composables/useAppSettings'

describe('formatTime', () => {
  const date = new Date('2024-01-15T09:05:00')

  it('returns 12-hour format when use24h is false', () => {
    const result = formatTime(date, false)
    // The exact string depends on locale, but should contain AM/PM
    expect(result).toMatch(/am|pm|AM|PM/i)
  })

  it('returns 24-hour format when use24h is true', () => {
    const result = formatTime(date, true)
    // Should not contain AM/PM in 24h mode
    expect(result).not.toMatch(/am|pm/i)
    // Should contain the hour digits
    expect(result).toMatch(/09|9/)
  })

  it('pads minutes with a leading zero', () => {
    const d = new Date('2024-01-15T14:05:00')
    const result = formatTime(d, true)
    expect(result).toMatch(/05/)
  })

  it('returns a non-empty string', () => {
    expect(formatTime(date, false)).toBeTruthy()
    expect(formatTime(date, true)).toBeTruthy()
  })
})
