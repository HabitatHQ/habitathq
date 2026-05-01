import { describe, expect, it } from 'vitest'
import {
  dayIndexToName,
  parseDaySchedule,
  scheduledDaysForToday,
  serialiseDaySchedule,
  suggestTemplatesForToday,
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
  it('returns Sunday for 0', () => {
    expect(dayIndexToName(0)).toBe('Sunday')
  })
  it('returns Monday for 1', () => {
    expect(dayIndexToName(1)).toBe('Monday')
  })
  it('returns Saturday for 6', () => {
    expect(dayIndexToName(6)).toBe('Saturday')
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
  it('returns templates scheduled for today', () => {
    const today = new Date('2026-03-10') // Tuesday = day 2
    const t1 = makeTemplate('t1', '[2]') // Tuesdays
    const t2 = makeTemplate('t2', '[1]') // Mondays
    const result = suggestTemplatesForToday([t1, t2] as any, today)
    expect(result.map((t) => t.id)).toContain('t1')
    expect(result.map((t) => t.id)).not.toContain('t2')
  })
})
