import { describe, expect, it } from 'vitest'
import type { Address } from '~/types/database'
import {
  addressOneLiner,
  formatAddress,
  isAddressEmpty,
  normalizeCountry,
} from '~/utils/address-helpers'

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: 'a1',
    contact_id: 'c1',
    type_id: null,
    street: '',
    city: '',
    province: '',
    postal_code: '',
    country: '',
    is_primary: false,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── isAddressEmpty ───────────────────────────────────────────────────────────

describe('isAddressEmpty', () => {
  it('returns true when all fields are empty', () => {
    expect(isAddressEmpty(makeAddress())).toBe(true)
  })

  it('returns false when city is set', () => {
    expect(isAddressEmpty(makeAddress({ city: 'Paris' }))).toBe(false)
  })

  it('returns false when only street is set', () => {
    expect(isAddressEmpty(makeAddress({ street: '10 Downing St' }))).toBe(false)
  })

  it('returns false when only country is set', () => {
    expect(isAddressEmpty(makeAddress({ country: 'France' }))).toBe(false)
  })
})

// ─── formatAddress ────────────────────────────────────────────────────────────

describe('formatAddress', () => {
  it('formats a full address as multi-line', () => {
    const a = makeAddress({
      street: '10 Downing St',
      city: 'London',
      province: 'England',
      postal_code: 'SW1A 2AA',
      country: 'United Kingdom',
    })
    const result = formatAddress(a)
    expect(result).toContain('10 Downing St')
    expect(result).toContain('London')
    expect(result).toContain('SW1A 2AA')
    expect(result).toContain('United Kingdom')
  })

  it('omits empty fields', () => {
    const a = makeAddress({ city: 'Paris', country: 'France' })
    const result = formatAddress(a)
    expect(result).not.toMatch(/^\s*\n/)  // no leading blank lines
    expect(result).toContain('Paris')
    expect(result).toContain('France')
  })

  it('returns empty string for empty address', () => {
    expect(formatAddress(makeAddress())).toBe('')
  })
})

// ─── addressOneLiner ──────────────────────────────────────────────────────────

describe('addressOneLiner', () => {
  it('returns city, country when both set', () => {
    const a = makeAddress({ city: 'Paris', country: 'France' })
    expect(addressOneLiner(a)).toBe('Paris, France')
  })

  it('returns just city when no country', () => {
    const a = makeAddress({ city: 'Berlin', country: '' })
    expect(addressOneLiner(a)).toBe('Berlin')
  })

  it('returns just country when no city', () => {
    const a = makeAddress({ city: '', country: 'Germany' })
    expect(addressOneLiner(a)).toBe('Germany')
  })

  it('includes street when city is missing', () => {
    const a = makeAddress({ street: '42 Main St', city: '', country: 'US' })
    expect(addressOneLiner(a)).toContain('42 Main St')
  })

  it('returns empty string for empty address', () => {
    expect(addressOneLiner(makeAddress())).toBe('')
  })
})

// ─── normalizeCountry ─────────────────────────────────────────────────────────

describe('normalizeCountry', () => {
  it('returns the country as-is when it is already spelled out', () => {
    expect(normalizeCountry('France')).toBe('France')
  })

  it('expands US to United States', () => {
    expect(normalizeCountry('US')).toBe('United States')
  })

  it('expands UK to United Kingdom', () => {
    expect(normalizeCountry('UK')).toBe('United Kingdom')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeCountry('')).toBe('')
  })
})
