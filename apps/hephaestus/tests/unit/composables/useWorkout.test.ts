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

  it('applies null defaults for rpe, rir, notes when not provided', () => {
    const result = applySetDefaults('we-1', {}, 1)
    expect(result.rpe).toBeNull()
    expect(result.rir).toBeNull()
    expect(result.notes).toBeNull()
    expect(result.weight_kg).toBeNull()
    expect(result.reps).toBeNull()
  })

  it('allows overriding rpe and rir', () => {
    const result = applySetDefaults('we-1', { rpe: 8, rir: 2 }, 2)
    expect(result.rpe).toBe(8)
    expect(result.rir).toBe(2)
    expect(result.set_num).toBe(2)
  })

  it('generates a unique id for each call', () => {
    const r1 = applySetDefaults('we-1', {}, 1)
    const r2 = applySetDefaults('we-1', {}, 1)
    expect(r1.id).not.toBe(r2.id)
  })
})

describe('getWorkingSets (additional)', () => {
  it('returns empty when all sets are completed warmups', () => {
    const sets = [makeSet({ is_warmup: 1, completed: 1 }), makeSet({ is_warmup: 1, completed: 1 })]
    expect(getWorkingSets(sets)).toHaveLength(0)
  })

  it('returns empty for empty input', () => {
    expect(getWorkingSets([])).toHaveLength(0)
  })
})

describe('calculateWorkoutVolume (additional)', () => {
  it('returns 0 when all sets are warmups', () => {
    const sets = [
      makeSet({ is_warmup: 1, weight_kg: 60, reps: 10 }),
      makeSet({ is_warmup: 1, weight_kg: 80, reps: 5 }),
    ]
    expect(calculateWorkoutVolume(sets)).toBe(0)
  })
})

describe('buildPendingSet (additional)', () => {
  it('always creates a non-warmup pending set regardless of last set type', () => {
    // Even if last set was a warmup, the new pending set should be working
    const warmupLast = makeSet({ is_warmup: 1, weight_kg: 60, reps: 10 })
    const next = buildPendingSet('we-1', warmupLast, 2)
    expect(next.is_warmup).toBe(0)
    expect(next.completed).toBe(0)
  })

  it('pre-fills weight and reps from last set', () => {
    const last = makeSet({ weight_kg: 120, reps: 3 })
    const next = buildPendingSet('we-1', last, 4)
    expect(next.weight_kg).toBe(120)
    expect(next.reps).toBe(3)
  })

  it('always clears rpe and notes (fresh fields for each set)', () => {
    const last = makeSet({ rpe: 9, notes: 'felt hard' })
    const next = buildPendingSet('we-1', last, 2)
    expect(next.rpe).toBeNull()
    expect(next.notes).toBeNull()
  })
})

describe('isWorkoutComplete (additional)', () => {
  it('returns false when all sets are pending', () => {
    const sets = [makeSet({ completed: 0 }), makeSet({ completed: 0 })]
    expect(isWorkoutComplete(sets)).toBe(false)
  })
})
