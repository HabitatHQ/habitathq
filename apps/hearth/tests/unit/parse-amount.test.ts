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
