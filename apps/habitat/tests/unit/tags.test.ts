import { describe, it, expect } from 'vitest'
import { isReservedTag, filterReservedTags, RESERVED_TAG_PREFIX } from '~/utils/tags'

describe('isReservedTag', () => {
  it('returns true for habitat- prefixed tags', () => {
    expect(isReservedTag('habitat-health')).toBe(true)
    expect(isReservedTag('habitat-steps')).toBe(true)
    expect(isReservedTag('habitat-voice-transcript')).toBe(true)
  })

  it('returns false for regular tags', () => {
    expect(isReservedTag('health')).toBe(false)
    expect(isReservedTag('work')).toBe(false)
    expect(isReservedTag('')).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(isReservedTag('Habitat-health')).toBe(false)
    expect(isReservedTag('HABITAT-health')).toBe(false)
  })
})

describe('filterReservedTags', () => {
  it('removes habitat- prefixed tags from the array', () => {
    expect(filterReservedTags(['work', 'habitat-health', 'exercise'])).toEqual(['work', 'exercise'])
  })

  it('returns empty array when all tags are reserved', () => {
    expect(filterReservedTags(['habitat-a', 'habitat-b'])).toEqual([])
  })

  it('returns same tags when none are reserved', () => {
    expect(filterReservedTags(['work', 'play'])).toEqual(['work', 'play'])
  })
})

describe('RESERVED_TAG_PREFIX', () => {
  it('is habitat-', () => {
    expect(RESERVED_TAG_PREFIX).toBe('habitat-')
  })
})
