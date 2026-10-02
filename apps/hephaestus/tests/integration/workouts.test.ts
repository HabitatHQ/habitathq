import type { DbAdapter } from '@palladium/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isoWeek } from '~/lib/format'
import { dispatchWorkout, type WorkoutSession, type WorkoutSummary } from '~/lib/workout-storage'
import type { RunRow, SetRow, WorkoutExerciseRow } from '~/types/database'
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
    finishWorkout(w1)
    const w2 = startWorkout()

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
function testBindings(values: unknown[] = []): (string | number | null | Uint8Array)[] {
  return values.map((value) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      value === null ||
      value instanceof Uint8Array
    )
      return value
    throw new Error('Unsupported test binding')
  })
}

function workoutAdapter(fail?: (sql: string) => boolean): DbAdapter {
  let failed = false
  return {
    async queryAll<T>(sql: string, bind?: unknown[]) {
      return db.query<T>(sql, testBindings(bind))
    },
    async queryOne<T>(sql: string, bind?: unknown[]) {
      return db.query<T>(sql, testBindings(bind))[0] ?? null
    },
    async exec(sql: string, bind?: unknown[]) {
      if (!failed && fail?.(sql)) {
        failed = true
        throw new Error('Injected database write failure')
      }
      db.exec(sql, testBindings(bind))
    },
  }
}

