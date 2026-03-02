import { describe, it, expect } from 'vitest'
import type { Habit, HabitSchedule, HabitWithSchedule } from '~/types/database'
import { HABIT_DAY_LABELS, habitScheduleLabel, buildAnnotations } from '~/utils/habit-helpers'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Test',
    description: '',
    color: '#000',
    icon: 'i-heroicons-star',
    frequency: 'daily',
    created_at: '2024-01-01T00:00:00Z',
    archived_at: null,
    tags: [],
    annotations: {},
    type: 'BOOLEAN',
    target_value: 1,
    paused_until: null,
    ...overrides,
  }
}

function makeSchedule(overrides: Partial<HabitSchedule> = {}): HabitSchedule {
  return {
    id: 's1',
    habit_id: 'h1',
    schedule_type: 'DAILY',
    frequency_count: null,
    days_of_week: null,
    due_time: null,
    start_date: null,
    end_date: null,
    ...overrides,
  }
}

function habit(scheduleOverrides?: Partial<HabitSchedule>): HabitWithSchedule {
  return {
    ...makeHabit(),
    schedule: scheduleOverrides !== undefined ? makeSchedule(scheduleOverrides) : null,
  }
}

// ─── HABIT_DAY_LABELS ────────────────────────────────────────────────────────

describe('HABIT_DAY_LABELS', () => {
  it('has 7 entries', () => {
    expect(HABIT_DAY_LABELS).toHaveLength(7)
  })

  it('starts with Sunday abbreviated as "Su"', () => {
    expect(HABIT_DAY_LABELS[0]).toBe('Su')
  })

  it('ends with Saturday abbreviated as "Sa"', () => {
    expect(HABIT_DAY_LABELS[6]).toBe('Sa')
  })
})

// ─── habitScheduleLabel ──────────────────────────────────────────────────────

describe('habitScheduleLabel', () => {
  it('returns "Daily" when schedule is null', () => {
    expect(habitScheduleLabel(habit())).toBe('Daily')
  })

  it('returns "Daily" for DAILY schedule type', () => {
    expect(habitScheduleLabel(habit({ schedule_type: 'DAILY' }))).toBe('Daily')
  })

  it('returns "N×/week" for WEEKLY_FLEX with a frequency', () => {
    expect(
      habitScheduleLabel(habit({ schedule_type: 'WEEKLY_FLEX', frequency_count: 3 })),
    ).toBe('3×/week')
  })

  it('defaults to 1×/week for WEEKLY_FLEX with null frequency', () => {
    expect(
      habitScheduleLabel(habit({ schedule_type: 'WEEKLY_FLEX', frequency_count: null })),
    ).toBe('1×/week')
  })

  it('returns day abbreviations joined by spaces for SPECIFIC_DAYS', () => {
    // days 1 (Mo) and 5 (Fr)
    const result = habitScheduleLabel(
      habit({ schedule_type: 'SPECIFIC_DAYS', days_of_week: [1, 5] }),
    )
    expect(result).toBe('Mo Fr')
  })

  it('returns empty string for SPECIFIC_DAYS with empty day list', () => {
    const result = habitScheduleLabel(
      habit({ schedule_type: 'SPECIFIC_DAYS', days_of_week: [] }),
    )
    expect(result).toBe('')
  })
})

// ─── buildAnnotations ────────────────────────────────────────────────────────

describe('buildAnnotations', () => {
  it('converts an array of entries into a record', () => {
    const result = buildAnnotations([
      { key: 'difficulty', value: 'medium' },
      { key: 'goal', value: 'finish' },
    ])
    expect(result).toEqual({ difficulty: 'medium', goal: 'finish' })
  })

  it('skips entries with empty or whitespace-only keys', () => {
    const result = buildAnnotations([
      { key: '', value: 'ignored' },
      { key: '   ', value: 'also ignored' },
      { key: 'kept', value: 'yes' },
    ])
    expect(result).toEqual({ kept: 'yes' })
  })

  it('trims whitespace from keys', () => {
    const result = buildAnnotations([{ key: '  note  ', value: 'hello' }])
    expect(result).toEqual({ note: 'hello' })
  })

  it('returns an empty object for an empty input array', () => {
    expect(buildAnnotations([])).toEqual({})
  })

  it('last duplicate key wins', () => {
    const result = buildAnnotations([
      { key: 'k', value: 'first' },
      { key: 'k', value: 'second' },
    ])
    expect(result['k']).toBe('second')
  })
})
