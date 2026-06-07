import { describe, it, expect } from 'vitest'
import { suggestedLogValue } from '~/utils/log-helpers'
import type { HabitLog } from '~/types/database'

function log(over: Partial<HabitLog> = {}): HabitLog {
  return {
    id: crypto.randomUUID(),
    habit_id: 'h1',
    date: '2024-01-10',
    logged_at: '2024-01-10T08:00:00Z',
    value: 1,
    notes: '',
    ...over,
  }
}

describe('suggestedLogValue', () => {
  it('absolute: uses today’s running total when present', () => {
    const v = suggestedLogValue({ logs: [], habitId: 'h1', isAbsolute: true, todaySum: 5, target: 8 })
    expect(v).toBe(5)
  })

  it('absolute: falls back to the most recent past day’s total', () => {
    const logs = [
      log({ date: '2024-01-08', value: 3 }),
      log({ date: '2024-01-09', value: 4 }),
      log({ date: '2024-01-09', value: 4 }), // most recent day totals 8
    ]
    const v = suggestedLogValue({ logs, habitId: 'h1', isAbsolute: true, todaySum: 0, target: 99 })
    expect(v).toBe(8)
  })

  it('incremental: uses the most recent single logged amount', () => {
    const logs = [
      log({ logged_at: '2024-01-09T08:00:00Z', value: 2 }),
      log({ logged_at: '2024-01-10T09:00:00Z', value: 7 }), // latest
      log({ logged_at: '2024-01-10T07:00:00Z', value: 5 }),
    ]
    const v = suggestedLogValue({ logs, habitId: 'h1', isAbsolute: false, todaySum: 0, target: 1 })
    expect(v).toBe(7)
  })

  it('falls back to the target when there is no history', () => {
    expect(
      suggestedLogValue({ logs: [], habitId: 'h1', isAbsolute: true, todaySum: 0, target: 8 }),
    ).toBe(8)
    expect(
      suggestedLogValue({ logs: [], habitId: 'h1', isAbsolute: false, todaySum: 0, target: 30 }),
    ).toBe(30)
  })

  it('incremental with no target and no history defaults to 1', () => {
    expect(
      suggestedLogValue({ logs: [], habitId: 'h1', isAbsolute: false, todaySum: 0, target: 0 }),
    ).toBe(1)
  })

  it('ignores other habits’ logs', () => {
    const logs = [log({ habit_id: 'other', value: 99, logged_at: '2024-01-11T08:00:00Z' })]
    const v = suggestedLogValue({ logs, habitId: 'h1', isAbsolute: false, todaySum: 0, target: 4 })
    expect(v).toBe(4)
  })
})
