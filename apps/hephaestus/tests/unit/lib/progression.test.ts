import { describe, expect, it } from 'vitest'
import { suggestProgression } from '~/lib/progression'
import type { SetRow } from '~/types/database'

function makeSet(rpe: number, isWarmup: 0 | 1 = 0): SetRow {
  return {
    id: crypto.randomUUID(),
    workout_exercise_id: 'we-1',
    set_num: 1,
    is_warmup: isWarmup,
    weight_kg: 80,
    reps: 8,
    rpe,
    rir: null,
    notes: null,
    completed: 1,
    logged_at: null,
  }
}

describe('suggestProgression', () => {
  it('suggests +increment when avg working RPE is well below target', () => {
    // avg RPE 6.5, target 8.0 → 6.5 < 8.0 - 1.0 = 7.0 → suggest progress
    const sets = [makeSet(6.0), makeSet(7.0), makeSet(6.5)]
    const result = suggestProgression(sets, 8.0, 80, 2.5)
    expect(result).toBe(82.5)
  })

  it('returns null when avg RPE is at target', () => {
    const sets = [makeSet(8.0), makeSet(8.0), makeSet(8.5)]
    const result = suggestProgression(sets, 8.0, 80, 2.5)
    expect(result).toBeNull()
  })

  it('returns null when avg RPE exceeds target', () => {
    const sets = [makeSet(9.0), makeSet(9.5), makeSet(10.0)]
    const result = suggestProgression(sets, 8.0, 80, 2.5)
    expect(result).toBeNull()
  })

  it('ignores warmup sets in RPE average', () => {
    // warmup at RPE 4.0 should not count; only working set at RPE 8.5
    const sets = [makeSet(4.0, 1), makeSet(8.5)]
    const result = suggestProgression(sets, 8.0, 80, 2.5)
    expect(result).toBeNull()
  })

  it('returns null when no completed working sets', () => {
    const result = suggestProgression([], 8.0, 80, 2.5)
    expect(result).toBeNull()
  })

  it('returns null when no sets have RPE data', () => {
    const sets: SetRow[] = [
      {
        id: '1',
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
      },
    ]
    const result = suggestProgression(sets, 8.0, 80, 2.5)
    expect(result).toBeNull()
  })

  it('uses custom increment', () => {
    const sets = [makeSet(6.5), makeSet(6.5)]
    expect(suggestProgression(sets, 8.0, 100, 5)).toBe(105)
  })

  it('returns null when avg RPE is exactly at target - 1.0 boundary', () => {
    // avg 7.0, target 8.0 → 7.0 < 7.0 is false → no progression
    const sets = [makeSet(7.0), makeSet(7.0)]
    expect(suggestProgression(sets, 8.0, 80, 2.5)).toBeNull()
  })

  it('suggests when avg RPE is just below the boundary', () => {
    // avg 6.9, target 8.0 → 6.9 < 7.0 → progress
    const sets = [makeSet(6.8), makeSet(7.0)]
    // avg = 6.9 < 7.0 → suggests
    expect(suggestProgression(sets, 8.0, 80, 2.5)).toBe(82.5)
  })

  it('only averages sets that have RPE data (ignores null RPE)', () => {
    // One set has RPE 6.0, one has null → average of [6.0] = 6.0, well below 7.0 → progress
    const withRpe = makeSet(6.0)
    const withoutRpe: SetRow = { ...withRpe, id: crypto.randomUUID(), rpe: null }
    const result = suggestProgression([withRpe, withoutRpe], 8.0, 80, 2.5)
    expect(result).toBe(82.5) // only the RPE=6.0 set is counted
  })

  it('returns null when only warmup sets have low RPE', () => {
    // warmup with RPE 5.0 should not count; no working sets with RPE → null
    const warmup = makeSet(5.0, 1)
    expect(suggestProgression([warmup], 8.0, 80, 2.5)).toBeNull()
  })
})
