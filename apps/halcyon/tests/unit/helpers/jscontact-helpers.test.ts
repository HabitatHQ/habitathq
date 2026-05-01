import { describe, expect, it } from 'vitest'
import type { Contact, ContactField, ContactFieldType } from '~/types/database'
import {
  contactToJSContact,
  parseJSContact,
} from '~/utils/jscontact-helpers'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    vault_id: 'v1',
    first_name: 'Alice',
    last_name: 'Smith',
    nickname: 'Ali',
    maiden_name: '',
    middle_name: '',
    pronouns: '',
    gender: '',
    how_we_met: '',
    is_deceased: false,
    deceased_at: null,
    birthday: '1990-03-15',
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

function makeFieldWithType(value: string, protocol: string, name: string): ContactField & { type: ContactFieldType } {
  return {
    id: 'f1',
    contact_id: 'c1',
    type_id: 'ft1',
    value,
    label: '',
    created_at: '2024-01-01T00:00:00Z',
    type: {
      id: 'ft1',
      vault_id: 'v1',
      name,
      icon: 'i-heroicons-link',
      protocol,
      is_default: false,
    },
  }
}

// ─── contactToJSContact ───────────────────────────────────────────────────────

describe('contactToJSContact', () => {
  it('sets @type to "Card"', () => {
    const card = contactToJSContact(makeContact(), [])
    expect(card['@type']).toBe('Card')
  })

  it('sets version to "1.0"', () => {
    expect(contactToJSContact(makeContact(), []).version).toBe('1.0')
  })

  it('sets uid from contact id', () => {
    expect(contactToJSContact(makeContact({ id: 'abc-123' }), []).uid).toBe('abc-123')
  })

  it('sets name.full', () => {
    const card = contactToJSContact(makeContact(), [])
    expect(card.name?.full).toBe('Alice Smith')
  })

  it('includes given and surname name components', () => {
    const card = contactToJSContact(makeContact(), [])
    const components = card.name?.components ?? []
    expect(components.some((c: any) => c.kind === 'given' && c.value === 'Alice')).toBe(true)
    expect(components.some((c: any) => c.kind === 'surname' && c.value === 'Smith')).toBe(true)
  })

  it('includes nickname when set', () => {
    const card = contactToJSContact(makeContact({ nickname: 'Ali' }), [])
    const nicknames = Object.values(card.nicknames ?? {}) as any[]
    expect(nicknames.some((n) => n.name === 'Ali')).toBe(true)
  })

  it('omits nicknames when empty', () => {
    const card = contactToJSContact(makeContact({ nickname: '' }), [])
    expect(card.nicknames).toBeUndefined()
  })

  it('includes birthday as anniversaries entry', () => {
    const card = contactToJSContact(makeContact({ birthday: '1990-03-15' }), [])
    const anniversaries = Object.values(card.anniversaries ?? {}) as any[]
    expect(anniversaries.some((a) => a.kind === 'birth' && a.date?.calendarDate === '1990-03-15')).toBe(true)
  })

  it('omits anniversaries when birthday is null', () => {
    const card = contactToJSContact(makeContact({ birthday: null }), [])
    expect(card.anniversaries).toBeUndefined()
  })

  it('includes email in emails map', () => {
    const field = makeFieldWithType('alice@example.com', 'mailto:', 'Email')
    const card = contactToJSContact(makeContact(), [field])
    const emails = Object.values(card.emails ?? {}) as any[]
    expect(emails.some((e) => e.address === 'alice@example.com')).toBe(true)
  })

  it('includes phone in phones map', () => {
    const field = makeFieldWithType('+1234567890', 'tel:', 'Phone')
    const card = contactToJSContact(makeContact(), [field])
    const phones = Object.values(card.phones ?? {}) as any[]
    expect(phones.some((p) => p.number === '+1234567890')).toBe(true)
  })

  it('includes other fields in online map', () => {
    const field = makeFieldWithType('https://linkedin.com/in/alice', 'https:', 'LinkedIn')
    const card = contactToJSContact(makeContact(), [field])
    const online = Object.values(card.online ?? {}) as any[]
    expect(online.some((o) => o.uri === 'https://linkedin.com/in/alice')).toBe(true)
  })
})

// ─── parseJSContact ───────────────────────────────────────────────────────────

describe('parseJSContact', () => {
  const sampleCard = {
    '@type': 'Card',
    version: '1.0',
    uid: 'urn:uuid:abc-123',
    name: {
      full: 'Bob Jones',
      components: [
        { kind: 'given', value: 'Bob' },
        { kind: 'surname', value: 'Jones' },
      ],
    },
    nicknames: { n1: { name: 'Bobby' } },
    anniversaries: {
      a1: { kind: 'birth', date: { calendarDate: '1985-07-04' } },
    },
    emails: {
      e1: { address: 'bob@example.com' },
    },
    phones: {
      p1: { number: '+9876543210' },
    },
  }

  it('parses first_name and last_name from name components', () => {
    const result = parseJSContact(sampleCard)
    expect(result.first_name).toBe('Bob')
    expect(result.last_name).toBe('Jones')
  })

  it('falls back to splitting name.full when no components', () => {
    const card = { ...sampleCard, name: { full: 'Bob Jones' } }
    const result = parseJSContact(card)
    expect(result.first_name).toBe('Bob')
    expect(result.last_name).toBe('Jones')
  })

  it('parses nickname', () => {
    expect(parseJSContact(sampleCard).nickname).toBe('Bobby')
  })

  it('parses birthday from anniversaries', () => {
    expect(parseJSContact(sampleCard).birthday).toBe('1985-07-04')
  })

  it('parses email fields', () => {
    const result = parseJSContact(sampleCard)
    expect(result.fields.some((f) => f.value === 'bob@example.com' && f.label === 'email')).toBe(true)
  })

  it('parses phone fields', () => {
    const result = parseJSContact(sampleCard)
    expect(result.fields.some((f) => f.value === '+9876543210' && f.label === 'phone')).toBe(true)
  })

  it('handles missing optional fields gracefully', () => {
    const minimal = { '@type': 'Card', version: '1.0', name: { full: 'Solo' } }
    const result = parseJSContact(minimal)
    expect(result.first_name).toBe('Solo')
    expect(result.birthday).toBeNull()
    expect(result.nickname).toBe('')
    expect(result.fields).toHaveLength(0)
  })

  it('returns empty strings when name is missing', () => {
    const result = parseJSContact({ '@type': 'Card', version: '1.0' })
    expect(result.first_name).toBe('')
    expect(result.last_name).toBe('')
  })
})
