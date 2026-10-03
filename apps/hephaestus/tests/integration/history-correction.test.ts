import type { DbAdapter } from '@palladium/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatchHistory } from '~/lib/history-correction'
import { migrateOrganization } from '~/lib/organization-schema'
import { dispatchOrganization, finishOrganization } from '~/lib/organization-storage'
import { migrateHistoryCorrection, migrateWorkout } from '~/lib/workout-schema'
import { recomputeWorkoutDerivedState } from '~/lib/workout-storage'
import type {
  HistoryCorrectionDraft,
  HistoryOperation,
  HistoryOperationMap,
} from '~/types/history-correction'
import { createTestDb, NOW, type TestDb } from './helpers/db'

let raw: TestDb
let db: DbAdapter

function bindings(values?: unknown[]) {
  return values?.map((value) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      value === null ||
      value instanceof Uint8Array
    )
      return value
    throw new Error('Unsupported SQLite test binding')
  })
}
function history<K extends HistoryOperation>(
  type: K,
  payload: HistoryOperationMap[K]['payload'],
): Promise<HistoryOperationMap[K]['result']> {
  return db.transaction((tx) => dispatchHistory(tx, type, payload))
}
async function review(draft: Omit<HistoryCorrectionDraft, 'workoutId' | 'expectedVersion'>) {
  const detail = await history('HISTORY_CORRECTION_READ', { workoutId: 'workout' })
  return history('HISTORY_CORRECTION_PREVIEW', {
    workoutId: 'workout',
    expectedVersion: detail.version,
    ...draft,
  })
}
function state() {
  return Object.fromEntries(
    [
      'workouts',
      'workout_exercises',
      'sets',
      'personal_records',
      'weekly_training_load',
      'organization_goal_credits',
      'organization_appointments',
      'organization_rotations',
      'organization_rotation_advances',
      'organization_source_links',
      'workout_intent_sets',
    ].map((table) => [table, raw.query(`SELECT * FROM ${table} ORDER BY rowid`)]),
  )
}

