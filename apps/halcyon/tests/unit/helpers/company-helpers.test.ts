import { describe, expect, it } from 'vitest'
import type { Company, Contact, Occupation, OccupationWithCompany } from '~/types/database'
import {
  companyEmployeeCount,
  formatOccupation,
  normalizeWebsite,
  occupationLabel,
} from '~/utils/company-helpers'

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co1',
    vault_id: 'v1',
    name: 'Acme Corp',
    website: '',
    description: '',
    tags: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeOccupation(overrides: Partial<Occupation> = {}): Occupation {
  return {
    id: 'o1',
    contact_id: 'c1',
    company_id: 'co1',
    title: '',
    department: '',
    is_current: true,
    started_at: null,
    ended_at: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

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

// ─── occupationLabel ──────────────────────────────────────────────────────────

describe('occupationLabel', () => {
  it('returns title + company name when both set', () => {
    const occ: OccupationWithCompany = {
      ...makeOccupation({ title: 'Engineer' }),
      company: makeCompany({ name: 'Acme' }),
    }
    expect(occupationLabel(occ)).toBe('Engineer at Acme')
  })

  it('returns just title when no company', () => {
    const occ: OccupationWithCompany = { ...makeOccupation({ title: 'Freelancer' }), company: null }
    expect(occupationLabel(occ)).toBe('Freelancer')
  })

  it('returns just company name when no title', () => {
    const occ: OccupationWithCompany = {
      ...makeOccupation({ title: '' }),
      company: makeCompany({ name: 'BigCorp' }),
    }
    expect(occupationLabel(occ)).toBe('BigCorp')
  })

  it('returns "Unknown role" when neither title nor company', () => {
    const occ: OccupationWithCompany = { ...makeOccupation({ title: '' }), company: null }
    expect(occupationLabel(occ)).toBe('Unknown role')
  })
})

// ─── formatOccupation ─────────────────────────────────────────────────────────

describe('formatOccupation', () => {
  it('includes department when set', () => {
    const occ: OccupationWithCompany = {
      ...makeOccupation({ title: 'Manager', department: 'Sales' }),
      company: makeCompany({ name: 'Corp' }),
    }
    expect(formatOccupation(occ)).toContain('Sales')
  })

  it('includes date range when both dates set', () => {
    const occ: OccupationWithCompany = {
      ...makeOccupation({ started_at: '2020-01-01', ended_at: '2023-12-31', is_current: false }),
      company: null,
    }
    const result = formatOccupation(occ)
    expect(result).toContain('2020')
    expect(result).toContain('2023')
  })

  it('shows "present" when current and has start date', () => {
    const occ: OccupationWithCompany = {
      ...makeOccupation({ started_at: '2022-01-01', is_current: true }),
      company: null,
    }
    expect(formatOccupation(occ).toLowerCase()).toContain('present')
  })
})

// ─── normalizeWebsite ─────────────────────────────────────────────────────────

describe('normalizeWebsite', () => {
  it('adds https:// when scheme is missing', () => {
    expect(normalizeWebsite('example.com')).toBe('https://example.com')
  })

  it('leaves https:// URLs unchanged', () => {
    expect(normalizeWebsite('https://example.com')).toBe('https://example.com')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeWebsite('')).toBe('')
  })
})

// ─── companyEmployeeCount ─────────────────────────────────────────────────────

describe('companyEmployeeCount', () => {
  it('counts contacts linked to the company', () => {
    const contacts: Contact[] = [
      makeContact({ id: 'c1' }),
      makeContact({ id: 'c2' }),
      makeContact({ id: 'c3' }),
    ]
    expect(companyEmployeeCount(contacts)).toBe(3)
  })

  it('returns 0 for empty array', () => {
    expect(companyEmployeeCount([])).toBe(0)
  })
})
