import { describe, it, expect } from 'vitest'
import type { CheckinTemplate } from '~/types/database'
import {
  CHECKIN_DAY_NAMES,
  CHECKIN_DAY_LABELS,
  checkinScheduleLabel,
  ordinalDay,
} from '~/utils/checkin-helpers'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<CheckinTemplate> = {}): CheckinTemplate {
  return {
    id: 't1',
    title: 'Morning Check-in',
    schedule_type: 'DAILY',
    days_active: null,
    ...overrides,
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('CHECKIN_DAY_NAMES', () => {
  it('has 7 entries', () => {
    expect(CHECKIN_DAY_NAMES).toHaveLength(7)
  })

  it('starts with "Sun"', () => {
    expect(CHECKIN_DAY_NAMES[0]).toBe('Sun')
  })

  it('ends with "Sat"', () => {
    expect(CHECKIN_DAY_NAMES[6]).toBe('Sat')
  })
})

describe('CHECKIN_DAY_LABELS', () => {
  it('has 7 entries', () => {
    expect(CHECKIN_DAY_LABELS).toHaveLength(7)
  })

  it('starts with "Su"', () => {
    expect(CHECKIN_DAY_LABELS[0]).toBe('Su')
  })
})

// ─── checkinScheduleLabel ────────────────────────────────────────────────────

describe('checkinScheduleLabel', () => {
  it('returns "Daily" for DAILY schedule', () => {
    expect(checkinScheduleLabel(makeTemplate({ schedule_type: 'DAILY' }))).toBe('Daily')
  })

  it('returns "Monthly" for MONTHLY schedule with no day set', () => {
    expect(checkinScheduleLabel(makeTemplate({ schedule_type: 'MONTHLY' }))).toBe('Monthly')
  })

  it('includes the ordinal day for MONTHLY with a configured day', () => {
    expect(
      checkinScheduleLabel(makeTemplate({ schedule_type: 'MONTHLY', days_active: [15] })),
    ).toBe('Monthly · 15th')
    expect(
      checkinScheduleLabel(makeTemplate({ schedule_type: 'MONTHLY', days_active: [1] })),
    ).toBe('Monthly · 1st')
  })

  it('returns "Weekly" for WEEKLY with no days_active', () => {
    expect(
      checkinScheduleLabel(makeTemplate({ schedule_type: 'WEEKLY', days_active: null })),
    ).toBe('Weekly')
  })

  it('returns "Weekly" for WEEKLY with an empty days_active array', () => {
    expect(
      checkinScheduleLabel(makeTemplate({ schedule_type: 'WEEKLY', days_active: [] })),
    ).toBe('Weekly')
  })

  it('includes day names when days_active is non-empty', () => {
    // days 1 (Mon) and 3 (Wed)
    const result = checkinScheduleLabel(
      makeTemplate({ schedule_type: 'WEEKLY', days_active: [1, 3] }),
    )
    expect(result).toMatch(/^Weekly/)
    expect(result).toContain('Mon')
    expect(result).toContain('Wed')
  })

  it('separates day names with ", "', () => {
    const result = checkinScheduleLabel(
      makeTemplate({ schedule_type: 'WEEKLY', days_active: [0, 6] }),
    )
    expect(result).toContain('Sun, Sat')
  })
})

// ─── ordinalDay ──────────────────────────────────────────────────────────────

describe('ordinalDay', () => {
  it('uses st/nd/rd for 1/2/3', () => {
    expect(ordinalDay(1)).toBe('1st')
    expect(ordinalDay(2)).toBe('2nd')
    expect(ordinalDay(3)).toBe('3rd')
  })

  it('uses th for 4–20 and the 11–13 exceptions', () => {
    expect(ordinalDay(4)).toBe('4th')
    expect(ordinalDay(11)).toBe('11th')
    expect(ordinalDay(12)).toBe('12th')
    expect(ordinalDay(13)).toBe('13th')
  })

  it('handles 21/22/23/31', () => {
    expect(ordinalDay(21)).toBe('21st')
    expect(ordinalDay(22)).toBe('22nd')
    expect(ordinalDay(23)).toBe('23rd')
    expect(ordinalDay(31)).toBe('31st')
  })
})
