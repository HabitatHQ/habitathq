import type { SetRow } from '~/types/database'
import { calculateVolume } from './training-load'

/** Shared null-defaults for optional SetRow fields added in schema v2/v4. */
const SET_FIELD_DEFAULTS = {
  rpe: null,
  rir: null,
  notes: null,
  completed: 0 as const,
  logged_at: null,
  distance_m: null,
  duration_sec: null,
  speed_kmh: null,
  level: null,
  technique_flag: null,
  body_feel: null,
  failure_flag: 0 as const,
  failure_type: null,
  partial_reps: null,
}

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
    is_warmup: 0 as const,
    weight_kg: lastSet?.weight_kg ?? null,
    reps: lastSet?.reps ?? null,
    ...SET_FIELD_DEFAULTS,
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
    is_warmup: 0 as const,
    weight_kg: null,
    reps: null,
    ...SET_FIELD_DEFAULTS,
    ...partial,
  }
}
