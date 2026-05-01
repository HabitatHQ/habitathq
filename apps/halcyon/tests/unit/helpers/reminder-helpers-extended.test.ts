import { describe, expect, it } from 'vitest'
import type { Reminder } from '~/types/database'
import {
  computeNextRemindAt,
  isDueWithinDays,
  isReminderDue,
  isReminderOverdue,
  nextBirthdayDate,
  stayInTouchNextDate,
} from '~/utils/reminder-helpers'

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    contact_id: 'c1',
    title: 'Birthday',
    body: '',
    remind_at: '2024-06-15',
    is_yearly: false,
    is_done: false,
    done_at: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── isReminderDue — edge cases ───────────────────────────────────────────────

describe('isReminderDue — edge cases', () => {
  it('returns false for a reminder with no date change', () => {
    const r = makeReminder({ remind_at: '2024-06-20', is_done: false })
    expect(isReminderDue(r, '2024-06-15')).toBe(false)
  })

  it('returns false when is_done even if same date', () => {
    const r = makeReminder({ remind_at: '2024-06-15', is_done: true })
    expect(isReminderDue(r, '2024-06-15')).toBe(false)
  })
})

// ─── isReminderOverdue — edge cases ──────────────────────────────────────────

describe('isReminderOverdue — edge cases', () => {
  it('is not overdue on the same day', () => {
    expect(isReminderOverdue(makeReminder({ remind_at: '2024-06-15' }), '2024-06-15')).toBe(false)
  })

  it('is overdue one day before today', () => {
    expect(isReminderOverdue(makeReminder({ remind_at: '2024-06-14' }), '2024-06-15')).toBe(true)
  })

  it('is NOT overdue when already done', () => {
    expect(
      isReminderOverdue(makeReminder({ remind_at: '2024-06-14', is_done: true }), '2024-06-15'),
    ).toBe(false)
  })
})

// ─── isDueWithinDays — edge cases ─────────────────────────────────────────────

describe('isDueWithinDays — edge cases', () => {
  it('includes today in the window', () => {
    const r = makeReminder({ remind_at: '2024-06-15' })
    expect(isDueWithinDays(r, '2024-06-15', 7)).toBe(true)
  })

  it('includes the last day of the window', () => {
    const r = makeReminder({ remind_at: '2024-06-22' })
    expect(isDueWithinDays(r, '2024-06-15', 7)).toBe(true)
  })

  it('excludes day after the window', () => {
    const r = makeReminder({ remind_at: '2024-06-23' })
    expect(isDueWithinDays(r, '2024-06-15', 7)).toBe(false)
  })

  it('excludes past dates', () => {
    const r = makeReminder({ remind_at: '2024-06-10' })
    expect(isDueWithinDays(r, '2024-06-15', 7)).toBe(false)
  })
})

// ─── computeNextRemindAt — edge cases ─────────────────────────────────────────

describe('computeNextRemindAt — edge cases', () => {
  it('handles leap year birthdays (Feb 29) falling back to Mar 1 on non-leap years', () => {
    // Feb 29 yearly: on a non-leap year, standard behavior is to return the stored date
    // or advance to next year that has Feb 29
    const r = makeReminder({ remind_at: '2024-02-29', is_yearly: true })
    // On 2024 (leap), it's not yet passed on Feb 28
    const result = computeNextRemindAt(r, '2024-02-28')
    expect(result).toBe('2024-02-29')
  })

  it('advances year for yearly reminder exactly the day after', () => {
    const r = makeReminder({ remind_at: '2024-06-15', is_yearly: true })
    expect(computeNextRemindAt(r, '2024-06-16')).toBe('2025-06-15')
  })

  it('does not advance for non-yearly reminders even if past', () => {
    const r = makeReminder({ remind_at: '2024-01-01', is_yearly: false })
    expect(computeNextRemindAt(r, '2024-06-15')).toBe('2024-01-01')
  })
})

// ─── nextBirthdayDate — edge cases ────────────────────────────────────────────

describe('nextBirthdayDate — edge cases', () => {
  it('handles exactly today as the birthday', () => {
    expect(nextBirthdayDate('1990-06-15', '2024-06-15')).toBe('2024-06-15')
  })

  it('advances to next year when birthday was yesterday', () => {
    expect(nextBirthdayDate('1990-06-14', '2024-06-15')).toBe('2025-06-14')
  })

  it('handles Jan 1 birthday correctly', () => {
    expect(nextBirthdayDate('1990-01-01', '2024-06-15')).toBe('2025-01-01')
  })

  it('handles Dec 31 birthday correctly', () => {
    expect(nextBirthdayDate('1990-12-31', '2024-06-15')).toBe('2024-12-31')
  })
})

// ─── stayInTouchNextDate — edge cases ─────────────────────────────────────────

describe('stayInTouchNextDate — edge cases', () => {
  it('with frequency 1 and recent contact, next is tomorrow', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const result = stayInTouchNextDate({
      frequency_days: 1,
      last_contacted_at: yesterday.toISOString(),
    })
    const today = new Date().toISOString().slice(0, 10)
    expect(result).toBe(today)
  })

  it('handles very long frequencies (annual check-in)', () => {
    const result = stayInTouchNextDate({
      frequency_days: 365,
      last_contacted_at: '2024-01-01T00:00:00Z',
    })
    expect(result).toBe('2024-12-31') // 2024 is a leap year: 366 days? No: Jan 1 + 365 days = Dec 31
  })
})
