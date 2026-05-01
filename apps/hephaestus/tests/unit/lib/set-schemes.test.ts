import { describe, expect, it } from 'vitest'
import {
  generateDropSetPlan,
  generatePyramidPlan,
  parseSetScheme,
  serialiseSetScheme,
  warmupWeightSuggestions,
} from '~/lib/set-schemes'
import type { DropSetConfig, PyramidConfig, SetSchemeConfig } from '~/types/database'

describe('parseSetScheme', () => {
  it('returns straight scheme for null input', () => {
    expect(parseSetScheme(null)).toEqual({ type: 'straight' })
  })
  it('parses drop_set JSON', () => {
    const config: SetSchemeConfig = {
      type: 'drop_set',
      config: { drops: 2, dropType: 'percent', dropValue: 20 },
    }
    expect(parseSetScheme(JSON.stringify(config))).toEqual(config)
  })
  it('returns straight for invalid JSON', () => {
    expect(parseSetScheme('not-json')).toEqual({ type: 'straight' })
  })
})

describe('serialiseSetScheme', () => {
  it('serialises a drop_set config', () => {
    const config: SetSchemeConfig = {
      type: 'drop_set',
      config: { drops: 1, dropType: 'absolute', dropValue: 10 },
    }
    expect(JSON.parse(serialiseSetScheme(config))).toEqual(config)
  })
})

describe('generateDropSetPlan', () => {
  it('generates correct drop weights for percent drops', () => {
    const config: DropSetConfig = { drops: 2, dropType: 'percent', dropValue: 20 }
    const plan = generateDropSetPlan(100, config)
    // main set 100kg + 2 drops: 100*0.8=80, 80*0.8=64 (rounded to nearest 2.5)
    expect(plan).toHaveLength(3) // main + 2 drops
    expect(plan[0]?.weight).toBe(100)
    expect(plan[1]?.weight).toBeCloseTo(80, 0)
    expect(plan[2]?.weight).toBeCloseTo(65, 0) // 64 rounded to 65 (nearest 2.5)
  })
  it('generates correct drop weights for absolute drops', () => {
    const config: DropSetConfig = { drops: 2, dropType: 'absolute', dropValue: 10 }
    const plan = generateDropSetPlan(100, config)
    expect(plan).toHaveLength(3)
    expect(plan[0]?.weight).toBe(100)
    expect(plan[1]?.weight).toBe(90)
    expect(plan[2]?.weight).toBe(80)
  })
  it('never drops below 0kg', () => {
    const config: DropSetConfig = { drops: 3, dropType: 'absolute', dropValue: 50 }
    const plan = generateDropSetPlan(80, config)
    for (const step of plan) {
      expect(step.weight).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('generatePyramidPlan', () => {
  it('generates ascending pyramid plan', () => {
    const config: PyramidConfig = {
      type: 'ascending',
      steps: 4,
      startWeight: 60,
      weightStep: 10,
      stepType: 'absolute',
      repsPerStep: [12, 10, 8, 6],
      restPerStep: [90, 120, 120, 180],
    }
    const plan = generatePyramidPlan(config)
    expect(plan).toHaveLength(4)
    expect(plan[0]).toEqual({ weight: 60, reps: 12, rest: 90 })
    expect(plan[1]).toEqual({ weight: 70, reps: 10, rest: 120 })
    expect(plan[2]).toEqual({ weight: 80, reps: 8, rest: 120 })
    expect(plan[3]).toEqual({ weight: 90, reps: 6, rest: 180 })
  })
  it('generates descending pyramid plan', () => {
    const config: PyramidConfig = {
      type: 'descending',
      steps: 3,
      startWeight: 100,
      weightStep: 15,
      stepType: 'absolute',
      repsPerStep: [5, 8, 12],
      restPerStep: [180, 120, 90],
    }
    const plan = generatePyramidPlan(config)
    expect(plan).toHaveLength(3)
    expect(plan[0]?.weight).toBe(100)
    expect(plan[1]?.weight).toBe(85)
    expect(plan[2]?.weight).toBe(70)
  })
  it('generates full pyramid (up-then-down)', () => {
    const config: PyramidConfig = {
      type: 'full',
      steps: 5, // 3 up + 2 down mirror
      startWeight: 60,
      weightStep: 10,
      stepType: 'absolute',
      repsPerStep: [12, 10, 8, 10, 12],
      restPerStep: [90, 90, 120, 90, 90],
    }
    const plan = generatePyramidPlan(config)
    expect(plan).toHaveLength(5)
    expect(plan[0]?.weight).toBe(60)
    expect(plan[2]?.weight).toBe(80) // peak
    expect(plan[4]?.weight).toBe(60) // back down
  })
  it('generates rep-only pyramid (fixed weight)', () => {
    const config: PyramidConfig = {
      type: 'rep_only',
      steps: 4,
      startWeight: 80,
      weightStep: 0,
      stepType: 'absolute',
      repsPerStep: [6, 8, 10, 12],
      restPerStep: [90, 90, 90, 90],
    }
    const plan = generatePyramidPlan(config)
    expect(plan).toHaveLength(4)
    for (const step of plan) {
      expect(step.weight).toBe(80) // all same weight
    }
    expect(plan.map((s) => s.reps)).toEqual([6, 8, 10, 12])
  })
  it('generates percent-based pyramid', () => {
    const config: PyramidConfig = {
      type: 'ascending',
      steps: 3,
      startWeight: 100,
      weightStep: 10, // 10%
      stepType: 'percent',
      repsPerStep: [10, 8, 6],
      restPerStep: [90, 120, 150],
    }
    const plan = generatePyramidPlan(config)
    expect(plan[0]?.weight).toBe(100)
    expect(plan[1]?.weight).toBeCloseTo(110, 0)
    expect(plan[2]?.weight).toBeCloseTo(121, 0) // 110 * 1.1
  })
})

describe('warmupWeightSuggestions', () => {
  it('returns percentages of working weight', () => {
    const result = warmupWeightSuggestions(100, [40, 60, 80])
    expect(result).toEqual([40, 60, 80])
  })
  it('rounds to nearest 2.5kg', () => {
    const result = warmupWeightSuggestions(70, [40, 60, 80])
    // 70*0.4=28 → 27.5, 70*0.6=42 → 42.5, 70*0.8=56 → 55
    expect(result[0]).toBe(27.5)
    expect(result[1]).toBe(42.5)
    expect(result[2]).toBe(55)
  })
  it('never returns below 0', () => {
    const result = warmupWeightSuggestions(0, [40, 60, 80])
    for (const w of result) expect(w).toBeGreaterThanOrEqual(0)
  })
})
