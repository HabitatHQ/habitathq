import { describe, expect, it } from 'vitest'
import { addDateKeyDays, calendarDayDifference, dateKeysBetween } from '../../app/utils/calendar-dates'

describe('calendar date keys', () => {
  it('walks consecutive date-only keys across spring DST without gaps', () => {
    expect(dateKeysBetween('2026-03-07', '2026-03-10')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
  })

  it('keeps week and month boundaries contiguous around the fall DST transition', () => {
    expect(dateKeysBetween('2026-10-26', '2026-11-02')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
  })

  it('preserves end-of-month calendar arithmetic through leap February', () => {
    expect(addDateKeyDays('2024-02-29', 1)).toBe('2024-03-01')
    expect(addDateKeyDays('2024-03-01', -1)).toBe('2024-02-29')
  })

  it('computes ordinal day differences across DST boundaries', () => {
    expect(calendarDayDifference('2026-03-08', '2026-03-09')).toBe(1)
    expect(calendarDayDifference('2026-10-31', '2026-11-01')).toBe(1)
  })
})
