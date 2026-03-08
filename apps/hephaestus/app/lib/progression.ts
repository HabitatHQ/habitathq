import type { SetRow } from '~/types/database'

/**
 * Suggest a weight progression based on average working RPE vs target.
 *
 * Returns `lastWeight + incrementKg` when the athlete has room to progress
 * (avg RPE < targetRpe - 1.0), otherwise returns null.
 *
 * Only completed working sets with RPE data are considered.
 */
export function suggestProgression(
  sets: SetRow[],
  targetRpe: number,
  lastWeight: number,
  incrementKg: number,
): number | null {
  const workingSets = sets.filter((s) => s.is_warmup === 0 && s.completed === 1 && s.rpe !== null)

  if (workingSets.length === 0) return null

  const avgRpe = workingSets.reduce((sum, s) => sum + (s.rpe ?? 0), 0) / workingSets.length

  if (avgRpe < targetRpe - 1.0) {
    return lastWeight + incrementKg
  }

  return null
}
