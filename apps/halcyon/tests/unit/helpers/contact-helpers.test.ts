import { describe, expect, it } from 'vitest'
import type { Contact, StayInTouch } from '~/types/database'
import {
  contactDisplayName,
  contactInitials,
  contactSortKey,
  isContactOverdue,
  stayInTouchDaysUntilDue,
} from '~/utils/contact-helpers'

// ─── Factories ────────────────────────────────────────────────────────────────

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

function makeStayInTouch(overrides: Partial<StayInTouch> = {}): StayInTouch {
  return {
    id: 's1',
    contact_id: 'c1',
    frequency_days: 30,
    last_contacted_at: null,
    next_remind_at: '2024-03-15',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── contactDisplayName ───────────────────────────────────────────────────────

describe('contactDisplayName', () => {
  it('returns "First Last" when both present', () => {
    expect(contactDisplayName(makeContact())).toBe('Alice Smith')
  })

  it('returns just first name when last name is empty', () => {
    expect(contactDisplayName(makeContact({ last_name: '' }))).toBe('Alice')
  })

  it('returns nickname in parens when present', () => {
    expect(contactDisplayName(makeContact({ nickname: 'Ali' }))).toBe('Alice "Ali" Smith')
  })

  it('returns just nickname when only nickname is set', () => {
    expect(
      contactDisplayName(makeContact({ first_name: '', last_name: '', nickname: 'Ali' })),
    ).toBe('Ali')
  })
})

// ─── contactInitials ──────────────────────────────────────────────────────────

describe('contactInitials', () => {
  it('returns first letter of first and last name', () => {
    expect(contactInitials(makeContact())).toBe('AS')
  })

  it('returns single initial when last name is empty', () => {
    expect(contactInitials(makeContact({ last_name: '' }))).toBe('A')
  })

  it('uses nickname initial when no real name', () => {
    expect(
      contactInitials(makeContact({ first_name: '', last_name: '', nickname: 'Bob' })),
    ).toBe('B')
  })

  it('returns "?" for completely empty contact', () => {
    expect(
      contactInitials(makeContact({ first_name: '', last_name: '', nickname: '' })),
    ).toBe('?')
  })
})

// ─── contactSortKey ───────────────────────────────────────────────────────────

describe('contactSortKey', () => {
  it('returns lowercase "last first" for sorting', () => {
    expect(contactSortKey(makeContact())).toBe('smith alice')
  })

  it('returns lowercase first name only when no last name', () => {
    expect(contactSortKey(makeContact({ last_name: '' }))).toBe('alice')
  })
})

// ─── isContactOverdue ─────────────────────────────────────────────────────────

describe('isContactOverdue', () => {
  const today = '2024-03-15'

  it('returns true when next_remind_at is before today', () => {
    const sit = makeStayInTouch({ next_remind_at: '2024-03-10' })
    expect(isContactOverdue(sit, today)).toBe(true)
  })

  it('returns true when next_remind_at is today', () => {
    const sit = makeStayInTouch({ next_remind_at: '2024-03-15' })
    expect(isContactOverdue(sit, today)).toBe(true)
  })

  it('returns false when next_remind_at is in the future', () => {
    const sit = makeStayInTouch({ next_remind_at: '2024-04-01' })
    expect(isContactOverdue(sit, today)).toBe(false)
  })
})

// ─── stayInTouchDaysUntilDue ──────────────────────────────────────────────────

describe('stayInTouchDaysUntilDue', () => {
  const today = '2024-03-15'

  it('returns negative number for overdue contacts', () => {
    const sit = makeStayInTouch({ next_remind_at: '2024-03-10' })
    expect(stayInTouchDaysUntilDue(sit, today)).toBe(-5)
  })

  it('returns 0 when due today', () => {
    const sit = makeStayInTouch({ next_remind_at: '2024-03-15' })
    expect(stayInTouchDaysUntilDue(sit, today)).toBe(0)
  })

  it('returns positive days remaining', () => {
    const sit = makeStayInTouch({ next_remind_at: '2024-03-20' })
    expect(stayInTouchDaysUntilDue(sit, today)).toBe(5)
  })
})
