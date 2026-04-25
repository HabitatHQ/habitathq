import { describe, expect, it } from 'vitest'
import { convertCurrency, isSupportedCurrency, SUPPORTED_CURRENCIES } from '~/lib/currency/convert'

describe('convertCurrency', () => {
  it('converts EUR to USD at given rate', () => {
    expect(convertCurrency(50, 1.105)).toBeCloseTo(55.25, 2)
  })

  it('returns original amount when rate is 1', () => {
    expect(convertCurrency(100, 1)).toBe(100)
  })

  it('handles negative amounts', () => {
    expect(convertCurrency(-50, 1.105)).toBeCloseTo(-55.25, 2)
  })

  it('rounds to 2 decimal places', () => {
    expect(convertCurrency(33.33, 1.1)).toBeCloseTo(36.66, 2)
  })

  it('handles zero', () => {
    expect(convertCurrency(0, 1.5)).toBe(0)
  })
})

describe('SUPPORTED_CURRENCIES', () => {
  it('includes major currencies', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code)
    for (const code of ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'INR', 'MXN']) {
      expect(codes).toContain(code)
    }
  })

  it('each entry has code, name, and symbol', () => {
    for (const c of SUPPORTED_CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/)
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.symbol.length).toBeGreaterThan(0)
    }
  })
})

describe('isSupportedCurrency', () => {
  it('returns true for USD', () => {
    expect(isSupportedCurrency('USD')).toBe(true)
  })
  it('returns true for EUR', () => {
    expect(isSupportedCurrency('EUR')).toBe(true)
  })
  it('returns false for XYZ', () => {
    expect(isSupportedCurrency('XYZ')).toBe(false)
  })
})
