import { describe, expect, it } from 'vitest'
import { needsExtraRest } from '~/lib/failure'

describe('needsExtraRest', () => {
  it('returns bonusSec for failure sets', () => {
    const set = { failure_flag: 1 as const }
    expect(needsExtraRest(set, 60)).toBe(60)
  })
  it('returns 0 for non-failure sets', () => {
    const set = { failure_flag: 0 as const }
    expect(needsExtraRest(set, 60)).toBe(0)
  })
})
