import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW, TODAY, testId } from './helpers/db'

describe('cardio sets and logging_mode', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
    // Seed exercise + workout + workout_exercise
    db.exec(
      `INSERT INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, is_custom, created_at, logging_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ['ex-treadmill', 'Treadmill', 'treadmill', 'machine', 'cardio', '[]', '[]', 0, NOW, 'cardio'],
    )
    db.exec(
      `INSERT INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, is_custom, created_at, logging_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ['ex-squat', 'Squat', 'squat', 'barbell', 'squat', '["quads"]', '[]', 0, NOW, 'strength'],
    )
    db.exec(
      `INSERT INTO workouts (id, date, started_at, session_type, created_at)
       VALUES (?,?,?,?,?)`,
      ['wk-1', TODAY, NOW, 'gym', NOW],
    )
    db.exec(
      `INSERT INTO workout_exercises (id, workout_id, exercise_id, order_num, rest_seconds)
       VALUES (?,?,?,?,?)`,
      ['we-cardio', 'wk-1', 'ex-treadmill', 1, 60],
    )
    db.exec(
      `INSERT INTO workout_exercises (id, workout_id, exercise_id, order_num, rest_seconds)
       VALUES (?,?,?,?,?)`,
      ['we-strength', 'wk-1', 'ex-squat', 2, 180],
    )
  })

  afterEach(() => db.close())

  it('exercise has logging_mode = cardio', () => {
    const rows = db.query<{ logging_mode: string }>(
      `SELECT logging_mode FROM exercises WHERE id = 'ex-treadmill'`,
    )
    expect(rows[0]?.logging_mode).toBe('cardio')
  })

  it('exercise has default logging_mode = strength', () => {
    const rows = db.query<{ logging_mode: string }>(
      `SELECT logging_mode FROM exercises WHERE id = 'ex-squat'`,
    )
    expect(rows[0]?.logging_mode).toBe('strength')
  })

  it('logs a cardio set with distance and duration', () => {
    const sid = testId('set')
    db.exec(
      `INSERT INTO sets (id, workout_exercise_id, set_num, is_warmup, completed, distance_m, duration_sec, speed_kmh)
       VALUES (?,?,?,?,?,?,?,?)`,
      [sid, 'we-cardio', 1, 0, 1, 5000, 1800, 10.0],
    )
    const rows = db.query<{ distance_m: number; duration_sec: number; speed_kmh: number }>(
      'SELECT distance_m, duration_sec, speed_kmh FROM sets WHERE id = ?',
      [sid],
    )
    expect(rows[0]?.distance_m).toBe(5000)
    expect(rows[0]?.duration_sec).toBe(1800)
    expect(rows[0]?.speed_kmh).toBe(10.0)
  })

  it('logs a strength set with technique_flag and body_feel', () => {
    const sid = testId('set')
    db.exec(
      `INSERT INTO sets (id, workout_exercise_id, set_num, is_warmup, weight_kg, reps, completed, technique_flag, body_feel)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [sid, 'we-strength', 1, 0, 100, 5, 1, 'grinding', 'tight'],
    )
    const rows = db.query<{ technique_flag: string; body_feel: string }>(
      'SELECT technique_flag, body_feel FROM sets WHERE id = ?',
      [sid],
    )
    expect(rows[0]?.technique_flag).toBe('grinding')
    expect(rows[0]?.body_feel).toBe('tight')
  })

  it('logs a machine cardio set with level', () => {
    const sid = testId('set')
    db.exec(
      `INSERT INTO sets (id, workout_exercise_id, set_num, is_warmup, completed, duration_sec, level)
       VALUES (?,?,?,?,?,?,?)`,
      [sid, 'we-cardio', 1, 0, 1, 600, 8],
    )
    const rows = db.query<{ level: number; duration_sec: number }>(
      'SELECT level, duration_sec FROM sets WHERE id = ?',
      [sid],
    )
    expect(rows[0]?.level).toBe(8)
    expect(rows[0]?.duration_sec).toBe(600)
  })

  it('workout can have environment tag', () => {
    db.exec(`UPDATE workouts SET environment = 'commercial' WHERE id = 'wk-1'`)
    const rows = db.query<{ environment: string }>(
      `SELECT environment FROM workouts WHERE id = 'wk-1'`,
    )
    expect(rows[0]?.environment).toBe('commercial')
  })

  it('technique flags: all valid values', () => {
    const flags = ['good', 'grinding', 'failed', 'partial_range']
    for (const flag of flags) {
      const sid = testId('set')
      db.exec(
        `INSERT INTO sets (id, workout_exercise_id, set_num, is_warmup, completed, technique_flag)
         VALUES (?,?,?,?,?,?)`,
        [sid, 'we-strength', 1, 0, 1, flag],
      )
      const rows = db.query<{ technique_flag: string }>(
        'SELECT technique_flag FROM sets WHERE id = ?',
        [sid],
      )
      expect(rows[0]?.technique_flag).toBe(flag)
    }
  })
})