beforeEach(async () => {
  raw = await createTestDb()
  db = {
    queryAll: async <T>(sql: string, bind?: unknown[]) => raw.query<T>(sql, bindings(bind)),
    queryOne: async <T>(sql: string, bind?: unknown[]) =>
      raw.query<T>(sql, bindings(bind))[0] ?? null,
    exec: async (sql: string, bind?: unknown[]) => raw.exec(sql, bindings(bind)),
    transaction: async <T>(fn: (tx: DbAdapter) => Promise<T>) => {
      raw.exec('BEGIN')
      try {
        const result = await fn(db)
        raw.exec('COMMIT')
        return result
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
  }
  await migrateWorkout(db)
  await migrateHistoryCorrection(db)
  await migrateOrganization(db)
  for (const [id, name, movement] of [
    ['squat', 'Squat', 'squat'],
    ['press', 'Press', 'push'],
    ['cardio', 'Cycle', 'cardio'],
  ]) {
    raw.exec(
      'INSERT INTO exercises(id,name,slug,equipment,movement,logging_mode,created_at) VALUES(?,?,?,?,?,?,?)',
      [
        id ?? '',
        name ?? '',
        id ?? '',
        'barbell',
        movement ?? '',
        id === 'cardio' ? 'cardio' : 'strength',
        NOW,
      ],
    )
  }
  raw.exec(
    'INSERT INTO workouts(id,date,started_at,ended_at,session_type,notes,mood_rating,energy_rating,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [
      'workout',
      '2026-03-15',
      NOW,
      '2026-03-15T13:00:00Z',
      'conditioning',
      'Keep subjective notes',
      4,
      3,
      NOW,
    ],
  )
  raw.exec(
    'INSERT INTO workout_exercises(id,workout_id,exercise_id,logging_mode,order_num) VALUES(?,?,?,?,?)',
    ['activity', 'workout', 'squat', 'strength', 1],
  )
  raw.exec(
    'INSERT INTO sets(id,workout_exercise_id,set_num,is_warmup,weight_kg,reps,rpe,notes,completed) VALUES(?,?,?,?,?,?,?,?,?)',
    ['working', 'activity', 1, 0, 100, 5, null, 'Keep original set notes', 1],
  )
  raw.exec(
    'INSERT INTO sets(id,workout_exercise_id,set_num,is_warmup,weight_kg,reps,completed) VALUES(?,?,?,?,?,?,?)',
    ['warmup', 'activity', 2, 1, 20, 10, 1],
  )
  raw.exec(
    'INSERT INTO workout_intent_sets(set_id,intent_set_id,target_snapshot_json) VALUES(?,?,?)',
    [
      'working',
      'captured-set',
      JSON.stringify({
        id: 'captured-set',
        role: 'working',
        weightKg: { id: 'load-target', rule: { kind: 'fixed', value: 90 }, resolvedValue: 90 },
        reps: { kind: 'range', minimum: 6, maximum: 8 },
        rpe: null,
        rir: null,
      }),
    ],
  )
  const plan = await dispatchOrganization(db, 'ORGANIZATION_PLAN_SAVE', {
    name: 'Personal plan',
    startDate: '2026-03-10',
  })
  raw.exec(
    'INSERT INTO saved_routines(id,name,template_id,adopted_template_revision_id,current_revision_id,continuation_policy,deferral_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [
      'routine',
      'Routine',
      'template',
      'template-revision',
      'routine-revision',
      'calendar_bound',
      null,
      NOW,
      NOW,
    ],
  )
  const first = await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_CREATE', {
    id: 'first',
    planId: plan.id,
    routineId: 'routine',
    date: '2026-03-15',
  })
  await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_CREATE', {
    id: 'second',
    planId: plan.id,
    routineId: 'routine',
    date: '2026-03-16',
  })
  await dispatchOrganization(db, 'ORGANIZATION_GOAL_SAVE', {
    id: 'goal',
    planId: plan.id,
    name: 'Frequency',
    targetCount: 2,
    filter: { sessionTypes: [], exerciseIds: [], movementPatterns: [] },
  })
  const rotation = await dispatchOrganization(db, 'ORGANIZATION_ROTATION_SAVE', {
    id: 'rotation',
    planId: plan.id,
    name: 'Rotation',
    routineIds: ['routine'],
  })
  raw.exec(
    'INSERT INTO organization_source_links(workout_id,appointment_id,rotation_id,rotation_generation) VALUES(?,?,?,?)',
    ['workout', first.id, rotation.id, 0],
  )
  raw.exec("UPDATE organization_appointments SET workout_id='workout' WHERE id='first'")
  await finishOrganization(db, 'workout')
  await recomputeWorkoutDerivedState(db, 'workout')
})
afterEach(() => raw.close())

