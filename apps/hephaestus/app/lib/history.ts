import type { WorkoutRow } from '~/types/database'

export type SessionFilter = 'all' | 'gym' | 'run' | 'conditioning' | 'mobility' | 'other'

export const SESSION_TYPES: ReadonlyArray<{ value: SessionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'gym', label: 'Strength' },
  { value: 'run', label: 'Run' },
  { value: 'conditioning', label: 'Conditioning' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'other', label: 'Other' },
]

export function sessionLabel(
  workout: Pick<WorkoutRow, 'session_type'> & Partial<Pick<WorkoutRow, 'title'>>,
): string {
  if (workout.title?.trim()) return workout.title
  switch (workout.session_type) {
    case 'gym':
      return 'Strength session'
    case 'run':
      return 'Run'
    case 'conditioning':
      return 'Conditioning session'
    case 'mobility':
      return 'Mobility session'
    case 'other':
      return 'Other session'
  }
}

export const MOOD_RATINGS = [
  { label: 'Very low', icon: '😴' },
  { label: 'Low', icon: '😐' },
  { label: 'Okay', icon: '🙂' },
  { label: 'Good', icon: '💪' },
  { label: 'Excellent', icon: '🔥' },
] as const

export function moodRating(rating: number | null) {
  return rating == null ? null : (MOOD_RATINGS[rating - 1] ?? null)
}

export function filterWorkouts(
  workouts: WorkoutRow[],
  filter: SessionFilter,
  searchQuery = '',
): WorkoutRow[] {
  const query = searchQuery.trim().toLocaleLowerCase()
  return workouts.filter((workout) => {
    if (filter !== 'all' && workout.session_type !== filter) return false
    return (
      !query ||
      (workout.title ?? '').toLocaleLowerCase().includes(query) ||
      (workout.notes ?? '').toLocaleLowerCase().includes(query)
    )
  })
}
