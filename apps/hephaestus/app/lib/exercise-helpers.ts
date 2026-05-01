import type { Equipment, ExerciseRow, MovementPattern } from '~/types/database'

export interface ExerciseFilter {
  equipment?: Equipment
  movement?: MovementPattern
  isCustom?: boolean
}

/**
 * Free-text search across exercise name and slug (case-insensitive).
 */
export function searchExercises(exercises: ExerciseRow[], query: string): ExerciseRow[] {
  if (!query.trim()) return exercises
  const q = query.toLowerCase()
  return exercises.filter(
    (e) => e.name.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q),
  )
}

/**
 * Filter exercises by equipment, movement pattern, or custom flag.
 * All provided filters must match (AND semantics).
 */
export function filterExercises(exercises: ExerciseRow[], filter: ExerciseFilter): ExerciseRow[] {
  return exercises.filter((e) => {
    if (filter.equipment !== undefined && e.equipment !== filter.equipment) return false
    if (filter.movement !== undefined && e.movement !== filter.movement) return false
    if (filter.isCustom !== undefined && Boolean(e.is_custom) !== filter.isCustom) return false
    return true
  })
}

type SortMode = 'name' | 'custom-last'

/**
 * Sort exercises. 'custom-last' sorts built-in first, then custom, both alphabetically.
 */
export function sortExercises(exercises: ExerciseRow[], mode: SortMode = 'name'): ExerciseRow[] {
  return [...exercises].sort((a, b) => {
    if (mode === 'custom-last') {
      if (a.is_custom !== b.is_custom) return a.is_custom - b.is_custom
    }
    return a.name.localeCompare(b.name)
  })
}
