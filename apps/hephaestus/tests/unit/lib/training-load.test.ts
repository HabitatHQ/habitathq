import { describe, expect, it } from 'vitest'
import {
  calculateAcuteLoad,
  calculateChronicLoad,
  calculateVolume,
  getLoadRatio,
} from '~/lib/training-load'
import type { SetRow } from '~/types/database'

function makeSet(weightKg: number, reps: number, isWarmup: 0 | 1 = 0): SetRow {
  return {
    id: crypto.randomUUID(),
    workout_exercise_id: 'we-1',
    set_num: 1,
    is_warmup: isWarmup,
    weight_kg: weightKg,
    reps,
    rpe: null,
    rir: null,
    notes: null,
    completed: 1,
    logged_at: null,
  }
}

describe('calculateVolume', () => {
  it('sums weight × reps for all working sets', () => {
    const sets = [makeSet(100, 5), makeSet(100, 5), makeSet(100, 5)]
    expect(calculateVolume(sets)).toBe(1500)
  })

  it('excludes warmup sets', () => {
    const sets = [makeSet(60, 10, 1), makeSet(100, 5)]
    expect(calculateVolume(sets)).toBe(500)
  })

  it('returns 0 for empty sets', () => {
    expect(calculateVolume([])).toBe(0)
  })

  it('handles null weight or reps gracefully', () => {
    const sets: SetRow[] = [
      {
        id: '1',
        workout_exercise_id: 'we-1',
        set_num: 1,
        is_warmup: 0,
        weight_kg: null,
        reps: 5,
        rpe: null,
        rir: null,
        notes: null,
        completed: 1,
        logged_at: null,
      },
      makeSet(100, 3),
    ]
    expect(calculateVolume(sets)).toBe(300)
  })
})

describe('calculateAcuteLoad', () => {
  it('returns average of last 1 week (last element) for single-item array', () => {
    expect(calculateAcuteLoad([1000])).toBe(1000)
  })

  it('returns the most recent week volume (acute = 7-day)', () => {
    // Acute load is the last week's volume (normalized rolling)
    expect(calculateAcuteLoad([800, 900, 1000])).toBeCloseTo(900, 0)
  })

  it('returns 0 for empty array', () => {
    expect(calculateAcuteLoad([])).toBe(0)
  })
})

describe('calculateChronicLoad', () => {
  it('returns average of last 4 weeks', () => {
    const weeks = [800, 900, 1000, 1100]
    // average = 950
    expect(calculateChronicLoad(weeks)).toBeCloseTo(950, 0)
  })

  it('uses only last 4 weeks if more data provided', () => {
    const weeks = [500, 600, 800, 900, 1000, 1100]
    // last 4: 800, 900, 1000, 1100 → avg 950
    expect(calculateChronicLoad(weeks)).toBeCloseTo(950, 0)
  })

  it('returns 0 for empty array', () => {
    expect(calculateChronicLoad([])).toBe(0)
  })
})

describe('getLoadRatio', () => {
  it('returns ratio of acute to chronic', () => {
    expect(getLoadRatio(1000, 1000)).toBeCloseTo(1.0, 5)
  })

  it('returns 0 when chronic load is 0', () => {
    expect(getLoadRatio(1000, 0)).toBe(0)
  })

  it('identifies overreaching zone (>1.3)', () => {
    expect(getLoadRatio(1400, 1000)).toBeCloseTo(1.4, 1)
  })

  it('identifies optimal zone (0.85–1.3)', () => {
    const ratio = getLoadRatio(950, 1000)
    expect(ratio).toBeGreaterThan(0.8)
    expect(ratio).toBeLessThan(1.3)
  })
})
