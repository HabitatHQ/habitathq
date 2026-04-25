import { describe, expect, it } from 'vitest'
import { parseAmount } from '~/lib/nlp/parse-amount'

describe('parseAmount', () => {
  it('parses $5', () => {
    const r = parseAmount('$5')
    expect(r?.amount).toBe(5)
    expect(r?.confidence).toBe('high')
  })

  it('parses $5.40', () => {
    expect(parseAmount('$5.40')?.amount).toBe(5.4)
  })

  it('parses $12.50 in a sentence', () => {
    const r = parseAmount('coffee at starbucks $12.50 yesterday')
    expect(r?.amount).toBe(12.5)
    expect(r?.confidence).toBe('high')
  })

  it('parses $1,234.56', () => {
    expect(parseAmount('$1,234.56')?.amount).toBe(1234.56)
  })

  it('parses "12 dollars"', () => {
    const r = parseAmount('12 dollars for lunch')
    expect(r?.amount).toBe(12)
    expect(r?.confidence).toBe('high')
  })

  it('parses "12 bucks"', () => {
    expect(parseAmount('12 bucks')?.amount).toBe(12)
  })

  it('parses "five dollars"', () => {
    const r = parseAmount('five dollars')
    expect(r?.amount).toBe(5)
    expect(r?.confidence).toBe('medium')
  })

  it('parses "twenty bucks"', () => {
    expect(parseAmount('twenty bucks')?.amount).toBe(20)
  })

  it('parses bare number as low confidence', () => {
    const r = parseAmount('coffee 6')
    expect(r?.amount).toBe(6)
    expect(r?.confidence).toBe('low')
  })

  it('returns null for no amount', () => {
    expect(parseAmount('coffee at Blue Bottle')).toBeNull()
  })
})

describe('parseAmount — multi-currency', () => {
  it('parses €50 as EUR', () => {
    const r = parseAmount('€50')
    expect(r?.amount).toBe(50)
    expect(r?.confidence).toBe('high')
    expect(r?.currency).toBe('EUR')
  })

  it('parses £12.50 as GBP', () => {
    const r = parseAmount('coffee £12.50 yesterday')
    expect(r?.amount).toBe(12.5)
    expect(r?.currency).toBe('GBP')
  })

  it('parses ¥3000 as JPY', () => {
    const r = parseAmount('¥3000')
    expect(r?.amount).toBe(3000)
    expect(r?.currency).toBe('JPY')
  })

  it('parses "50 euros" as EUR', () => {
    const r = parseAmount('50 euros for dinner')
    expect(r?.amount).toBe(50)
    expect(r?.currency).toBe('EUR')
  })

  it('parses "12 EUR" as EUR', () => {
    const r = parseAmount('12 EUR')
    expect(r?.amount).toBe(12)
    expect(r?.currency).toBe('EUR')
  })

  it('parses "50 GBP" as GBP', () => {
    const r = parseAmount('50 GBP')
    expect(r?.amount).toBe(50)
    expect(r?.currency).toBe('GBP')
  })

  it('parses $5 as USD', () => {
    const r = parseAmount('$5')
    expect(r?.currency).toBe('USD')
  })

  it('bare number has no currency', () => {
    const r = parseAmount('coffee 6')
    expect(r?.amount).toBe(6)
    expect(r?.currency).toBeUndefined()
  })

  it('parses "12 dollars" as USD', () => {
    const r = parseAmount('12 dollars for lunch')
    expect(r?.currency).toBe('USD')
  })

  it('parses €1,234.56 with comma thousands', () => {
    const r = parseAmount('€1,234.56')
    expect(r?.amount).toBe(1234.56)
    expect(r?.currency).toBe('EUR')
  })
})
