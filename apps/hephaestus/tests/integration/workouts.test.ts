import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW, TODAY, testId } from './helpers/db'

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

afterEach(() => {
  db.close()
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function insertExercise(slug: string, name: string, movement = 'press') {
  const id = testId('ex')
  db.exec(
    `INSERT INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, cues, icon, is_custom, created_at)
     VALUES (?, ?, ?, 'barbell', ?, '[]', '[]', NULL, 'i-ph-barbell', 0, ?)`,
    [id, name, slug, movement, NOW],
  )
  return id
}

function startWorkout(templateId: string | null = null, sessionType = 'gym', date = TODAY) {
  const id = testId('wk')
  db.exec(
    `INSERT INTO workouts (id, date, started_at, ended_at, session_type, training_block_id, template_id, mood_rating, energy_rating, notes, created_at)
     VALUES (?, ?, ?, NULL, ?, NULL, ?, NULL, NULL, NULL, ?)`,
    [id, date, NOW, sessionType, templateId, NOW],
  )
  return id
}

function addExerciseToWorkout(workoutId: string, exerciseId: string, orderNum: number) {
  const id = testId('we')
  db.exec(
    `INSERT INTO workout_exercises (id, workout_id, exercise_id, order_num, superset_group, rest_seconds)
     VALUES (?, ?, ?, ?, NULL, 120)`,
    [id, workoutId, exerciseId, orderNum],
  )
  return id
}

function logSet(
  workoutExerciseId: string,
  setNum: number,
  weightKg: number,
  reps: number,
  completed = 1,
) {
  const id = testId('set')
  db.exec(
    `INSERT INTO sets (id, workout_exercise_id, set_num, is_warmup, weight_kg, reps, rpe, rir, notes, completed, logged_at)
     VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL, ?, ?)`,
    [id, workoutExerciseId, setNum, weightKg, reps, completed, NOW],
  )
  return id
}

function finishWorkout(workoutId: string) {
  db.exec('UPDATE workouts SET ended_at = ? WHERE id = ?', [NOW, workoutId])
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('workouts — start and finish', () => {
  it('creates an in-progress workout with null ended_at', () => {
    const id = startWorkout()
    const rows = db.query<{ ended_at: string | null }>(
      'SELECT ended_at FROM workouts WHERE id = ?',
      [id],
    )
    expect(rows[0].ended_at).toBeNull()
  })

  it('finishes a workout by setting ended_at', () => {
    const id = startWorkout()
    finishWorkout(id)
    const rows = db.query<{ ended_at: string | null }>(
      'SELECT ended_at FROM workouts WHERE id = ?',
      [id],
    )
    expect(rows[0].ended_at).toBe(NOW)
  })

  it('only completed workouts appear in history query', () => {
    const w1 = startWorkout()
    const w2 = startWorkout()
    finishWorkout(w1)

    const rows = db.query<{ id: string }>(
      'SELECT id FROM workouts WHERE ended_at IS NOT NULL ORDER BY date DESC',
    )
    expect(rows.map((r) => r.id)).toEqual([w1])
    expect(rows.find((r) => r.id === w2)).toBeUndefined()
  })

  it('creates a run-type workout', () => {
    const id = startWorkout(null, 'run')
    const rows = db.query<{ session_type: string }>(
      'SELECT session_type FROM workouts WHERE id = ?',
      [id],
    )
    expect(rows[0].session_type).toBe('run')
  })

  it('associates workout with a template', () => {
    db.exec(
      "INSERT INTO templates (id, name, description, created_at) VALUES ('tpl-1', 'Push Day', NULL, ?)",
      [NOW],
    )
    const wkId = startWorkout('tpl-1')
    const rows = db.query<{ template_id: string | null }>(
      'SELECT template_id FROM workouts WHERE id = ?',
      [wkId],
    )
    expect(rows[0].template_id).toBe('tpl-1')
  })
})

describe('workout_exercises — adding exercises', () => {
  it('adds an exercise to a workout', () => {
    const exId = insertExercise('bench-press', 'Bench Press')
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId, 1)

    const rows = db.query<{ exercise_id: string; order_num: number }>(
      'SELECT exercise_id, order_num FROM workout_exercises WHERE id = ?',
      [weId],
    )
    expect(rows[0].exercise_id).toBe(exId)
    expect(rows[0].order_num).toBe(1)
  })

  it('adds multiple exercises to a workout in order', () => {
    const ex1 = insertExercise('bench', 'Bench Press', 'press')
    const ex2 = insertExercise('row', 'Row', 'row')
    const ex3 = insertExercise('ohp', 'OHP', 'press')
    const wkId = startWorkout()
    addExerciseToWorkout(wkId, ex1, 1)
    addExerciseToWorkout(wkId, ex2, 2)
    addExerciseToWorkout(wkId, ex3, 3)

    const rows = db.query<{ order_num: number }>(
      'SELECT order_num FROM workout_exercises WHERE workout_id = ? ORDER BY order_num',
      [wkId],
    )
    expect(rows.map((r) => r.order_num)).toEqual([1, 2, 3])
  })

  it('CASCADE deletes workout_exercises when workout is deleted', () => {
    const exId = insertExercise('squat', 'Squat', 'squat')
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId, 1)

    db.exec('DELETE FROM workouts WHERE id = ?', [wkId])
    expect(db.query('SELECT id FROM workout_exercises WHERE id = ?', [weId])).toHaveLength(0)
  })
})

describe('sets — logging', () => {
  it('logs a single set with weight and reps', () => {
    const exId = insertExercise('deadlift', 'Deadlift', 'hinge')
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId, 1)
    const setId = logSet(weId, 1, 100, 5)

    const rows = db.query<{ weight_kg: number; reps: number; completed: number }>(
      'SELECT weight_kg, reps, completed FROM sets WHERE id = ?',
      [setId],
    )
    expect(rows[0].weight_kg).toBe(100)
    expect(rows[0].reps).toBe(5)
    expect(rows[0].completed).toBe(1)
  })

  it('logs multiple sets for an exercise', () => {
    const exId = insertExercise('squat', 'Squat', 'squat')
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId, 1)
    logSet(weId, 1, 80, 8)
    logSet(weId, 2, 90, 6)
    logSet(weId, 3, 100, 4)

    const rows = db.query<{ set_num: number; weight_kg: number }>(
      'SELECT set_num, weight_kg FROM sets WHERE workout_exercise_id = ? ORDER BY set_num',
      [weId],
    )
    expect(rows.map((r) => r.weight_kg)).toEqual([80, 90, 100])
  })

  it('marks a warmup set', () => {
    const exId = insertExercise('press', 'Press', 'press')
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId, 1)
    const setId = testId('set')
    db.exec(
      `INSERT INTO sets (id, workout_exercise_id, set_num, is_warmup, weight_kg, reps, rpe, rir, notes, completed, logged_at)
       VALUES (?, ?, 1, 1, 60, 10, NULL, NULL, NULL, 1, ?)`,
      [setId, weId, NOW],
    )
    const rows = db.query<{ is_warmup: number }>('SELECT is_warmup FROM sets WHERE id = ?', [setId])
    expect(rows[0].is_warmup).toBe(1)
  })

  it('CASCADE deletes sets when workout_exercise is deleted', () => {
    const exId = insertExercise('bench', 'Bench', 'press')
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId, 1)
    const setId = logSet(weId, 1, 80, 8)

    db.exec('DELETE FROM workout_exercises WHERE id = ?', [weId])
    expect(db.query('SELECT id FROM sets WHERE id = ?', [setId])).toHaveLength(0)
  })

  it('calculates total volume (weight × reps) for a workout', () => {
    const exId = insertExercise('bench', 'Bench Press', 'press')
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId, 1)
    logSet(weId, 1, 100, 5) // 500
    logSet(weId, 2, 100, 5) // 500
    logSet(weId, 3, 100, 5) // 500

    const rows = db.query<{ volume: number }>(
      `SELECT SUM(weight_kg * reps) AS volume
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ? AND s.completed = 1`,
      [wkId],
    )
    expect(rows[0].volume).toBe(1500)
  })
})

