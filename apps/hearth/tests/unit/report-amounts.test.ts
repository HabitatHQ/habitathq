import { describe, expect, it } from 'vitest'
import { homeCurrencyAmount } from '~/lib/reports/amounts'

describe('report transaction amounts', () => {
  const foreignTransaction = {
    amount: -90,
    currency: 'EUR',
    date: '2026-01-05',
    home_amount: null,
    home_currency: null,
  }

  it('keeps native amounts in the selected home currency', () => {
    expect(homeCurrencyAmount({ ...foreignTransaction, currency: 'USD' }, 'USD')).toBe(-90)
  })

  it('uses a saved conversion only for the currency it targeted', () => {
    const transaction = {
      ...foreignTransaction,
      home_amount: -63.5,
      home_currency: 'USD',
    }
    expect(homeCurrencyAmount(transaction, 'USD')).toBe(-63.5)
    expect(homeCurrencyAmount(transaction, 'CAD')).toBeNull()
  })

  it('uses only an exact positive cached base/target/date rate', () => {
    const rate = { base: 'EUR', target: 'USD', date: '2026-01-05', rate: 1.1 }
    expect(homeCurrencyAmount(foreignTransaction, 'USD', rate)).toBe(-99)
    expect(homeCurrencyAmount(foreignTransaction, 'CAD', rate)).toBeNull()
    expect(homeCurrencyAmount(foreignTransaction, 'USD', { ...rate, date: '2026-01-06' })).toBeNull()
    expect(homeCurrencyAmount(foreignTransaction, 'USD', { ...rate, rate: 0 })).toBeNull()
    expect(homeCurrencyAmount(foreignTransaction, 'USD', { ...rate, rate: -1 })).toBeNull()
  })

  it('rounds cached expense and income conversions to cents with their signs intact', () => {
    const rate = { base: 'EUR', target: 'USD', date: '2026-01-05', rate: 1.005 }
    expect(
      homeCurrencyAmount({ ...foreignTransaction, amount: -10.01 }, 'USD', rate),
    ).toBe(-10.06)
    expect(
      homeCurrencyAmount({ ...foreignTransaction, amount: 10.01 }, 'USD', rate),
    ).toBe(10.06)
  })

  it('excludes nonfinite native and saved amounts', () => {
    expect(
      homeCurrencyAmount({ ...foreignTransaction, amount: Number.NaN, currency: 'USD' }, 'USD'),
    ).toBeNull()
    expect(
      homeCurrencyAmount(
        { ...foreignTransaction, home_amount: Number.POSITIVE_INFINITY, home_currency: 'USD' },
        'USD',
      ),
    ).toBeNull()
  })

  it('preserves a valid zero conversion and excludes an unknown target', () => {
    expect(
      homeCurrencyAmount(
        { ...foreignTransaction, home_amount: 0, home_currency: 'USD' },
        'USD',
      ),
    ).toBe(0)
    expect(
      homeCurrencyAmount(
        { ...foreignTransaction, home_amount: 0, home_currency: null },
        'USD',
      ),
    ).toBeNull()
  })
})
