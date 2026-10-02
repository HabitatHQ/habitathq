import { describe, expect, it } from 'vitest'
import { filterWorkouts, SESSION_TYPES, sessionLabel } from '~/lib/history'
import type { SessionType, WorkoutRow } from '~/types/database'

function workout(id: string, sessionType: SessionType, notes: string | null = null): WorkoutRow {
  return {
    id,
    date: '2026-10-02',
    started_at: '2026-10-02T09:00:00Z',
    ended_at: '2026-10-02T10:00:00Z',
    session_type: sessionType,
    training_block_id: null,
    template_id: null,
    mood_rating: null,
    energy_rating: null,
    notes,
    environment: null,
    created_at: '2026-10-02T09:00:00Z',
  }
}

const workouts = [
  workout('gym', 'gym'),
  workout('run', 'run'),
  workout('conditioning', 'conditioning', 'Intervals'),
  workout('mobility', 'mobility'),
  workout('other', 'other'),
]

describe('history session modes', () => {
  it('provides truthful labels for every supported and legacy mode', () => {
    expect(SESSION_TYPES.map(({ value, label }) => [value, label])).toEqual([
      ['all', 'All'],
      ['gym', 'Gym'],
      ['run', 'Runs'],
      ['conditioning', 'Conditioning'],
      ['mobility', 'Mobility'],
      ['other', 'Other'],
    ])
    expect(workouts.map(sessionLabel)).toEqual([
      'Gym Session',
      'Run',
      'Conditioning Session',
      'Mobility Session',
      'Other Session',
    ])
  })

  it('filters each mode independently and combines mode with search', () => {
    expect(filterWorkouts(workouts, 'all')).toHaveLength(5)
    for (const mode of ['gym', 'run', 'conditioning', 'mobility', 'other'] as const) {
      expect(filterWorkouts(workouts, mode).map(({ id }) => id)).toEqual([mode])
    }
    expect(filterWorkouts(workouts, 'conditioning', 'intervals').map(({ id }) => id)).toEqual([
      'conditioning',
    ])
    expect(filterWorkouts(workouts, 'run', 'intervals')).toEqual([])
  })
})
