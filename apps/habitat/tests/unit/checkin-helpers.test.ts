import { describe, it, expect } from 'vitest'
import type { CheckinTemplate } from '~/types/database'
import {
  CHECKIN_DAY_NAMES,
  CHECKIN_DAY_LABELS,
  checkinScheduleLabel,
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

  it('returns "Monthly" for MONTHLY schedule', () => {
    expect(checkinScheduleLabel(makeTemplate({ schedule_type: 'MONTHLY' }))).toBe('Monthly')
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
