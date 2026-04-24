import { describe, expect, it } from 'vitest'
import { extractDate, extractMerchant, extractTotal } from '~/lib/ocr/receipt-parser'

describe('extractTotal', () => {
  it('extracts total from "TOTAL" line', () => {
    const lines = ['SUBTOTAL    $12.50', 'TAX         $1.10', 'TOTAL       $13.60']
    expect(extractTotal(lines)).toBeCloseTo(13.6)
  })

  it('extracts from "AMOUNT DUE"', () => {
    const lines = ['Items: 3', 'AMOUNT DUE: $45.99']
    expect(extractTotal(lines)).toBeCloseTo(45.99)
  })

  it('ignores SUBTOTAL', () => {
    const lines = ['SUBTOTAL $10.00', 'TOTAL $12.50']
    expect(extractTotal(lines)).toBeCloseTo(12.5)
  })

  it('falls back to largest amount', () => {
    const lines = ['Item 1   $5.00', 'Item 2   $8.50', 'Thank you!']
    expect(extractTotal(lines)).toBeCloseTo(8.5)
  })

  it('returns null for no amounts', () => {
    const lines = ['Thank you for shopping with us']
    expect(extractTotal(lines)).toBeNull()
  })
})

describe('extractDate', () => {
  it('extracts MM/DD/YYYY date', () => {
    expect(extractDate(['Date: 12/15/2025', 'Thank you'])).toBe('2025-12-15')
  })

  it('extracts YYYY-MM-DD date', () => {
    expect(extractDate(['2025-12-15  14:30', 'TOTAL $50'])).toBe('2025-12-15')
  })

  it('returns null when no date found', () => {
    expect(extractDate(['TOTAL $50', 'Thank you'])).toBeNull()
  })
})

describe('extractMerchant', () => {
  it('extracts merchant from first meaningful line', () => {
    const lines = [
      'WHOLE FOODS MARKET',
      '123 Main St, San Francisco CA',
      '(415) 555-1234',
      'TOTAL $87.50',
    ]
    expect(extractMerchant(lines)).toBe('WHOLE FOODS MARKET')
  })

  it('skips address and phone lines', () => {
    const lines = ['123 Main Street', '(555) 123-4567', 'TRADER JOES', 'Item 1  $5']
    expect(extractMerchant(lines)).toBe('TRADER JOES')
  })

  it('returns null for empty lines', () => {
    expect(extractMerchant([])).toBeNull()
  })
})
