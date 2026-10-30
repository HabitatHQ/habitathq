import { addCalendarDays, parseDateString } from '@habitathq/utils'
import { isoWeek } from '~/lib/format'
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

/** Acute load is the latest completed weekly value supplied by the caller. */
export function calculateAcuteLoad(weeklyVolumes: number[]): number {
  return weeklyVolumes.at(-1) ?? 0
}

/** Chronic load is the mean of up to the previous four completed weeks. */
export function calculateChronicLoad(weeklyVolumes: number[]): number {
  const previousWeeks = weeklyVolumes.slice(-5, -1)
  if (previousWeeks.length === 0) return 0
  return previousWeeks.reduce((sum, volume) => sum + volume, 0) / previousWeeks.length
}

/** Missing completed calendar weeks are rest weeks; the current partial week is excluded. */
export function completedWeekVolumes(
  today: string,
  rows: { week: string; gym_volume: number | null }[],
): number[] {
  const monday = addCalendarDays(today, -((parseDateString(today).getDay() + 6) % 7))
  const volumeByWeek = new Map(rows.map((row) => [row.week, row.gym_volume ?? 0]))
  return Array.from({ length: 5 }, (_, index) => {
    const week = isoWeek(parseDateString(addCalendarDays(monday, (index - 5) * 7)))
    return volumeByWeek.get(week) ?? 0
  })
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
