import { describe, expect, it } from 'vitest'
import { getCreditCardPaymentSuggestion } from '~/lib/credit-card-payments'
import type { Account } from '~/types/database'

function account(overrides: Partial<Account> & Pick<Account, 'id' | 'type' | 'currency' | 'balance'>): Account {
  return {
    user_id: 'user-1',
    name: 'Account',
    color: '#000000',
    icon: 'wallet',
    is_active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('credit card payment suggestion', () => {
  const source = account({ id: 'checking', type: 'checking', currency: 'USD', balance: 1000 })
  const credit = account({ id: 'card', type: 'credit', currency: 'USD', balance: -325.5 })

  it('suggests the positive payoff amount for a same-currency credit transfer', () => {
    expect(getCreditCardPaymentSuggestion(source, credit, 'USD')).toBe(325.5)
  })

  it('does not suggest a payment when the card has no balance due', () => {
    expect(getCreditCardPaymentSuggestion(source, { ...credit, balance: 0 }, 'USD')).toBeNull()
    expect(getCreditCardPaymentSuggestion(source, { ...credit, balance: 125 }, 'USD')).toBeNull()
  })

  it('does not suggest a payment across currencies or for the source account itself', () => {
    expect(getCreditCardPaymentSuggestion(source, { ...credit, currency: 'EUR' }, 'USD')).toBeNull()
    expect(getCreditCardPaymentSuggestion(source, credit, 'EUR')).toBeNull()
    expect(getCreditCardPaymentSuggestion(credit, credit, 'USD')).toBeNull()
  })

  it('does not suggest a payment to a non-credit account', () => {
    expect(getCreditCardPaymentSuggestion(source, { ...credit, type: 'savings' }, 'USD')).toBeNull()
  })
})
