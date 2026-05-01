import { describe, expect, it } from 'vitest'
import { describeFailureType, needsExtraRest } from '~/lib/failure'

describe('describeFailureType', () => {
  it('returns "Muscular failure" for muscular', () => {
    expect(describeFailureType('muscular')).toBe('Muscular failure')
  })
  it('returns "Technical failure" for technical', () => {
    expect(describeFailureType('technical')).toBe('Technical failure')
  })
  it('returns "Near failure" for near_failure', () => {
    expect(describeFailureType('near_failure')).toBe('Near failure (1 rep left)')
  })
  it('returns empty string for null', () => {
    expect(describeFailureType(null)).toBe('')
  })
})

describe('needsExtraRest', () => {
  it('returns bonusSec for failure sets', () => {
    const set = { failure_flag: 1 as const } as any
    expect(needsExtraRest(set, 60)).toBe(60)
  })
  it('returns 0 for non-failure sets', () => {
    const set = { failure_flag: 0 as const } as any
    expect(needsExtraRest(set, 60)).toBe(0)
  })
})
