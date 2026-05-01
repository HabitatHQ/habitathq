import { describe, expect, it } from 'vitest'
import { getRestForSet, parseSetRests, serialiseSetRests, smartDefaultRest } from '~/lib/set-rest'

describe('parseSetRests', () => {
  it('returns all defaults when json is null', () => {
    expect(parseSetRests(null, 3, 120)).toEqual([120, 120, 120])
  })

  it('fills missing entries with default', () => {
    expect(parseSetRests('[180,180]', 3, 120)).toEqual([180, 180, 120])
  })

  it('returns defaults for invalid json', () => {
    expect(parseSetRests('not-json', 2, 90)).toEqual([90, 90])
  })

  it('returns defaults for non-array json', () => {
    expect(parseSetRests('{"a":1}', 2, 90)).toEqual([90, 90])
  })

  it('uses overrides where present', () => {
    expect(parseSetRests('[60,90,180]', 3, 120)).toEqual([60, 90, 180])
  })

  it('truncates to setsPlanned', () => {
    expect(parseSetRests('[60,90,180,240]', 2, 120)).toHaveLength(2)
  })
})

describe('serialiseSetRests', () => {
  it('serialises array to json', () => {
    expect(serialiseSetRests([60, 90, 120])).toBe('[60,90,120]')
  })
})

describe('getRestForSet', () => {
  it('returns default when null', () => {
    expect(getRestForSet(null, 1, 120)).toBe(120)
  })

  it('returns override for set_num 1 (index 0)', () => {
    expect(getRestForSet('[60,90]', 1, 120)).toBe(60)
  })

  it('returns override for set_num 2 (index 1)', () => {
    expect(getRestForSet('[60,90]', 2, 120)).toBe(90)
  })

  it('falls back to default for out-of-range set_num', () => {
    expect(getRestForSet('[60]', 3, 120)).toBe(120)
  })
})

describe('smartDefaultRest', () => {
  it('returns 180 for squat', () => {
    expect(smartDefaultRest('squat')).toBe(180)
  })

  it('returns 180 for hinge', () => {
    expect(smartDefaultRest('hinge')).toBe(180)
  })

  it('returns 180 for press', () => {
    expect(smartDefaultRest('press')).toBe(180)
  })

  it('returns 180 for row', () => {
    expect(smartDefaultRest('row')).toBe(180)
  })

  it('returns 180 for carry', () => {
    expect(smartDefaultRest('carry')).toBe(180)
  })

  it('returns 90 for isolation', () => {
    expect(smartDefaultRest('isolation')).toBe(90)
  })

  it('returns 60 for cardio', () => {
    expect(smartDefaultRest('cardio')).toBe(60)
  })
})
