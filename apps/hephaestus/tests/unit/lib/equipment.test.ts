import { describe, expect, it } from 'vitest'
import type { EquipmentProfile } from '~/lib/equipment'
import { fromKilograms, roundToAvailableLoad, toKilograms } from '~/lib/equipment'

const profile: Pick<
  EquipmentProfile,
  'minimum_kg' | 'increment_kg' | 'maximum_kg' | 'additional_loads_kg'
> = {
  minimum_kg: 2.5,
  increment_kg: 2.5,
  maximum_kg: 20,
  additional_loads_kg: '[3.5, 7.5, 25]',
}

describe('equipment load suggestions', () => {
  it('selects the nearest configured increment or additional load without exceeding maximum', () => {
    expect(roundToAvailableLoad(3.4, profile)).toBe(3.5)
    expect(roundToAvailableLoad(6.3, profile)).toBe(7.5)
    expect(roundToAvailableLoad(19.5, profile)).toBe(20)
    expect(roundToAvailableLoad(30, profile)).toBe(20)
  })

  it('breaks ties toward a lighter available load', () => {
    expect(roundToAvailableLoad(6.25, profile)).toBe(5)
  })

  it('converts display units without changing canonical kilograms', () => {
    const displayed = fromKilograms(100, 'lbs')
    expect(toKilograms(displayed, 'lbs')).toBeCloseTo(100, 10)
  })
})
