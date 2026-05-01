import { describe, expect, it } from 'vitest'
import { parseDate } from '~/lib/nlp/parse-date'

// 2026-04-24 is a Friday
const TODAY = '2026-04-24'

describe('parseDate', () => {
  it('parses "today"', () => {
    expect(parseDate('today', TODAY)?.date).toBe('2026-04-24')
  })

  it('parses "yesterday"', () => {
    expect(parseDate('yesterday', TODAY)?.date).toBe('2026-04-23')
  })

  it('parses "day before yesterday"', () => {
    expect(parseDate('day before yesterday', TODAY)?.date).toBe('2026-04-22')
  })

  it('parses "last friday" (today is Friday → previous Friday)', () => {
    expect(parseDate('last friday', TODAY)?.date).toBe('2026-04-17')
  })

  it('parses "last monday"', () => {
    expect(parseDate('last monday', TODAY)?.date).toBe('2026-04-20')
  })

  it('parses "this friday" (today is Friday)', () => {
    expect(parseDate('this friday', TODAY)?.date).toBe('2026-04-24')
  })

  it('parses "march 3"', () => {
    expect(parseDate('march 3', TODAY)?.date).toBe('2026-03-03')
  })

  it('parses "mar 3rd"', () => {
    expect(parseDate('mar 3rd', TODAY)?.date).toBe('2026-03-03')
  })

  it('parses "3/15"', () => {
    const r = parseDate('3/15', TODAY)
    expect(r?.date).toBe('2026-03-15')
    expect(r?.confidence).toBe('medium')
  })

  it('returns null when no date found', () => {
    expect(parseDate('coffee at starbucks', TODAY)).toBeNull()
  })

  it('parses "yesterday" in a sentence', () => {
    const r = parseDate('$5 coffee yesterday', TODAY)
    expect(r?.date).toBe('2026-04-23')
  })
})