describe('full workout session flow', () => {
  it('start → add exercises → log sets → finish → verify history', () => {
    const exBench = insertExercise('bench-press', 'Bench Press', 'press')
    const exRow = insertExercise('barbell-row', 'Barbell Row', 'row')

    // Start workout
    const wkId = startWorkout()

    // Add exercises
    const weBench = addExerciseToWorkout(wkId, exBench, 1)
    const weRow = addExerciseToWorkout(wkId, exRow, 2)

    // Log sets
    logSet(weBench, 1, 80, 8)
    logSet(weBench, 2, 80, 8)
    logSet(weBench, 3, 82.5, 6)
    logSet(weRow, 1, 70, 10)
    logSet(weRow, 2, 70, 10)

    // Finish
    finishWorkout(wkId)

    // Verify in history
    const history = db.query<{ id: string; ended_at: string | null }>(
      'SELECT id, ended_at FROM workouts WHERE ended_at IS NOT NULL',
    )
    expect(history.map((r) => r.id)).toContain(wkId)

    // Verify set counts
    const setCounts = db.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ?`,
      [wkId],
    )
    expect(setCounts[0].cnt).toBe(5)
  })
})

describe('runs', () => {
  it('logs a run linked to a workout', () => {
    const wkId = startWorkout(null, 'run')
    const runId = testId('run')
    db.exec(
      `INSERT INTO runs (id, workout_id, run_type, distance_m, duration_sec, avg_pace_sec_km, avg_hr, max_hr, elevation_gain_m, avg_cadence, avg_power_w, manual_entry)
       VALUES (?, ?, 'easy', 5000, 1500, 300, 140, 165, 50, 170, NULL, 1)`,
      [runId, wkId],
    )
    const rows = db.query<{ distance_m: number; duration_sec: number }>(
      'SELECT distance_m, duration_sec FROM runs WHERE id = ?',
      [runId],
    )
    expect(rows[0].distance_m).toBe(5000)
    expect(rows[0].duration_sec).toBe(1500)
  })

  it('CASCADE deletes run when workout is deleted', () => {
    const wkId = startWorkout(null, 'run')
    const runId = testId('run')
    db.exec(
      `INSERT INTO runs (id, workout_id, run_type, distance_m, duration_sec, avg_pace_sec_km, avg_hr, max_hr, elevation_gain_m, avg_cadence, avg_power_w, manual_entry)
       VALUES (?, ?, 'easy', 5000, 1500, 300, 140, 165, 50, 170, NULL, 1)`,
      [runId, wkId],
    )
    db.exec('DELETE FROM workouts WHERE id = ?', [wkId])
    expect(db.query('SELECT id FROM runs WHERE id = ?', [runId])).toHaveLength(0)
  })
})
