import type { TemplateRow } from '~/types/database'

const PUSH_MOVEMENTS = new Set(['press'])
const PULL_MOVEMENTS = new Set(['row'])

export interface MuscleBalance {
  push: number
  pull: number
}

export interface SimilarTemplate {
  id: string
  name: string
  similarity: number
}

/**
 * Find templates not used within the given threshold (in days).
 */
export function findNeglectedTemplates(
  templates: TemplateRow[],
  thresholdDays: number,
  refDate: Date,
): TemplateRow[] {
  const cutoff = new Date(refDate)
  cutoff.setDate(cutoff.getDate() - thresholdDays)

  return templates.filter((t) => {
    if (!t.last_used_at) return true
    return new Date(t.last_used_at) < cutoff
  })
}

/**
 * Calculate push/pull muscle balance based on exercise movements.
 */
export function calculateMuscleBalance(
  exercises: Array<{ muscles_primary: string; movement: string }>,
): MuscleBalance {
  let push = 0
  let pull = 0

  for (const ex of exercises) {
    if (PUSH_MOVEMENTS.has(ex.movement)) {
      try {
        const muscles = JSON.parse(ex.muscles_primary) as string[]
        push += muscles.length
      } catch {
        push += 1
      }
    } else if (PULL_MOVEMENTS.has(ex.movement)) {
      try {
        const muscles = JSON.parse(ex.muscles_primary) as string[]
        pull += muscles.length
      } catch {
        pull += 1
      }
    }
  }

  return { push, pull }
}

/**
 * Find similar templates using Jaccard similarity on exercise ID sets.
 */
export function findSimilarTemplates(
  targetExerciseIds: string[],
  candidates: Array<{ id: string; exerciseIds: string[] }>,
  threshold = 0.5,
): SimilarTemplate[] {
  const targetSet = new Set(targetExerciseIds)
  const results: SimilarTemplate[] = []

  for (const candidate of candidates) {
    const candidateSet = new Set(candidate.exerciseIds)
    const intersection = [...targetSet].filter((id) => candidateSet.has(id)).length
    const union = new Set([...targetSet, ...candidateSet]).size
    if (union === 0) continue
    const similarity = intersection / union
    if (similarity >= threshold) {
      results.push({ id: candidate.id, name: candidate.id, similarity })
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity)
}

/**
 * Check muscle balance and return a warning message if push >> pull.
 * Returns null if balanced.
 */
export function checkMuscleBalance(
  exercises: Array<{ muscles_primary: string; movement: string }>,
): string | null {
  const balance = calculateMuscleBalance(exercises)
  if (balance.push === 0 && balance.pull === 0) return null

  const ratio = balance.pull > 0 ? balance.push / balance.pull : Number.POSITIVE_INFINITY
  if (ratio > 1.5) {
    return 'This template is push-heavy. Consider adding a row or pull-up.'
  }
  if (balance.pull > 0 && balance.push / balance.pull < 0.667) {
    return 'This template is pull-heavy. Consider adding a press movement.'
  }
  return null
}
