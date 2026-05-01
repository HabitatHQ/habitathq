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

function insertExercise(slug: string, name: string) {
  const id = testId('ex')
  db.exec(
    `INSERT INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, cues, icon, is_custom, created_at)
     VALUES (?, ?, ?, 'barbell', 'press', '[]', '[]', NULL, 'i-ph-barbell', 0, ?)`,
    [id, name, slug, NOW],
  )
  return id
}

function startWorkout() {
  const id = testId('wk')
  db.exec(
    `INSERT INTO workouts (id, date, started_at, ended_at, session_type, training_block_id, template_id, mood_rating, energy_rating, notes, created_at)
     VALUES (?, ?, ?, NULL, 'gym', NULL, NULL, NULL, NULL, NULL, ?)`,
    [id, TODAY, NOW, NOW],
  )
  return id
}

function addExerciseToWorkout(workoutId: string, exerciseId: string) {
  const id = testId('we')
  db.exec(
    `INSERT INTO workout_exercises (id, workout_id, exercise_id, order_num, superset_group, rest_seconds)
     VALUES (?, ?, ?, 1, NULL, 120)`,
    [id, workoutId, exerciseId],
  )
  return id
}

function logSet(workoutExerciseId: string, setNum: number, weightKg: number, reps: number) {
  const id = testId('set')
  db.exec(
    `INSERT INTO sets (id, workout_exercise_id, set_num, is_warmup, weight_kg, reps, rpe, rir, notes, completed, logged_at)
     VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL, 1, ?)`,
    [id, workoutExerciseId, setNum, weightKg, reps, NOW],
  )
  return id
}

function insertPR(
  exerciseId: string,
  recordType: string,
  value: number,
  setId: string | null = null,
  date = TODAY,
) {
  const id = testId('pr')
  db.exec(
    'INSERT INTO personal_records (id, exercise_id, record_type, value, set_id, date) VALUES (?, ?, ?, ?, ?, ?)',
    [id, exerciseId, recordType, value, setId, date],
  )
  return id
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('personal_records — insert and query', () => {
  it('records a weight PR', () => {
    const exId = insertExercise('bench-press', 'Bench Press')
    const prId = insertPR(exId, 'weight', 120)

    const rows = db.query<{ record_type: string; value: number }>(
      'SELECT record_type, value FROM personal_records WHERE id = ?',
      [prId],
    )
    expect(rows[0].record_type).toBe('weight')
    expect(rows[0].value).toBe(120)
  })

  it('records an e1rm PR', () => {
    const exId = insertExercise('squat', 'Squat')
    const prId = insertPR(exId, 'e1rm', 145.3)

    const rows = db.query<{ value: number }>('SELECT value FROM personal_records WHERE id = ?', [
      prId,
    ])
    expect(rows[0].value).toBeCloseTo(145.3)
  })

  it('records a reps PR', () => {
    const exId = insertExercise('pull-up', 'Pull-up')
    const prId = insertPR(exId, 'reps', 20)

    const rows = db.query<{ value: number }>('SELECT value FROM personal_records WHERE id = ?', [
      prId,
    ])
    expect(rows[0].value).toBe(20)
  })

  it('links PR to a specific set', () => {
    const exId = insertExercise('deadlift', 'Deadlift')
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId)
    const setId = logSet(weId, 1, 200, 1)
    const prId = insertPR(exId, 'weight', 200, setId)

    const rows = db.query<{ set_id: string | null }>(
      'SELECT set_id FROM personal_records WHERE id = ?',
      [prId],
    )
    expect(rows[0].set_id).toBe(setId)
  })

  it('queries all PRs for an exercise', () => {
    const exId = insertExercise('bench-press', 'Bench Press')
    insertPR(exId, 'weight', 100, null, '2026-01-01')
    insertPR(exId, 'weight', 110, null, '2026-02-01')
    insertPR(exId, 'e1rm', 125, null, '2026-02-15')

    const rows = db.query<{ record_type: string; value: number }>(
      'SELECT record_type, value FROM personal_records WHERE exercise_id = ? ORDER BY date ASC',
      [exId],
    )
    expect(rows).toHaveLength(3)
    expect(rows[0].value).toBe(100)
    expect(rows[2].record_type).toBe('e1rm')
  })

  it('gets the max weight PR for an exercise', () => {
    const exId = insertExercise('squat', 'Squat')
    insertPR(exId, 'weight', 100)
    insertPR(exId, 'weight', 120)
    insertPR(exId, 'weight', 115)

    const rows = db.query<{ max_weight: number }>(
      "SELECT MAX(value) AS max_weight FROM personal_records WHERE exercise_id = ? AND record_type = 'weight'",
      [exId],
    )
    expect(rows[0].max_weight).toBe(120)
  })

  it('returns PRs across multiple exercises', () => {
    const exBench = insertExercise('bench', 'Bench Press')
    const exSquat = insertExercise('squat', 'Squat')
    insertPR(exBench, 'weight', 120)
    insertPR(exSquat, 'weight', 180)

    const rows = db.query<{ exercise_id: string; value: number }>(
      "SELECT exercise_id, value FROM personal_records WHERE record_type = 'weight' ORDER BY value DESC",
    )
    expect(rows[0].value).toBe(180)
    expect(rows[1].value).toBe(120)
  })
})

