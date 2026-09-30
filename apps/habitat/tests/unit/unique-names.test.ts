import { describe, expect, it } from 'vitest'
import { nextAvailableName, normalizeNameKey } from '~/lib/unique-names'

describe('nextAvailableName', () => {
  it('trims names and adds a sequential suffix when needed', () => {
    const usedNames = new Set(['morning'])

    expect(nextAvailableName('  Morning  ', usedNames)).toBe('Morning (2)')
    expect(nextAvailableName('morning', usedNames)).toBe('morning (3)')
  })

  it('normalizes Unicode case consistently', () => {
    expect(normalizeNameKey('  École  ')).toBe('école')
  })
})
