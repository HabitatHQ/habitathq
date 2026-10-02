import { describe, expect, it } from 'vitest'
import {
  dayIndexToName,
  parseDaySchedule,
  scheduledDaysForToday,
  serialiseDaySchedule,
  suggestTemplatesForToday,
  weekdayNumber,
} from '~/lib/schedule'
import type { TemplateRow } from '~/types/database'

function makeTemplate(id: string, scheduledDays: string | null = null): TemplateRow {
  return {
    id,
    name: `Template ${id}`,
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    archived_at: null,
    sort_order: 0,
    pinned_at: null,
    last_used_at: null,
    use_count: 0,
    cover_emoji: null,
    scheduled_days: scheduledDays,
  } as TemplateRow & { scheduled_days: string | null }
}

describe('dayIndexToName', () => {
  it('uses Monday=1 through Sunday=7', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(dayIndexToName)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
    expect(dayIndexToName(0)).toBe('Unknown')
  })
})
describe('weekdayNumber', () => {
  it('maps every JavaScript weekday to Monday=1 through Sunday=7', () => {
    expect(Array.from({ length: 7 }, (_, i) => weekdayNumber(new Date(2026, 2, 9 + i)))).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ])
  })
})

describe('parseDaySchedule', () => {
  it('parses a JSON array of day indices', () => {
    expect(parseDaySchedule('[1,3,5]')).toEqual([1, 3, 5])
  })
  it('returns empty array for null', () => {
    expect(parseDaySchedule(null)).toEqual([])
  })
  it('returns empty array for invalid JSON', () => {
    expect(parseDaySchedule('invalid')).toEqual([])
  })
})

describe('serialiseDaySchedule', () => {
  it('serialises day array to JSON', () => {
    expect(serialiseDaySchedule([1, 3, 5])).toBe('[1,3,5]')
  })
  it('returns null for empty array', () => {
    expect(serialiseDaySchedule([])).toBeNull()
  })
})

describe('scheduledDaysForToday', () => {
  it('returns true when today is in scheduled days', () => {
    // 2026-03-10 is a Tuesday (day 2)
    const today = new Date('2026-03-10')
    expect(scheduledDaysForToday('[2]', today)).toBe(true)
  })
  it('returns false when today is not in scheduled days', () => {
    const today = new Date('2026-03-10') // Tuesday
    expect(scheduledDaysForToday('[1,3]', today)).toBe(false)
  })
  it('returns false for null schedule', () => {
    expect(scheduledDaysForToday(null, new Date())).toBe(false)
  })
})

describe('suggestTemplatesForToday', () => {
  it('returns templates scheduled today using Monday=1 and Sunday=7', () => {
    const tuesday = new Date(2026, 2, 10)
    const sunday = new Date(2026, 2, 15)
    const tuesdayTemplate = makeTemplate('tuesday', '[2]')
    const sundayTemplate = makeTemplate('sunday', '[7]')
    expect(
      suggestTemplatesForToday([tuesdayTemplate, sundayTemplate], tuesday).map((t) => t.id),
    ).toEqual(['tuesday'])
    expect(
      suggestTemplatesForToday([tuesdayTemplate, sundayTemplate], sunday).map((t) => t.id),
    ).toEqual(['sunday'])
  })
})
