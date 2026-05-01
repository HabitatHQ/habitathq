import { describe, expect, it } from 'vitest'
import type { Contact, StayInTouch } from '~/types/database'
import {
  contactDisplayName,
  contactInitials,
  contactSortKey,
  isContactOverdue,
  stayInTouchDaysUntilDue,
} from '~/utils/contact-helpers'

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

// ─── contactDisplayName edge cases ────────────────────────────────────────────

describe('contactDisplayName — edge cases', () => {
  it('handles names with extra whitespace gracefully', () => {
    const c = makeContact({ first_name: '  Alice  ', last_name: '  Smith  ' })
    // displayName should not double-space
    expect(contactDisplayName(c)).not.toMatch(/\s{2,}/)
  })

  it('shows nickname between first and last when all three set', () => {
    const c = makeContact({ first_name: 'Alice', last_name: 'Smith', nickname: 'Ali' })
    expect(contactDisplayName(c)).toBe('Alice "Ali" Smith')
  })

  it('works with Unicode names', () => {
    const c = makeContact({ first_name: '李', last_name: '明' })
    expect(contactDisplayName(c)).toBe('李 明')
  })

  it('handles contact with only last name set', () => {
    const c = makeContact({ first_name: '', last_name: 'Smith' })
    expect(contactDisplayName(c)).toBe('Smith')
  })
})

// ─── contactInitials edge cases ───────────────────────────────────────────────

describe('contactInitials — edge cases', () => {
  it('uppercases Unicode initials', () => {
    const c = makeContact({ first_name: 'étienne', last_name: 'Dupont' })
    expect(contactInitials(c)).toBe('ÉD')
  })

  it('returns ? for completely empty contact', () => {
    const c = makeContact({ first_name: '', last_name: '', nickname: '' })
    expect(contactInitials(c)).toBe('?')
  })
})

// ─── contactSortKey edge cases ────────────────────────────────────────────────

describe('contactSortKey — edge cases', () => {
  it('handles numeric prefixes correctly', () => {
    const c = makeContact({ first_name: '3D', last_name: '' })
    expect(contactSortKey(c)).toBe('3d')
  })

  it('sorts contacts with accented names consistently', () => {
    const c = makeContact({ first_name: 'Étienne', last_name: 'Dupont' })
    expect(contactSortKey(c)).toBe('dupont étienne')
  })
})

// ─── stay-in-touch boundary conditions ────────────────────────────────────────

describe('stayInTouchDaysUntilDue — boundary conditions', () => {
  it('returns 0 when due exactly today', () => {
    const sit: StayInTouch = {
      id: 's1', contact_id: 'c1', frequency_days: 30,
      last_contacted_at: null, next_remind_at: '2024-06-15',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }
    expect(stayInTouchDaysUntilDue(sit, '2024-06-15')).toBe(0)
  })

  it('returns -1 for yesterday', () => {
    const sit: StayInTouch = {
      id: 's1', contact_id: 'c1', frequency_days: 30,
      last_contacted_at: null, next_remind_at: '2024-06-14',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }
    expect(stayInTouchDaysUntilDue(sit, '2024-06-15')).toBe(-1)
  })
})

describe('isContactOverdue', () => {
  it('considers today as overdue (due today = overdue)', () => {
    const sit: StayInTouch = {
      id: 's1', contact_id: 'c1', frequency_days: 30,
      last_contacted_at: null, next_remind_at: '2024-06-15',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }
    expect(isContactOverdue(sit, '2024-06-15')).toBe(true)
  })

  it('is not overdue for tomorrow', () => {
    const sit: StayInTouch = {
      id: 's1', contact_id: 'c1', frequency_days: 30,
      last_contacted_at: null, next_remind_at: '2024-06-16',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }
    expect(isContactOverdue(sit, '2024-06-15')).toBe(false)
  })
})
