import { describe, expect, it } from 'vitest'
import type { Reminder, StayInTouch } from '~/types/database'
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
    remind_at: '2024-03-15',
    is_yearly: false,
    is_done: false,
    done_at: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── isReminderDue ────────────────────────────────────────────────────────────

describe('isReminderDue', () => {
  it('returns true when remind_at equals today', () => {
    expect(isReminderDue(makeReminder({ remind_at: '2024-03-15' }), '2024-03-15')).toBe(true)
  })

  it('returns false when remind_at is in the future', () => {
    expect(isReminderDue(makeReminder({ remind_at: '2024-04-01' }), '2024-03-15')).toBe(false)
  })

  it('returns false when reminder is already done', () => {
    expect(
      isReminderDue(makeReminder({ remind_at: '2024-03-15', is_done: true }), '2024-03-15'),
    ).toBe(false)
  })
})

// ─── isReminderOverdue ────────────────────────────────────────────────────────

describe('isReminderOverdue', () => {
  it('returns true when remind_at is before today and not done', () => {
    expect(isReminderOverdue(makeReminder({ remind_at: '2024-03-10' }), '2024-03-15')).toBe(true)
  })

  it('returns false when remind_at is today', () => {
    expect(isReminderOverdue(makeReminder({ remind_at: '2024-03-15' }), '2024-03-15')).toBe(false)
  })

  it('returns false when done', () => {
    expect(
      isReminderOverdue(makeReminder({ remind_at: '2024-03-10', is_done: true }), '2024-03-15'),
    ).toBe(false)
  })
})

// ─── isDueWithinDays ──────────────────────────────────────────────────────────

describe('isDueWithinDays', () => {
  it('returns true when remind_at is within the window', () => {
    expect(isDueWithinDays(makeReminder({ remind_at: '2024-03-20' }), '2024-03-15', 7)).toBe(true)
  })

  it('returns false when remind_at is beyond the window', () => {
    expect(isDueWithinDays(makeReminder({ remind_at: '2024-04-15' }), '2024-03-15', 7)).toBe(false)
  })

  it('returns false when already done', () => {
    expect(
      isDueWithinDays(
        makeReminder({ remind_at: '2024-03-16', is_done: true }),
        '2024-03-15',
        7,
      ),
    ).toBe(false)
  })
})

// ─── computeNextRemindAt ──────────────────────────────────────────────────────

describe('computeNextRemindAt', () => {
  it('returns same date for non-yearly reminder', () => {
    const r = makeReminder({ remind_at: '2024-03-15', is_yearly: false })
    expect(computeNextRemindAt(r, '2024-03-16')).toBe('2024-03-15')
  })

  it('returns next year date for yearly reminder after today', () => {
    const r = makeReminder({ remind_at: '2024-03-15', is_yearly: true })
    expect(computeNextRemindAt(r, '2024-03-16')).toBe('2025-03-15')
  })

  it('returns same year date for yearly reminder not yet passed', () => {
    const r = makeReminder({ remind_at: '2024-03-15', is_yearly: true })
    expect(computeNextRemindAt(r, '2024-03-10')).toBe('2024-03-15')
  })
})

// ─── nextBirthdayDate ─────────────────────────────────────────────────────────

describe('nextBirthdayDate', () => {
  it('returns same year if birthday has not passed yet', () => {
    expect(nextBirthdayDate('1990-12-25', '2024-03-15')).toBe('2024-12-25')
  })

  it('returns next year if birthday has already passed', () => {
    expect(nextBirthdayDate('1990-03-01', '2024-03-15')).toBe('2025-03-01')
  })

  it('returns today if birthday is today', () => {
    expect(nextBirthdayDate('1990-03-15', '2024-03-15')).toBe('2024-03-15')
  })
})

// ─── stayInTouchNextDate ──────────────────────────────────────────────────────

describe('stayInTouchNextDate', () => {
  it('adds frequency_days to last_contacted_at when set', () => {
    const sit: Pick<StayInTouch, 'frequency_days' | 'last_contacted_at'> = {
      frequency_days: 30,
      last_contacted_at: '2024-02-01T10:00:00Z',
    }
    expect(stayInTouchNextDate(sit)).toBe('2024-03-02')
  })

  it('returns today when last_contacted_at is null', () => {
    const sit: Pick<StayInTouch, 'frequency_days' | 'last_contacted_at'> = {
      frequency_days: 30,
      last_contacted_at: null,
    }
    // When null, next date is today (overdue immediately)
    const today = new Date().toISOString().slice(0, 10)
    expect(stayInTouchNextDate(sit)).toBe(today)
  })
})