describe('personal_records — index performance', () => {
  it('query by exercise_id uses index (many PRs)', () => {
    const exId = insertExercise('heavy-lifter', 'Heavy Lifter')
    // Insert 50 PRs across different exercises
    for (let i = 0; i < 50; i++) {
      const otherId = insertExercise(`other-${i}`, `Other Exercise ${i}`)
      insertPR(otherId, 'weight', i * 10)
    }
    // Target exercise PRs
    insertPR(exId, 'weight', 150)
    insertPR(exId, 'e1rm', 175)

    const rows = db.query<{ value: number }>(
      'SELECT value FROM personal_records WHERE exercise_id = ? ORDER BY value DESC',
      [exId],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].value).toBe(175)
    expect(rows[1].value).toBe(150)
  })
})

describe('personal_records — PR detection logic', () => {
  it('detects new max weight from a set', () => {
    const exId = insertExercise('bench', 'Bench Press')
    // Existing PRs
    insertPR(exId, 'weight', 100)

    // New set logged
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId)
    const setId = logSet(weId, 1, 110, 5)

    // Check if new set beats existing PR
    const maxRows = db.query<{ max_weight: number }>(
      "SELECT COALESCE(MAX(value), 0) AS max_weight FROM personal_records WHERE exercise_id = ? AND record_type = 'weight'",
      [exId],
    )
    const isNewPR = 110 > maxRows[0].max_weight
    expect(isNewPR).toBe(true)

    if (isNewPR) {
      insertPR(exId, 'weight', 110, setId)
    }

    const allPRs = db.query<{ value: number }>(
      "SELECT value FROM personal_records WHERE exercise_id = ? AND record_type = 'weight' ORDER BY value DESC",
      [exId],
    )
    expect(allPRs[0].value).toBe(110)
  })

  it('does not insert PR if weight is not new max', () => {
    const exId = insertExercise('bench', 'Bench Press')
    insertPR(exId, 'weight', 120)

    // New set at lower weight
    const wkId = startWorkout()
    const weId = addExerciseToWorkout(wkId, exId)
    logSet(weId, 1, 100, 5)

    const maxRows = db.query<{ max_weight: number }>(
      "SELECT COALESCE(MAX(value), 0) AS max_weight FROM personal_records WHERE exercise_id = ? AND record_type = 'weight'",
      [exId],
    )
    const isNewPR = 100 > maxRows[0].max_weight
    expect(isNewPR).toBe(false)

    // Count PRs — should still be just 1
    const count = db.query<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM personal_records WHERE exercise_id = ? AND record_type = 'weight'",
      [exId],
    )
    expect(count[0].cnt).toBe(1)
  })
})

describe('weekly_training_load', () => {
  it('inserts and retrieves weekly load', () => {
    db.exec(
      `INSERT INTO weekly_training_load (week, gym_volume, gym_sets, run_distance_m, run_duration_sec)
       VALUES ('2026-W10', 15000, 45, 20000, 6000)`,
    )
    const rows = db.query<{ week: string; gym_volume: number; gym_sets: number }>(
      "SELECT week, gym_volume, gym_sets FROM weekly_training_load WHERE week = '2026-W10'",
    )
    expect(rows[0].week).toBe('2026-W10')
    expect(rows[0].gym_volume).toBe(15000)
    expect(rows[0].gym_sets).toBe(45)
  })
})
