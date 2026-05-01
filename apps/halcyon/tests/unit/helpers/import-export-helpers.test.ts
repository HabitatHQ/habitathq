import { describe, expect, it } from 'vitest'
import type { Contact, ContactField, ContactFieldType } from '~/types/database'
import {
  contactToVCard,
  parseVCardBlock,
  vCardEmailType,
  vCardPhoneType,
} from '~/utils/import-export-helpers'

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

function makeField(overrides: Partial<ContactField> = {}): ContactField {
  return {
    id: 'f1',
    contact_id: 'c1',
    type_id: 'ft1',
    value: 'alice@example.com',
    label: 'personal',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeFieldType(overrides: Partial<ContactFieldType> = {}): ContactFieldType {
  return {
    id: 'ft1',
    vault_id: 'v1',
    name: 'Email',
    icon: 'i-heroicons-envelope',
    protocol: 'mailto:',
    is_default: true,
    ...overrides,
  }
}

// ─── contactToVCard ───────────────────────────────────────────────────────────

describe('contactToVCard', () => {
  it('starts with BEGIN:VCARD and ends with END:VCARD', () => {
    const vcard = contactToVCard(makeContact(), [])
    expect(vcard.trim().startsWith('BEGIN:VCARD')).toBe(true)
    expect(vcard.trim().endsWith('END:VCARD')).toBe(true)
  })

  it('includes VERSION:3.0', () => {
    expect(contactToVCard(makeContact(), [])).toContain('VERSION:3.0')
  })

  it('includes FN with full name', () => {
    expect(contactToVCard(makeContact(), [])).toContain('FN:Alice Smith')
  })

  it('includes N field with last;first format', () => {
    expect(contactToVCard(makeContact(), [])).toContain('N:Smith;Alice')
  })

  it('includes NICKNAME when set', () => {
    expect(contactToVCard(makeContact({ nickname: 'Ali' }), [])).toContain('NICKNAME:Ali')
  })

  it('omits NICKNAME when empty', () => {
    expect(contactToVCard(makeContact({ nickname: '' }), [])).not.toContain('NICKNAME')
  })

  it('includes BDAY in YYYY-MM-DD format', () => {
    expect(contactToVCard(makeContact({ birthday: '1990-03-15' }), [])).toContain('BDAY:1990-03-15')
  })

  it('omits BDAY when birthday is null', () => {
    expect(contactToVCard(makeContact({ birthday: null }), [])).not.toContain('BDAY')
  })

  it('includes email field', () => {
    const field = makeField({ value: 'alice@example.com' })
    const fieldType = makeFieldType({ name: 'Email', protocol: 'mailto:' })
    const vcard = contactToVCard(makeContact(), [{ ...field, type: fieldType }])
    expect(vcard).toContain('alice@example.com')
    expect(vcard).toContain('EMAIL')
  })

  it('includes phone field', () => {
    const field = makeField({ value: '+1234567890' })
    const fieldType = makeFieldType({ name: 'Phone', protocol: 'tel:', id: 'ft2' })
    const vcard = contactToVCard(makeContact(), [{ ...field, type: fieldType }])
    expect(vcard).toContain('TEL')
    expect(vcard).toContain('+1234567890')
  })
})

// ─── parseVCardBlock ──────────────────────────────────────────────────────────

describe('parseVCardBlock', () => {
  const sampleVCard = `BEGIN:VCARD
VERSION:3.0
FN:Bob Jones
N:Jones;Bob;;;
NICKNAME:Bobby
BDAY:1985-07-04
EMAIL;TYPE=internet:bob@example.com
TEL;TYPE=cell:+9876543210
END:VCARD`

  it('parses the full name', () => {
    const result = parseVCardBlock(sampleVCard)
    expect(result.first_name).toBe('Bob')
    expect(result.last_name).toBe('Jones')
  })

  it('parses the nickname', () => {
    expect(parseVCardBlock(sampleVCard).nickname).toBe('Bobby')
  })

  it('parses birthday', () => {
    expect(parseVCardBlock(sampleVCard).birthday).toBe('1985-07-04')
  })

  it('parses email fields', () => {
    const result = parseVCardBlock(sampleVCard)
    expect(result.fields.some((f) => f.value === 'bob@example.com')).toBe(true)
  })

  it('parses phone fields', () => {
    const result = parseVCardBlock(sampleVCard)
    expect(result.fields.some((f) => f.value === '+9876543210')).toBe(true)
  })

  it('handles missing optional fields gracefully', () => {
    const minimal = `BEGIN:VCARD\nVERSION:3.0\nFN:Solo\nN:;Solo;;;\nEND:VCARD`
    const result = parseVCardBlock(minimal)
    expect(result.first_name).toBe('Solo')
    expect(result.birthday).toBeNull()
    expect(result.nickname).toBe('')
  })
})

// ─── vCardEmailType / vCardPhoneType ──────────────────────────────────────────

describe('vCardEmailType', () => {
  it('returns "Email" for basic EMAIL property', () => {
    expect(vCardEmailType('EMAIL')).toBe('Email')
  })

  it('returns "Email" for EMAIL;TYPE=internet', () => {
    expect(vCardEmailType('EMAIL;TYPE=internet')).toBe('Email')
  })
})

describe('vCardPhoneType', () => {
  it('returns "Phone" for TEL;TYPE=cell', () => {
    expect(vCardPhoneType('TEL;TYPE=cell')).toBe('Phone')
  })

  it('returns "Phone" for TEL', () => {
    expect(vCardPhoneType('TEL')).toBe('Phone')
  })
})
