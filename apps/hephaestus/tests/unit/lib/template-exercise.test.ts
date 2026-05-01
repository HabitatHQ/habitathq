import { describe, expect, it } from 'vitest'
import type { AutoregulationRule } from '~/lib/template-exercise'
import {
  formatTempo,
  parseAutoregulation,
  parseRpeTargets,
  parseSubstitutes,
  parseTempo,
  serialiseAutoregulation,
  serialiseRpeTargets,
} from '~/lib/template-exercise'

describe('parseRpeTargets', () => {
  it('parses a valid JSON array', () => {
    const result = parseRpeTargets('[7, 8, 9]')
    expect(result).toEqual([7, 8, 9])
  })

  it('returns empty array for null input', () => {
    expect(parseRpeTargets(null)).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseRpeTargets('not-json')).toEqual([])
  })
})

describe('serialiseRpeTargets', () => {
  it('serialises an array to JSON', () => {
    expect(serialiseRpeTargets([7, 8, 9])).toBe('[7,8,9]')
  })

  it('returns null for empty array', () => {
    expect(serialiseRpeTargets([])).toBeNull()
  })
})

describe('parseTempo', () => {
  it('parses a valid 4-part tempo string', () => {
    const result = parseTempo('3-1-2-0')
    expect(result).toEqual({ ecc: 3, pause: 1, con: 2, top: 0 })
  })

  it('returns null for null input', () => {
    expect(parseTempo(null)).toBeNull()
  })

  it('returns null for invalid format', () => {
    expect(parseTempo('3-1-2')).toBeNull()
    expect(parseTempo('not-tempo')).toBeNull()
  })

  it('handles X (explosive) as 0', () => {
    const result = parseTempo('3-0-X-0')
    expect(result).toEqual({ ecc: 3, pause: 0, con: 0, top: 0 })
  })
})

describe('formatTempo', () => {
  it('formats a tempo string nicely', () => {
    expect(formatTempo('3-1-2-0')).toBe('3-1-2-0')
  })

  it('returns null for null input', () => {
    expect(formatTempo(null)).toBeNull()
  })
})

describe('parseAutoregulation', () => {
  it('parses a valid JSON rule', () => {
    const json = JSON.stringify({
      metric: 'e1rm',
      threshold: 3,
      action: 'increase_weight',
      amount: 2.5,
    })
    const result = parseAutoregulation(json)
    expect(result?.metric).toBe('e1rm')
    expect(result?.action).toBe('increase_weight')
    expect(result?.amount).toBe(2.5)
  })

  it('returns null for null input', () => {
    expect(parseAutoregulation(null)).toBeNull()
  })
})

describe('serialiseAutoregulation', () => {
  it('serialises a rule to JSON', () => {
    const rule: AutoregulationRule = {
      metric: 'reps',
      threshold: 2,
      action: 'increase_reps',
      amount: 1,
    }
    const result = serialiseAutoregulation(rule)
    expect(JSON.parse(result)).toMatchObject(rule)
  })
})

describe('parseSubstitutes', () => {
  it('parses a JSON array of IDs', () => {
    expect(parseSubstitutes('["ex-1","ex-2"]')).toEqual(['ex-1', 'ex-2'])
  })

  it('returns empty array for null', () => {
    expect(parseSubstitutes(null)).toEqual([])
  })
})
