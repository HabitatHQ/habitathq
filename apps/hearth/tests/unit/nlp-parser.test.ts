import { describe, expect, it } from 'vitest'
import { parseUtterance } from '~/lib/nlp/parser'
import type { ParserContext } from '~/lib/nlp/types'

const TODAY = '2026-04-24'

const defaultContext: ParserContext = {
  categories: [
    { id: 'c1', parent_id: null, name: 'Food', icon: '🍔' },
    { id: 'c1a', parent_id: 'c1', name: 'Groceries', icon: '🛒' },
    { id: 'c1b', parent_id: 'c1', name: 'Dining Out', icon: '🍽️' },
    { id: 'c1c', parent_id: 'c1', name: 'Coffee', icon: '☕' },
    { id: 'c2', parent_id: null, name: 'Transport', icon: '🚗' },
    { id: 'c2a', parent_id: 'c2', name: 'Gas', icon: '⛽' },
    { id: 'c7', parent_id: null, name: 'Income', icon: '💰' },
    { id: 'c7a', parent_id: 'c7', name: 'Salary', icon: '💼' },
  ],
  accounts: [
    { id: 'a1', name: 'Joint Checking', type: 'checking' },
    { id: 'a2', name: 'Savings', type: 'savings' },
    { id: 'a3', name: 'Visa Credit', type: 'credit' },
  ],
  merchantMappings: new Map(),
  defaultAccountByType: {
    expense: 'a1',
    income: 'a1',
    transfer: 'a1',
  },
  currentUserId: 'u1',
  today: TODAY,
}

describe('parseUtterance', () => {
  it('parses "$6 coffee at Blue Bottle"', () => {
    const result = parseUtterance('$6 coffee at Blue Bottle', defaultContext)
    expect(result.transactions).toHaveLength(1)
    const tx = result.transactions[0]
    expect(tx.amount).toBe(6)
    expect(tx.type).toBe('expense')
    expect(tx.categoryId).toBe('c1c') // coffee keyword
    expect(tx.merchant).toContain('Blue Bottle')
    expect(tx.date).toBe(TODAY)
  })

  it('parses "lunch at Sweetgreen $22.50 yesterday"', () => {
    const result = parseUtterance('lunch at Sweetgreen $22.50 yesterday', defaultContext)
    expect(result.transactions).toHaveLength(1)
    const tx = result.transactions[0]
    expect(tx.amount).toBe(22.5)
    expect(tx.date).toBe('2026-04-23')
    expect(tx.categoryId).toBe('c1b') // lunch → Dining Out
  })

  it('parses "got paid $5200 salary"', () => {
    const result = parseUtterance('got paid $5200 salary', defaultContext)
    expect(result.transactions).toHaveLength(1)
    const tx = result.transactions[0]
    expect(tx.amount).toBe(5200)
    expect(tx.type).toBe('income')
  })

  it('parses "transfer $200 from checking to savings"', () => {
    const result = parseUtterance('transfer $200 from checking to savings', defaultContext)
    expect(result.transactions).toHaveLength(1)
    const tx = result.transactions[0]
    expect(tx.type).toBe('transfer')
    expect(tx.amount).toBe(200)
    expect(tx.accountId).toBe('a1') // Joint Checking
    expect(tx.transferToAccountId).toBe('a2') // Savings
  })

  it('splits batch: "$6 coffee and $12 lunch"', () => {
    const result = parseUtterance('$6 coffee and $12 lunch', defaultContext)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0].amount).toBe(6)
    expect(result.transactions[1].amount).toBe(12)
  })

  it('splits on commas: "$5 coffee, $40 gas"', () => {
    const result = parseUtterance('$5 coffee, $40 gas', defaultContext)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0].amount).toBe(5)
    expect(result.transactions[1].amount).toBe(40)
  })

  it('splits on semicolons', () => {
    const result = parseUtterance('$5 coffee; $12 lunch; $40 gas', defaultContext)
    expect(result.transactions).toHaveLength(3)
  })

  it('handles no amount', () => {
    const result = parseUtterance('coffee at Blue Bottle', defaultContext)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].amount).toBeNull()
    expect(result.transactions[0].amountConfidence).toBe('low')
  })

  it('uses learned merchant mapping', () => {
    const ctx: ParserContext = {
      ...defaultContext,
      merchantMappings: new Map([['blue bottle', { category_id: 'c1c', account_id: 'a3' }]]),
    }
    const result = parseUtterance('$6 Blue Bottle', ctx)
    const tx = result.transactions[0]
    expect(tx.categoryId).toBe('c1c')
    expect(tx.categoryConfidence).toBe('high')
    expect(tx.accountId).toBe('a3')
  })

  it('returns empty for empty input', () => {
    const result = parseUtterance('', defaultContext)
    expect(result.transactions).toHaveLength(0)
  })

  it('marks uncertain fields as low confidence', () => {
    const result = parseUtterance('something random $10', defaultContext)
    const tx = result.transactions[0]
    expect(tx.typeConfidence).toBe('low') // defaulted to expense
    expect(tx.categoryConfidence).toBe('low') // no category match
  })
})
