import { describe, expect, it } from 'vitest'
import type {
  CurrencyBreakdown,
  ExchangeRate,
  Transaction,
  WorkerRequestBody,
} from '~/types/database'

describe('Transaction type — currency fields', () => {
  it('accepts home_amount and exchange_rate', () => {
    const tx: Transaction = {
      id: 'tx1',
      date: '2026-04-01',
      amount: -50,
      currency: 'EUR',
      home_amount: -55.25,
      exchange_rate: 1.105,
      account_id: 'a1',
      user_id: 'u1',
      type: 'expense',
      category_id: null,
      description: '',
      merchant: 'Cafe',
      is_private: 0,
      is_recurring: 0,
      transfer_to_account_id: null,
      split_id: null,
      source: 'manual',
      created_at: '',
      updated_at: '',
    }
    expect(tx.home_amount).toBe(-55.25)
    expect(tx.exchange_rate).toBe(1.105)
  })

  it('accepts null for home_amount and exchange_rate', () => {
    const tx: Transaction = {
      id: 'tx2',
      date: '2026-04-01',
      amount: -50,
      currency: 'USD',
      home_amount: null,
      exchange_rate: null,
      account_id: 'a1',
      user_id: 'u1',
      type: 'expense',
      category_id: null,
      description: '',
      merchant: 'Coffee',
      is_private: 0,
      is_recurring: 0,
      transfer_to_account_id: null,
      split_id: null,
      source: 'manual',
      created_at: '',
      updated_at: '',
    }
    expect(tx.home_amount).toBeNull()
    expect(tx.exchange_rate).toBeNull()
  })
})

describe('ExchangeRate type', () => {
  it('has base, target, rate, date fields', () => {
    const er: ExchangeRate = { base: 'EUR', target: 'USD', rate: 1.105, date: '2026-04-25' }
    expect(er.rate).toBe(1.105)
  })
})

describe('CurrencyBreakdown type', () => {
  it('has currency, expenses, income, tx_count fields', () => {
    const cb: CurrencyBreakdown = { currency: 'EUR', expenses: 500, income: 0, tx_count: 3 }
    expect(cb.currency).toBe('EUR')
  })
})

describe('WorkerRequestBody — exchange rate messages', () => {
  it('GET_EXCHANGE_RATE payload shape', () => {
    const msg: WorkerRequestBody = {
      type: 'GET_EXCHANGE_RATE',
      payload: { base: 'EUR', target: 'USD', date: '2026-04-25' },
    }
    expect(msg.type).toBe('GET_EXCHANGE_RATE')
  })

  it('UPSERT_EXCHANGE_RATE payload shape', () => {
    const msg: WorkerRequestBody = {
      type: 'UPSERT_EXCHANGE_RATE',
      payload: { base: 'EUR', target: 'USD', rate: 1.105, date: '2026-04-25' },
    }
    expect(msg.type).toBe('UPSERT_EXCHANGE_RATE')
  })

  it('GET_CURRENCY_BREAKDOWN payload shape', () => {
    const msg: WorkerRequestBody = {
      type: 'GET_CURRENCY_BREAKDOWN',
      payload: { period: '2026-04' },
    }
    expect(msg.type).toBe('GET_CURRENCY_BREAKDOWN')
  })
})