async function runWorkoutOperation<T>(
  type: string,
  payload: unknown,
  adapter = workoutAdapter(),
): Promise<T> {
  db.exec('BEGIN')
  try {
    const result = (await dispatchWorkout(adapter, type, payload)) as T
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function workoutSet(exerciseId: string, overrides: Partial<SetRow> = {}): SetRow {
  return {
    id: testId('set'),
    workout_exercise_id: exerciseId,
    set_num: 1,
    is_warmup: 0,
    weight_kg: 100,
    reps: 5,
    rpe: null,
    rir: null,
    notes: null,
    completed: 1,
    logged_at: NOW,
    distance_m: null,
    duration_sec: null,
    speed_kmh: null,
    level: null,
    technique_flag: null,
    body_feel: null,
    failure_flag: 0,
    failure_type: null,
    partial_reps: null,
    ...overrides,
  }
}

describe('atomic workout lifecycle operations', () => {
  it('durably applies template exclusions and scaled/program volume, and hydrates planned sets', async () => {
    const included = insertExercise('scaled-exercise', 'Scaled Exercise')
    const excluded = insertExercise('excluded-exercise', 'Excluded Exercise')
    const templateId = testId('template')
    db.exec('INSERT INTO templates (id,name,created_at) VALUES (?,?,?)', [templateId, 'Plan', NOW])
    for (const [exerciseId, order, count] of [
      [included, 1, 3],
      [excluded, 2, 4],
    ] as const) {
      db.exec(
        'INSERT INTO template_exercises (id,template_id,exercise_id,order_num,sets_planned) VALUES (?,?,?,?,?)',
        [testId('te'), templateId, exerciseId, order, count],
      )
    }

    const started = await runWorkoutOperation<WorkoutSession>('WORKOUT_START', {
      id: testId('workout'),
      now: NOW,
      templateId,
      options: {
        scale: 0.5,
        excludedExerciseIds: [excluded],
        sessionType: 'gym',
        intensityModifier: 0.9,
        volumeModifier: 2,
      },
    })

    expect(started.exercises.map((exercise) => exercise.exercise_id)).toEqual([included])
    expect(started.sets.map((set) => set.set_num)).toEqual([1, 2, 3])
    expect(started.sets.every((set) => set.completed === 0)).toBe(true)
    expect(started.options).toEqual({ intensity_modifier: 0.9, volume_modifier: 2 })

    const pending = started.sets[0]
    if (!pending) throw new Error('Expected a persisted planned set')
    const logged = await runWorkoutOperation<SetRow>('WORKOUT_LOG_SET', {
      set: { ...pending, weight_kg: 100, reps: 5, completed: 1, logged_at: NOW },
    })
    expect(logged.id).toBe(pending.id)
    expect(
      db.query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM sets WHERE workout_exercise_id=?',
        [started.exercises[0]?.id],
      )[0]?.count,
    ).toBe(3)

    const hydrated = await runWorkoutOperation<WorkoutSession>('WORKOUT_ACTIVE', {})
    expect(hydrated.workout.id).toBe(started.workout.id)
    expect(hydrated.sets.find((set) => set.id === pending.id)?.completed).toBe(1)
  })

  it('rolls back a failed finish and safely retries without duplicating PRs or weekly load', async () => {
    const exerciseId = insertExercise('rollback-strength', 'Rollback Strength')
    const started = await runWorkoutOperation<WorkoutSession>('WORKOUT_START', {
      id: testId('workout'),
      now: NOW,
    })
    const exercise: WorkoutExerciseRow = {
      id: testId('workout-exercise'),
      workout_id: started.workout.id,
      exercise_id: exerciseId,
      order_num: 1,
      superset_group: null,
      rest_seconds: 120,
    }
    await runWorkoutOperation('WORKOUT_ADD_EXERCISE', { exercise })
    await runWorkoutOperation('WORKOUT_LOG_SET', { set: workoutSet(exercise.id) })

    await expect(
      runWorkoutOperation(
        'WORKOUT_FINISH',
        { workoutId: started.workout.id, endedAt: '2026-03-16T12:00:00Z' },
        workoutAdapter((sql) => sql.includes('INSERT INTO weekly_training_load')),
      ),
    ).rejects.toThrow('Injected database write failure')
    expect(
      db.query<{ ended_at: string | null }>('SELECT ended_at FROM workouts WHERE id=?', [
        started.workout.id,
      ])[0]?.ended_at,
    ).toBeNull()
    expect(db.query('SELECT id FROM personal_records')).toHaveLength(0)
    expect(db.query('SELECT week FROM weekly_training_load')).toHaveLength(0)

    const endedAt = '2026-03-16T12:00:00Z'
    const completed = await runWorkoutOperation<WorkoutSummary>('WORKOUT_FINISH', {
      workoutId: started.workout.id,
      endedAt,
    })
    const retried = await runWorkoutOperation<WorkoutSummary>('WORKOUT_FINISH', {
      workoutId: started.workout.id,
      endedAt,
    })
    expect(retried).toEqual(completed)
    expect(db.query('SELECT id FROM personal_records')).toHaveLength(3)
    expect(db.query('SELECT week FROM weekly_training_load')).toHaveLength(1)
    expect(db.query('SELECT workout_id FROM workout_finish_summaries')).toHaveLength(1)
    const expectedWeek = isoWeek(new Date(`${started.workout.date}T12:00:00`))
    expect(db.query<{ week: string }>('SELECT week FROM weekly_training_load')[0]?.week).toBe(
      expectedWeek,
    )
    expect(
      db
        .query<{ date: string }>('SELECT date FROM personal_records')
        .every((row) => row.date === started.workout.date),
    ).toBe(true)
    const stableSummary = db.query(
      'SELECT summary_json FROM workout_finish_summaries WHERE workout_id=?',
      [started.workout.id],
    )
    const stableLoad = db.query('SELECT * FROM weekly_training_load')
    await expect(
      runWorkoutOperation('WORKOUT_ADD_EXERCISE', {
        exercise: { ...exercise, id: testId('late-exercise') },
      }),
    ).rejects.toThrow(/not writable/i)
    const lateRun: RunRow = {
      id: testId('late-run'),
      workout_id: started.workout.id,
      run_type: 'easy',
      distance_m: 5000,
      duration_sec: 1500,
      avg_pace_sec_km: null,
      avg_hr: null,
      max_hr: null,
      elevation_gain_m: null,
      avg_cadence: null,
      avg_power_w: null,
      manual_entry: 1,
    }
    await expect(runWorkoutOperation('WORKOUT_RUN_DATA', { run: lateRun })).rejects.toThrow(
      /not writable/i,
    )
    expect(
      db.query('SELECT summary_json FROM workout_finish_summaries WHERE workout_id=?', [
        started.workout.id,
      ]),
    ).toEqual(stableSummary)
    expect(db.query('SELECT * FROM weekly_training_load')).toEqual(stableLoad)
  })

  it('saves run data and keeps cardio out of resistance PRs and gym load', async () => {
    const started = await runWorkoutOperation<WorkoutSession>('WORKOUT_START', {
      id: testId('run-workout'),
      now: NOW,
      options: { sessionType: 'run' },
    })
    await runWorkoutOperation('WORKOUT_RUN_DATA', {
      run: {
        id: testId('run'),
        workout_id: started.workout.id,
        run_type: 'easy',
        distance_m: 5000,
        duration_sec: 1500,
        avg_pace_sec_km: null,
        avg_hr: null,
        max_hr: null,
        elevation_gain_m: null,
        avg_cadence: null,
        avg_power_w: null,
        manual_entry: 1,
      },
    })
    const summary = await runWorkoutOperation<WorkoutSummary>('WORKOUT_FINISH', {
      workoutId: started.workout.id,
      endedAt: NOW,
    })
    expect(summary.distanceM).toBe(5000)
    expect(summary.newPRs).toEqual([])
    const load = db.query<{
      gym_volume: number
      gym_sets: number
      run_distance_m: number
      run_duration_sec: number
    }>('SELECT * FROM weekly_training_load')[0]
    expect(load).toMatchObject({
      gym_volume: 0,
      gym_sets: 0,
      run_distance_m: 5000,
      run_duration_sec: 1500,
    })
    expect(
      db.query<{ workout_id: string; avg_pace_sec_km: number }>(
        'SELECT workout_id,avg_pace_sec_km FROM runs WHERE workout_id=?',
        [started.workout.id],
      ),
    ).toEqual([{ workout_id: started.workout.id, avg_pace_sec_km: 300 }])
  })

  it('guards new starts while retaining and recovering legacy unfinished sessions one at a time', async () => {
    const first = testId('legacy-active')
    const second = testId('legacy-active')
    db.exec('DROP TRIGGER IF EXISTS trg_workouts_single_unfinished_insert')
    db.exec('DROP TRIGGER IF EXISTS trg_workouts_single_unfinished_update')
    db.exec(
      'INSERT INTO workouts (id,date,started_at,session_type,created_at) VALUES (?,?,?,?,?)',
      [first, TODAY, '2026-03-10T10:00:00Z', 'gym', NOW],
    )
    db.exec(
      'INSERT INTO workouts (id,date,started_at,session_type,created_at) VALUES (?,?,?,?,?)',
      [second, TODAY, '2026-03-10T11:00:00Z', 'other', NOW],
    )
    const active = await runWorkoutOperation<WorkoutSession>('WORKOUT_ACTIVE', {})
    expect(active.workout.id).toBe(second)
    await expect(
      runWorkoutOperation('WORKOUT_START', { id: testId('blocked-start'), now: NOW }),
    ).rejects.toThrow(/unfinished session/i)
    expect(active.workout.session_type).toBe('other')
    await runWorkoutOperation('WORKOUT_DISCARD', { workoutId: active.workout.id })
    const prior = await runWorkoutOperation<WorkoutSession>('WORKOUT_ACTIVE', {})
    expect(prior.workout.id).toBe(first)
    await expect(
      runWorkoutOperation('WORKOUT_START', { id: testId('still-blocked'), now: NOW }),
    ).rejects.toThrow(/unfinished session/i)
  })
})
