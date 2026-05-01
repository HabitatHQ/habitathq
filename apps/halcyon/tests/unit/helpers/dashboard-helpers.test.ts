import { describe, expect, it } from 'vitest'
import type { Contact } from '~/types/database'
import {
  daysUntilBirthday,
  turningAge,
  upcomingBirthdays,
} from '~/utils/dashboard-helpers'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    vault_id: 'v1',
    first_name: 'Alice',
    last_name: 'Smith',
    nickname: '',
    maiden_name: '',
    middle_name: '',
    pronouns: '',
    gender: '',
    how_we_met: '',
    is_deceased: false,
    deceased_at: null,
    birthday: null,
    is_starred: false,
    last_contacted_at: null,
    avatar_url: null,
    tags: [],
    annotations: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    archived_at: null,
    ...overrides,
  }
}

// ─── daysUntilBirthday ────────────────────────────────────────────────────────

describe('daysUntilBirthday', () => {
  it('returns 0 when birthday is today', () => {
    expect(daysUntilBirthday('1990-03-09', '2026-03-09')).toBe(0)
  })

  it('returns days until next occurrence this year', () => {
    expect(daysUntilBirthday('1990-03-15', '2026-03-09')).toBe(6)
  })

  it('wraps to next year when birthday has passed this year', () => {
    // birthday Mar 1, today Mar 9 → next birthday is Mar 1 next year = 356 or 357 days
    const days = daysUntilBirthday('1990-03-01', '2026-03-09')
    expect(days).toBeGreaterThan(350)
    expect(days).toBeLessThan(366)
  })

  it('handles year-end wrap (Dec birthday, today is Nov)', () => {
    const days = daysUntilBirthday('1985-12-25', '2026-11-01')
    expect(days).toBe(54)
  })
})

// ─── turningAge ───────────────────────────────────────────────────────────────

describe('turningAge', () => {
  it('returns the age they will turn on their next birthday', () => {
    expect(turningAge('1990-03-15', '2026-03-09')).toBe(36)
  })

  it('returns correct age when birthday is today', () => {
    expect(turningAge('1990-03-09', '2026-03-09')).toBe(36)
  })

  it('returns next year age when birthday just passed', () => {
    // birthday Mar 1, today Mar 9 → next is Mar 1 2027 → turning 37
    expect(turningAge('1990-03-01', '2026-03-09')).toBe(37)
  })

  it('returns null for contacts without a birth year indicator', () => {
    // We only have year-based birthdays, so null birthday returns null
    expect(turningAge(null, '2026-03-09')).toBeNull()
  })
})

// ─── upcomingBirthdays ────────────────────────────────────────────────────────

describe('upcomingBirthdays', () => {
  it('returns contacts with birthdays in the next N days', () => {
    const contacts = [
      makeContact({ id: 'c1', first_name: 'Alice', birthday: '1990-03-15' }), // 6 days away
      makeContact({ id: 'c2', first_name: 'Bob', birthday: '1985-04-10' }),   // 32 days away
      makeContact({ id: 'c3', first_name: 'Carol', birthday: '2000-06-01' }), // way out
    ]
    const result = upcomingBirthdays(contacts, '2026-03-09', 30)
    expect(result.map((r) => r.contact.id)).toContain('c1')
    expect(result.map((r) => r.contact.id)).not.toContain('c2')
    expect(result.map((r) => r.contact.id)).not.toContain('c3')
  })

  it('includes today\'s birthday', () => {
    const contacts = [makeContact({ id: 'c1', birthday: '1990-03-09' })]
    const result = upcomingBirthdays(contacts, '2026-03-09', 30)
    expect(result[0]?.days_away).toBe(0)
  })

  it('sorts by days_away ascending', () => {
    const contacts = [
      makeContact({ id: 'c2', birthday: '1990-03-20' }),
      makeContact({ id: 'c1', birthday: '1990-03-12' }),
    ]
    const result = upcomingBirthdays(contacts, '2026-03-09', 30)
    expect(result[0]?.contact.id).toBe('c1')
    expect(result[1]?.contact.id).toBe('c2')
  })

  it('skips contacts without a birthday', () => {
    const contacts = [
      makeContact({ id: 'c1', birthday: null }),
      makeContact({ id: 'c2', birthday: '1990-03-12' }),
    ]
    const result = upcomingBirthdays(contacts, '2026-03-09', 30)
    expect(result.length).toBe(1)
    expect(result[0]?.contact.id).toBe('c2')
  })

  it('includes turning_age in result', () => {
    const contacts = [makeContact({ id: 'c1', birthday: '1990-03-15' })]
    const result = upcomingBirthdays(contacts, '2026-03-09', 30)
    expect(result[0]?.turning_age).toBe(36)
  })

  it('returns empty array when no birthdays upcoming', () => {
    const contacts = [makeContact({ id: 'c1', birthday: '1990-06-01' })]
    const result = upcomingBirthdays(contacts, '2026-03-09', 7)
    expect(result).toHaveLength(0)
  })
})
