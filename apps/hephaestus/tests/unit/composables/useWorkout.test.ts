import { describe, expect, it } from 'vitest'
import {
  applySetDefaults,
  buildPendingSet,
  calculateWorkoutVolume,
  getWorkingSets,
  isWorkoutComplete,
} from '~/lib/workout-helpers'
import type { SetRow } from '~/types/database'

// These helper functions contain the pure logic extracted from useWorkout
// so they can be tested without the full composable environment.

function makeSet(overrides: Partial<SetRow> = {}): SetRow {
  return {
    id: crypto.randomUUID(),
    workout_exercise_id: 'we-1',
    set_num: 1,
    is_warmup: 0,
    weight_kg: 80,
    reps: 8,
    rpe: null,
    rir: null,
    notes: null,
    completed: 1,
    logged_at: null,
    ...overrides,
  }
}

describe('getWorkingSets', () => {
  it('returns only completed working sets', () => {
    const sets = [
      makeSet({ is_warmup: 0, completed: 1 }),
      makeSet({ is_warmup: 1, completed: 1 }), // warmup
      makeSet({ is_warmup: 0, completed: 0 }), // pending
    ]
    expect(getWorkingSets(sets)).toHaveLength(1)
  })

  it('returns empty array when all are warmups', () => {
    const sets = [makeSet({ is_warmup: 1 }), makeSet({ is_warmup: 1 })]
    expect(getWorkingSets(sets)).toHaveLength(0)
  })
})

describe('calculateWorkoutVolume', () => {
  it('sums volume across multiple exercises', () => {
    const allSets = [
      makeSet({ weight_kg: 100, reps: 5 }), // 500
      makeSet({ weight_kg: 80, reps: 8 }), // 640
      makeSet({ weight_kg: 100, reps: 3, is_warmup: 1 }), // excluded
    ]
    expect(calculateWorkoutVolume(allSets)).toBe(1140)
  })
})

describe('buildPendingSet', () => {
  it('builds a new pending set with incremented set_num', () => {
    const last = makeSet({ set_num: 2, weight_kg: 100, reps: 8 })
    const next = buildPendingSet('we-1', last, 3)
    expect(next.set_num).toBe(3)
    expect(next.weight_kg).toBe(100) // pre-filled from last
    expect(next.reps).toBe(8)
    expect(next.completed).toBe(0)
  })

  it('builds a first set when no previous set exists', () => {
    const next = buildPendingSet('we-1', null, 1)
    expect(next.set_num).toBe(1)
    expect(next.weight_kg).toBeNull()
    expect(next.completed).toBe(0)
  })
})

describe('isWorkoutComplete', () => {
  it('returns true when all planned sets are completed', () => {
    const sets = [makeSet({ completed: 1 }), makeSet({ completed: 1 })]
    expect(isWorkoutComplete(sets)).toBe(true)
  })

  it('returns false when any set is pending', () => {
    const sets = [makeSet({ completed: 1 }), makeSet({ completed: 0 })]
    expect(isWorkoutComplete(sets)).toBe(false)
  })

  it('returns true for empty sets array (no planned sets)', () => {
    expect(isWorkoutComplete([])).toBe(true)
  })
})

describe('applySetDefaults', () => {
  it('merges partial set with defaults', () => {
    const partial = { weight_kg: 80, reps: 8 }
    const result = applySetDefaults('we-1', partial, 1)
    expect(result.workout_exercise_id).toBe('we-1')
    expect(result.set_num).toBe(1)
    expect(result.is_warmup).toBe(0)
    expect(result.completed).toBe(0)
    expect(result.weight_kg).toBe(80)
  })

  it('allows overriding warmup flag', () => {
    const result = applySetDefaults('we-1', { is_warmup: 1 }, 1)
    expect(result.is_warmup).toBe(1)
  })
})
