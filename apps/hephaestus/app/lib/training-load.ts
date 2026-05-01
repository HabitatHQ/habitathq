import type { SetRow } from '~/types/database'

/**
 * Calculate total volume (tonnage) for a set of working sets.
 * Volume = sum of (weight_kg × reps) for non-warmup sets.
 */
export function calculateVolume(sets: SetRow[]): number {
  return sets
    .filter((s) => s.is_warmup === 0)
    .reduce((total, s) => total + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)
}

/**
 * Calculate acute training load: average of weekly volumes over the last week.
 * For simplicity, returns the mean of all provided values (caller supplies a
 * sliding 7-day window as weekly volumes).
 */
export function calculateAcuteLoad(weeklyVolumes: number[]): number {
  if (weeklyVolumes.length === 0) return 0
  // Caller provides a 7-day sliding window of daily/weekly volumes; we average them.
  return weeklyVolumes.reduce((sum, v) => sum + v, 0) / weeklyVolumes.length
}

/**
 * Calculate chronic training load: 28-day rolling average (last 4 weeks).
 */
export function calculateChronicLoad(weeklyVolumes: number[]): number {
  if (weeklyVolumes.length === 0) return 0
  const last4 = weeklyVolumes.slice(-4)
  return last4.reduce((sum, v) => sum + v, 0) / last4.length
}

/**
 * Compute the Acute:Chronic Workload Ratio.
 * Values:
 *   < 0.8  → undertrained / deload
 *   0.8–1.3 → optimal (green zone)
 *   > 1.3  → overreaching risk (red zone)
 *
 * Returns 0 when chronic load is zero (avoid division by zero).
 */
export function getLoadRatio(acute: number, chronic: number): number {
  if (chronic === 0) return 0
  return acute / chronic
}
