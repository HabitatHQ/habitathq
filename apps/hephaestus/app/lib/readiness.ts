/**
 * Readiness score calculator.
 * Combines ACWR, days since last workout, and recent mood to produce a 0-100 score.
 */

export interface ReadinessResult {
  score: number
  label: 'High' | 'Moderate' | 'Low' | 'Detraining'
  description: string
}

/**
 * Calculate a readiness score 0-100.
 * @param acwr - Acute:Chronic Workload Ratio (0 = no data)
 * @param daysSinceLastWorkout - Days since last session (0 = today)
 * @param recentMoodAvg - Average mood 1-5 over recent sessions, or null if no data
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: readiness scoring has many threshold branches by design
export function calculateReadiness(
  acwr: number,
  daysSinceLastWorkout: number,
  recentMoodAvg: number | null,
): ReadinessResult {
  // No data case
  if (acwr === 0 && daysSinceLastWorkout === 0) {
    return {
      score: 0,
      label: 'Moderate',
      description: 'No training history yet — start your first workout!',
    }
  }

  // Base score from ACWR
  let score = 70

  // ACWR contribution (optimal 0.8-1.3 → bonus, extremes → penalty)
  if (acwr === 0) {
    // No data — neutral
  } else if (acwr < 0.6) {
    score -= 20 // Severely undertrained / detraining
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

  if (daysSinceLastWorkout > 7 || (acwr > 0 && acwr < 0.5)) {
    label = 'Detraining'
    description = 'Extended rest detected — ease back in with lighter loads.'
  } else if (acwr > 1.5) {
    label = 'Low'
    description = 'High training load — consider a deload or extra recovery.'
  } else if (score >= 75) {
    label = 'High'
    description = 'Training load is optimal. Good time to push hard.'
  } else if (score >= 45) {
    label = 'Moderate'
    description = 'Moderate readiness — train as planned but listen to your body.'
  } else {
    label = 'Low'
    description = 'Signs of fatigue or high load — consider a lighter session.'
  }

  return { score, label, description }
}
