import { describe, expect, it } from 'vitest'
import { homeCurrencyAmount } from '~/lib/reports/amounts'

describe('report transaction amounts', () => {
  it('uses the stored home-currency conversion for foreign transactions', () => {
    expect(homeCurrencyAmount({ amount: -90, home_amount: -63.5 })).toBe(-63.5)
  })

  it('uses the transaction amount when no home-currency conversion is stored', () => {
    expect(homeCurrencyAmount({ amount: -90, home_amount: null })).toBe(-90)
  })
})
