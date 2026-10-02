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

  it('uses only the latest completed week as acute load', () => {
    expect(calculateAcuteLoad([800, 900, 1000])).toBe(1000)
  })

  it('returns 0 for empty array', () => {
    expect(calculateAcuteLoad([])).toBe(0)
  })
})

describe('calculateChronicLoad', () => {
  it('compares the current week against up to four preceding weeks', () => {
    expect(calculateChronicLoad([800, 900, 1000, 1100])).toBe(900)
    expect(calculateChronicLoad([500, 600, 800, 900, 1000, 1100])).toBe(825)
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

  it('is exactly 0.8 at the detraining boundary', () => {
    expect(getLoadRatio(800, 1000)).toBeCloseTo(0.8, 5)
  })

  it('is exactly 1.3 at the overreaching boundary', () => {
    expect(getLoadRatio(1300, 1000)).toBeCloseTo(1.3, 5)
  })
})

describe('calculateVolume (additional)', () => {
  it('returns 0 when all sets are warmups', () => {
    const warmupSets = [makeSet(100, 5, 1), makeSet(80, 8, 1), makeSet(60, 10, 1)]
    expect(calculateVolume(warmupSets)).toBe(0)
  })

  it('handles mix of null reps in a single set', () => {
    const sets: SetRow[] = [
      {
        id: '2',
        workout_exercise_id: 'we-1',
        set_num: 1,
        is_warmup: 0,
        weight_kg: 100,
        reps: null,
        rpe: null,
        rir: null,
        notes: null,
        completed: 1,
        logged_at: null,
      },
      makeSet(80, 5),
    ]
    // null reps → 0 contribution; 80 × 5 = 400
    expect(calculateVolume(sets)).toBe(400)
  })
})

describe('calculateAcuteLoad (additional)', () => {
  it('returns 0 when all volumes are zero', () => {
    expect(calculateAcuteLoad([0, 0, 0])).toBe(0)
  })

  it('handles single large value', () => {
    expect(calculateAcuteLoad([5000])).toBe(5000)
  })
})
