export interface TemplateStats {
  lastUsedAt: string | null
  useCount: number
  avgDurationSec: number | null
  prCount: number
  consistencyScore: number
  estimatedDurationSec: number
}

export interface StartOptions {
  scaleFactor?: number // 0.5–1.5
  excludedExerciseIds?: string[]
  swappedExercises?: Record<string, string> // templateExerciseId → new exerciseId
}

/**
 * Calculate consistency score (0–100) based on session dates within a window.
 * Expected = 1 session per 7 days within the window.
 */
export function calculateConsistency(dates: string[], windowDays: number, refDate: Date): number {
  const cutoff = new Date(refDate)
  cutoff.setDate(cutoff.getDate() - windowDays)

  const sessionsInWindow = dates.filter((d) => new Date(d) >= cutoff && new Date(d) <= refDate)
  const expectedSessions = windowDays / 7
  if (expectedSessions === 0) return 0

  const score = (sessionsInWindow.length / expectedSessions) * 100
  return Math.min(100, Math.round(score))
}

/**
 * Estimate template duration in seconds.
 * Formula: (totalSets × 45s) + (totalSets × avgRestSec) + warmup buffer
 */
export function estimateTemplateDuration(
  exerciseCount: number,
  totalSets: number,
  avgRestSec: number,
): number {
  if (totalSets === 0) return 0
  const work = totalSets * 45
  const rest = totalSets * avgRestSec
  const warmup = exerciseCount > 0 ? 300 : 0 // 5 min warmup buffer
  return work + rest + warmup
}

/**
 * Scale a weight to a given factor, rounding to nearest 2.5kg.
 */
export function scaleWeight(weight: number, factor: number): number {
  const scaled = weight * factor
  return Math.round(scaled / 2.5) * 2.5
}

/**
 * Apply start options to a list of exercises (filter excluded, scale weights, swap exercises).
 */
export function applyStartOptions<
  T extends { id: string; exercise_id: string; rpe_target: number | null },
>(exercises: T[], opts: StartOptions): T[] {
  let result = [...exercises]

  if (opts.excludedExerciseIds?.length) {
    result = result.filter((ex) => !opts.excludedExerciseIds?.includes(ex.id))
  }

  if (opts.swappedExercises) {
    result = result.map((ex) => {
      const newId = opts.swappedExercises?.[ex.id]
      if (newId) return { ...ex, exercise_id: newId }
      return ex
    })
  }

  return result
}
