import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW, TODAY, testId } from './helpers/db'

describe('analytics queries', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
    // Seed exercise
    db.exec(
      `INSERT INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, is_custom, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        'ex-squat',
        'Squat',
        'squat',
        'barbell',
        'squat',
        '["quads","glutes"]',
        '["hamstrings"]',
        0,
        NOW,
      ],
    )
    // Seed workout
    db.exec(
      `INSERT INTO workouts (id, date, started_at, ended_at, session_type, created_at)
       VALUES (?,?,?,?,?,?)`,
      ['wk-1', TODAY, NOW, NOW, 'gym', NOW],
    )
    // Seed workout_exercise
    db.exec(
      `INSERT INTO workout_exercises (id, workout_id, exercise_id, order_num, rest_seconds)
       VALUES (?,?,?,?,?)`,
      ['we-1', 'wk-1', 'ex-squat', 1, 180],
    )
    // Seed sets
    for (let i = 1; i <= 3; i++) {
      const sid = testId('set')
      db.exec(
        `INSERT INTO sets (id, workout_exercise_id, set_num, is_warmup, weight_kg, reps, completed)
         VALUES (?,?,?,?,?,?,?)`,
        [sid, 'we-1', i, 0, 100, 5, 1],
      )
    }
  })

  afterEach(() => db.close())

  it('queries workout volume (weight × reps)', () => {
    const rows = db.query<{ total_volume: number }>(
      `SELECT SUM(weight_kg * reps) AS total_volume
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ? AND s.is_warmup = 0`,
      ['wk-1'],
    )
    expect(rows[0]?.total_volume).toBe(1500) // 3 × 100 × 5
  })

  it('queries workout set count', () => {
    const rows = db.query<{ set_count: number }>(
      `SELECT COUNT(*) AS set_count
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ? AND s.is_warmup = 0`,
      ['wk-1'],
    )
    expect(rows[0]?.set_count).toBe(3)
  })

  it('queries exercises by workout for muscle frequency', () => {
    const rows = db.query<{ muscles: string }>(
      `SELECT e.muscles
       FROM workout_exercises we
       JOIN exercises e ON e.id = we.exercise_id
       WHERE we.workout_id = ?`,
      ['wk-1'],
    )
    expect(rows).toHaveLength(1)
    const muscles = JSON.parse(rows[0]?.muscles ?? '[]') as string[]
    expect(muscles).toContain('quads')
    expect(muscles).toContain('glutes')
  })

  it('queries workout duration in minutes', () => {
    const rows = db.query<{ duration_min: number | null }>(
      `SELECT ROUND((julianday(ended_at) - julianday(started_at)) * 24 * 60) AS duration_min
       FROM workouts WHERE id = ?`,
      ['wk-1'],
    )
    // started_at = ended_at so 0 minutes
    expect(rows[0]?.duration_min).toBe(0)
  })

  it('queries personal records for exercise', () => {
    db.exec(
      `INSERT INTO personal_records (id, exercise_id, record_type, value, set_id, date)
       VALUES (?,?,?,?,?,?)`,
      [testId('pr'), 'ex-squat', 'weight', 120, null, TODAY],
    )
    const rows = db.query<{ value: number; record_type: string }>(
      'SELECT value, record_type FROM personal_records WHERE exercise_id = ? ORDER BY value DESC',
      ['ex-squat'],
    )
    expect(rows[0]?.value).toBe(120)
    expect(rows[0]?.record_type).toBe('weight')
  })

  it('queries workout count per date range', () => {
    // Add another workout yesterday
    db.exec(
      `INSERT INTO workouts (id, date, started_at, session_type, created_at)
       VALUES (?,?,?,?,?)`,
      ['wk-2', '2026-03-09', NOW, 'gym', NOW],
    )
    const rows = db.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM workouts WHERE date >= ? AND date <= ?',
      ['2026-03-01', '2026-03-10'],
    )
    expect(rows[0]?.count).toBe(2)
  })

  it('queries workout tags via join', () => {
    db.exec(
      'INSERT INTO tags (id, name, category, is_predefined, color, created_at) VALUES (?,?,?,?,?,?)',
      ['tag-pr', '#pr-day', 'performance', 1, '#f97316', NOW],
    )
    db.exec('INSERT INTO workout_tags (workout_id, tag_id) VALUES (?,?)', ['wk-1', 'tag-pr'])
    const rows = db.query<{ name: string }>(
      'SELECT t.name FROM workout_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.workout_id = ?',
      ['wk-1'],
    )
    expect(rows[0]?.name).toBe('#pr-day')
  })
})