describe('reviewed factual history corrections', () => {
  it('previews captured formula/range comparisons and proposed credit without changing facts', async () => {
    const before = state()
    const preview = await review({
      performedDate: '2026-03-16',
      activities: [
        { id: 'activity', sets: [{ id: 'working', values: { weightKg: 95, reps: 7 } }] },
      ],
    })
    expect(preview.comparisons.find((item) => item.setId === 'working')?.fields).toEqual(
      expect.arrayContaining([
        { field: 'weightKg', target: { kind: 'exact', minimum: 90 }, actual: 95, status: 'above' },
        {
          field: 'reps',
          target: { kind: 'range', minimum: 6, maximum: 8 },
          actual: 7,
          status: 'matches',
        },
        { field: 'rpe', target: null, actual: null, status: 'unknown' },
      ]),
    )
    expect(preview.credit.after).toMatchObject({
      qualifies: true,
      appointmentIds: ['first'],
      goalIds: ['goal'],
    })
    expect(state()).toEqual(before)
    await history('HISTORY_CORRECTION_APPLY', {
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
    })
    expect(
      raw.query('SELECT date,notes,mood_rating,energy_rating,correction_version FROM workouts'),
    ).toEqual([
      {
        date: '2026-03-16',
        notes: 'Keep subjective notes',
        mood_rating: 4,
        energy_rating: 3,
        correction_version: 1,
      },
    ])
    expect(raw.query('SELECT week_start FROM organization_goal_credits')).toEqual([
      { week_start: '2026-03-16' },
    ])
    expect(raw.query('SELECT weight_kg,reps,notes FROM sets WHERE id=?', ['working'])).toEqual([
      { weight_kg: 95, reps: 7, notes: 'Keep original set notes' },
    ])
    expect(raw.query('SELECT gym_volume,gym_sets FROM weekly_training_load')).toEqual([
      { gym_volume: 665, gym_sets: 1 },
    ])
    expect(
      raw.query('SELECT exercise_id,record_type,value FROM personal_records WHERE record_type=?', [
        'weight',
      ]),
    ).toEqual([{ exercise_id: 'squat', record_type: 'weight', value: 95 }])
    expect(raw.query('SELECT * FROM workout_intent_sets')).toEqual(before['workout_intent_sets'])
    expect(raw.query('SELECT * FROM organization_rotations')).toEqual(
      before['organization_rotations'],
    )
  })

  it('adds missed results to an existing activity without replacing its captured intent or rotation', async () => {
    const before = state()
    const preview = await review({
      activities: [
        { id: 'activity', addSets: [{ weightKg: 80, reps: 8, completed: true, isWarmup: false }] },
      ],
    })
    expect(preview.impact).toMatchObject({ addedActivities: 0, addedSets: 1 })
    expect(state()).toEqual(before)
    await history('HISTORY_CORRECTION_APPLY', {
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
    })
    const detail = await history('HISTORY_CORRECTION_READ', { workoutId: 'workout' })
    expect(
      detail.activities[0]?.sets.map((set) => ({
        number: set.set_num,
        load: set.weight_kg,
        reps: set.reps,
        completed: set.completed,
      })),
    ).toEqual([
      { number: 1, load: 100, reps: 5, completed: 1 },
      { number: 2, load: 20, reps: 10, completed: 1 },
      { number: 3, load: 80, reps: 8, completed: 1 },
    ])
    expect(raw.query('SELECT gym_volume,gym_sets FROM weekly_training_load')).toEqual([
      { gym_volume: 1140, gym_sets: 2 },
    ])
    expect(raw.query('SELECT * FROM workout_intent_sets')).toEqual(before['workout_intent_sets'])
    expect(raw.query('SELECT * FROM organization_rotation_advances')).toEqual(
      before['organization_rotation_advances'],
    )
  })

  it('excludes skipped results from reviewed target comparisons and rejects stale reviews after skip changes', async () => {
    raw.exec('INSERT INTO workout_set_skips(set_id,skipped_at) VALUES(?,?)', ['working', NOW])
    const preview = await review({ title: 'Reviewed' })
    expect(preview.comparisons.some((row) => row.setId === 'working')).toBe(false)
    raw.exec("DELETE FROM workout_set_skips WHERE set_id='working'")
    await expect(
      history('HISTORY_CORRECTION_APPLY', {
        previewId: preview.previewId,
        fingerprint: preview.fingerprint,
      }),
    ).rejects.toThrow()
    expect(raw.query('SELECT title,correction_version FROM workouts')).toEqual([
      { title: null, correction_version: 0 },
    ])
  })

  it('relinks one appointment and preserves prior rotation provenance/advance', async () => {
    const before = state()
    const preview = await review({
      appointmentId: 'second',
      activities: [{ id: 'activity', exerciseId: 'press' }],
    })
    await history('HISTORY_CORRECTION_APPLY', {
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
    })
    expect(
      raw.query('SELECT id,status,workout_id FROM organization_appointments ORDER BY id'),
    ).toEqual([
      { id: 'first', status: 'open', workout_id: null },
      { id: 'second', status: 'fulfilled', workout_id: 'workout' },
    ])
    expect(raw.query('SELECT * FROM organization_source_links')).toEqual([
      {
        workout_id: 'workout',
        appointment_id: 'second',
        rotation_id: 'rotation',
        rotation_generation: 0,
      },
    ])
    expect(raw.query('SELECT exercise_id,logging_mode FROM workout_exercises')).toEqual([
      { exercise_id: 'press', logging_mode: 'strength' },
    ])
    expect(raw.query('SELECT * FROM organization_rotation_advances')).toEqual(
      before['organization_rotation_advances'],
    )
    expect(raw.query('SELECT * FROM organization_rotations')).toEqual(
      before['organization_rotations'],
    )
    expect(raw.query('SELECT exercise_id FROM personal_records GROUP BY exercise_id')).toEqual([
      { exercise_id: 'press' },
    ])
    expect(raw.query('SELECT * FROM workout_intent_sets')).toEqual(before['workout_intent_sets'])
  })

  it('removes mistaken work, exposes unfulfilled credit, and restores the same rows', async () => {
    const before = state()
    const preview = await review({ activities: [{ id: 'activity', removed: true }] })
    const result = await history('HISTORY_CORRECTION_APPLY', {
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
    })
    expect(result.unfulfilledAppointmentId).toBe('first')
    expect(raw.query('SELECT * FROM personal_records')).toEqual([])
    expect(raw.query('SELECT * FROM organization_goal_credits')).toEqual([])
    const today = await dispatchOrganization(db, 'ORGANIZATION_TODAY', { today: '2026-03-15' })
    expect(today.find((item) => item.id === 'first')).toMatchObject({
      workoutId: null,
      explanation: 'Scheduled commitment for today.',
    })
    const restored = await review({ activities: [{ id: 'activity', removed: false }] })
    await history('HISTORY_CORRECTION_APPLY', {
      previewId: restored.previewId,
      fingerprint: restored.fingerprint,
    })
    expect(raw.query('SELECT id,weight_kg,reps FROM sets WHERE id=?', ['working'])).toEqual([
      { id: 'working', weight_kg: 100, reps: 5 },
    ])
    expect(raw.query('SELECT status FROM organization_appointments WHERE id=?', ['first'])).toEqual(
      [{ status: 'fulfilled' }],
    )
    expect(raw.query('SELECT * FROM organization_rotations')).toEqual(
      before['organization_rotations'],
    )
  })

  it('adds non-strength actual work without replacing captured intent or counting it as lifting', async () => {
    const beforeIntent = raw.query('SELECT * FROM workout_intent_sets')
    const preview = await review({
      addActivities: [
        { exerciseId: 'cardio', sets: [{ distanceM: 800, durationSec: 180, completed: true }] },
      ],
    })
    await history('HISTORY_CORRECTION_APPLY', {
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
    })
    expect(
      raw.query('SELECT logging_mode FROM workout_exercises WHERE exercise_id=?', ['cardio']),
    ).toEqual([{ logging_mode: 'cardio' }])
    expect(raw.query('SELECT gym_volume,gym_sets FROM weekly_training_load')).toEqual([
      { gym_volume: 500, gym_sets: 1 },
    ])
    expect(raw.query('SELECT * FROM workout_intent_sets')).toEqual(beforeIntent)
  })

  it('rejects stale actual facts and protected appointments without partial writes', async () => {
    const preview = await review({ title: 'Revised title' })
    raw.exec("UPDATE sets SET notes='Newer actual note' WHERE id='working'")
    const before = state()
    await expect(
      history('HISTORY_CORRECTION_APPLY', {
        previewId: preview.previewId,
        fingerprint: preview.fingerprint,
      }),
    ).rejects.toThrow('facts changed')
    expect(state()).toEqual(before)
    raw.exec(
      "INSERT INTO workouts(id,date,started_at,session_type,created_at) VALUES('active','2026-03-16',?,'gym',?)",
      [NOW, NOW],
    )
    raw.exec("UPDATE organization_appointments SET workout_id='active' WHERE id='second'")
    await expect(review({ appointmentId: 'second' })).rejects.toThrow('protected')
  })

  it('rolls back actual facts, metrics and credit when a derived write fails', async () => {
    const preview = await review({
      activities: [{ id: 'activity', sets: [{ id: 'working', values: { weightKg: 110 } }] }],
    })
    const before = state()
    raw.exec(
      "CREATE TRIGGER reject_corrected_load BEFORE INSERT ON weekly_training_load BEGIN SELECT RAISE(ABORT,'injected derived failure'); END",
    )
    await expect(
      history('HISTORY_CORRECTION_APPLY', {
        previewId: preview.previewId,
        fingerprint: preview.fingerprint,
      }),
    ).rejects.toThrow('injected derived failure')
    expect(state()).toEqual(before)
  })

  it.each([
    { performedDate: '2026-02-31' },
    { activities: [{ id: 'activity', sets: [{ id: 'working', values: { rpe: 11 } }] }] },
    { activities: [{ id: 'activity', sets: [{ id: 'working', values: { reps: 2.5 } }] }] },
    { activities: [{ id: 'activity', sets: [{ id: 'working', values: { reps: null } }] }] },
    { activities: [{ id: 'activity', addSets: [{ completed: true, weightKg: 100 }] }] },
    { addActivities: [{ exerciseId: 'cardio', sets: [{ completed: true, reps: 5 }] }] },
  ])('rejects invalid factual values before saving a review: %j', async (draft) => {
    const before = state()
    await expect(review(draft)).rejects.toThrow()
    expect(state()).toEqual(before)
  })
})
