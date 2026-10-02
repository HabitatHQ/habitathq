import type { WorkoutRow } from '~/types/database'

export type SessionFilter = 'all' | 'gym' | 'run' | 'conditioning' | 'mobility' | 'other'

export const SESSION_TYPES: ReadonlyArray<{ value: SessionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'gym', label: 'Gym' },
  { value: 'run', label: 'Runs' },
  { value: 'conditioning', label: 'Conditioning' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'other', label: 'Other' },
]

export function sessionLabel(workout: Pick<WorkoutRow, 'session_type'>): string {
  switch (workout.session_type) {
    case 'gym':
      return 'Gym Session'
    case 'run':
      return 'Run'
    case 'conditioning':
      return 'Conditioning Session'
    case 'mobility':
      return 'Mobility Session'
    case 'other':
      return 'Other Session'
  }
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
      workout.date.includes(query) ||
      (workout.notes ?? '').toLocaleLowerCase().includes(query)
    )
  })
}
