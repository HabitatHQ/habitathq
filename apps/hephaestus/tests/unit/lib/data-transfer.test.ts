import { describe, expect, it } from 'vitest'
import { buildWorkoutCsv, type WorkoutCsvRow } from '~/lib/data-transfer'

const emptyRow: WorkoutCsvRow = {
  date: '2026-10-02',
  session_type: 'gym',
  started_at: '2026-10-02T09:00:00Z',
  ended_at: '2026-10-02T10:00:00Z',
  exercise_name: null,
  set_num: null,
  weight_kg: null,
  reps: null,
  distance_m: null,
  duration_sec: null,
  notes: null,
}

describe('buildWorkoutCsv', () => {
  it('distinguishes null from empty and safely quotes comma, quote, newline, and Unicode', () => {
    const csv = buildWorkoutCsv([
      emptyRow,
      {
        ...emptyRow,
        exercise_name: 'Bench, “press”',
        notes: 'first line\nsecond line 🚀',
      },
      { ...emptyRow, exercise_name: '', notes: '' },
    ])
    expect(csv).toContain('\\N')
    expect(csv).toContain('"Bench, “press”"')
    expect(csv).toContain('"first line\nsecond line 🚀"')
    expect(csv).toContain(',"",\\N')
    expect(csv.split('\r\n')).toHaveLength(4)
  })
})
