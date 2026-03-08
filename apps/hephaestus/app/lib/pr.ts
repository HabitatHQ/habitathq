import type { PersonalRecordRow, RecordType, SetRow } from '~/types/database'
import { calculateE1RM } from './e1rm'

/**
 * Detect new personal records from a completed set of working sets.
 *
 * Compares the best values from `sets` against `existingPRs`.
 * Returns only the records that ARE new PRs (i.e. beat the existing best).
 * Caller should upsert these into the personal_records table.
 */
export function detectPRs(
  existingPRs: PersonalRecordRow[],
  sets: SetRow[],
  exerciseId: string,
  date: string,
): PersonalRecordRow[] {
  const workingSets = sets.filter((s) => s.is_warmup === 0 && s.completed === 1)
  if (workingSets.length === 0) return []

  function existingBest(type: RecordType): number {
    return existingPRs
      .filter((p) => p.record_type === type)
      .reduce((max, p) => Math.max(max, p.value), 0)
  }

  const newPRs: PersonalRecordRow[] = []

  // Weight PR: heaviest single set
  const bestWeightSet = workingSets.reduce(
    (best, s) => ((s.weight_kg ?? 0) > (best.weight_kg ?? 0) ? s : best),
    workingSets[0] as SetRow,
  )
  const bestWeight = bestWeightSet.weight_kg ?? 0
  if (bestWeight > existingBest('weight')) {
    newPRs.push({
      id: crypto.randomUUID(),
      exercise_id: exerciseId,
      record_type: 'weight',
      value: bestWeight,
      set_id: bestWeightSet.id,
      date,
    })
  }

  // Reps PR: most reps in a single set (any weight)
  const bestRepsSet = workingSets.reduce(
    (best, s) => ((s.reps ?? 0) > (best.reps ?? 0) ? s : best),
    workingSets[0] as SetRow,
  )
  const bestReps = bestRepsSet.reps ?? 0
  if (bestReps > existingBest('reps')) {
    newPRs.push({
      id: crypto.randomUUID(),
      exercise_id: exerciseId,
      record_type: 'reps',
      value: bestReps,
      set_id: bestRepsSet.id,
      date,
    })
  }

  // e1RM PR: best estimated 1RM across all sets
  let bestE1rmSet: SetRow | null = null
  let bestE1rm = 0
  for (const s of workingSets) {
    if (s.weight_kg !== null && s.reps !== null) {
      const e1rm = calculateE1RM(s.weight_kg, s.reps)
      if (e1rm > bestE1rm) {
        bestE1rm = e1rm
        bestE1rmSet = s
      }
    }
  }
  if (bestE1rmSet !== null && bestE1rm > existingBest('e1rm')) {
    newPRs.push({
      id: crypto.randomUUID(),
      exercise_id: exerciseId,
      record_type: 'e1rm',
      value: bestE1rm,
      set_id: bestE1rmSet.id,
      date,
    })
  }

  return newPRs
}
