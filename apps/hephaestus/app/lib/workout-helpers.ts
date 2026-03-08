import type { SetRow } from '~/types/database'
import { calculateVolume } from './training-load'

/**
 * Filter to only completed working (non-warmup) sets.
 */
export function getWorkingSets(sets: SetRow[]): SetRow[] {
  return sets.filter((s) => s.is_warmup === 0 && s.completed === 1)
}

/**
 * Calculate total volume (kg × reps) for all working sets across an entire workout.
 */
export function calculateWorkoutVolume(sets: SetRow[]): number {
  return calculateVolume(sets)
}

/**
 * Build a new pending set pre-filled from the last completed set.
 */
export function buildPendingSet(
  workoutExerciseId: string,
  lastSet: SetRow | null,
  setNum: number,
): SetRow {
  return {
    id: crypto.randomUUID(),
    workout_exercise_id: workoutExerciseId,
    set_num: setNum,
    is_warmup: 0,
    weight_kg: lastSet?.weight_kg ?? null,
    reps: lastSet?.reps ?? null,
    rpe: null,
    rir: null,
    notes: null,
    completed: 0,
    logged_at: null,
  }
}

/**
 * Check if all sets in a workout are completed (or there are none).
 */
export function isWorkoutComplete(sets: SetRow[]): boolean {
  return sets.every((s) => s.completed === 1)
}

/**
 * Merge a partial set with defaults to produce a full SetRow (not yet persisted).
 */
export function applySetDefaults(
  workoutExerciseId: string,
  partial: Partial<SetRow>,
  setNum: number,
): SetRow {
  return {
    id: crypto.randomUUID(),
    workout_exercise_id: workoutExerciseId,
    set_num: setNum,
    is_warmup: 0,
    weight_kg: null,
    reps: null,
    rpe: null,
    rir: null,
    notes: null,
    completed: 0,
    logged_at: null,
    ...partial,
  }
}
