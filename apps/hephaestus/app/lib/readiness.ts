/** Readiness is a rough estimate and is never medical advice. */

export interface ReadinessResult {
  score: number | null
  label: 'High' | 'Moderate' | 'Low' | 'Unavailable'
  description: string
  isEstimate: true
}

/** These are heuristic estimates, not medical or authoritative training advice. */
export function calculateReadiness(
  acwr: number,
  daysSinceLastWorkout: number,
  recentMoodAvg: number | null,
): ReadinessResult {
  if (acwr === 0) {
    return {
      score: null,
      label: 'Unavailable',
      description: 'Not enough completed lifting-load history for an estimate yet.',
      isEstimate: true,
    }
  }

  // Base score from ACWR
  let score = 70

  // ACWR contribution (optimal 0.8-1.3 → bonus, extremes → penalty)
  if (acwr < 0.6) {
    score -= 20
  } else if (acwr < 0.8) {
    score -= 5 // Slightly undertrained
  } else if (acwr <= 1.3) {
    score += 15 // Sweet spot
  } else if (acwr <= 1.5) {
    score -= 10 // Mild overreach
  } else {
    score -= 30 // High overreach risk
  }

  // Rest day contribution
  if (daysSinceLastWorkout === 1) {
    score += 5 // Well rested
  } else if (daysSinceLastWorkout >= 3 && daysSinceLastWorkout <= 5) {
    score -= 5 // Some detraining
  } else if (daysSinceLastWorkout > 5) {
    score -= 15 // Detraining
  }

  // Mood contribution
  if (recentMoodAvg !== null) {
    if (recentMoodAvg >= 4) {
      score += 10
    } else if (recentMoodAvg <= 2) {
      score -= 10
    }
  }

  score = Math.max(0, Math.min(100, score))

  let label: ReadinessResult['label']
  let description: string

  if (acwr > 1.5) {
    label = 'Low'
    description = 'Estimated recent load is elevated; use your own recovery judgment.'
  } else if (score >= 75) {
    label = 'High'
    description =
      'Estimated load and recent check-in suggest a lighter relative load; this is not a prescription.'
  } else if (score >= 45) {
    label = 'Moderate'
    description = 'Heuristic estimate only; consider your own recovery and how you feel.'
  } else {
    label = 'Low'
    description = 'Heuristic estimate only; consider your own recovery and how you feel.'
  }

  return { score, label, description, isEstimate: true }
}
