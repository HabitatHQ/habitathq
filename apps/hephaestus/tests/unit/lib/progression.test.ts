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
})
