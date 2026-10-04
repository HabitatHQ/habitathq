import { addCalendarDays } from '@habitathq/utils'
import type { DbAdapter } from '@palladium/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateOrganization } from '~/lib/organization-schema'
import {
  dispatchOrganization,
  finishOrganization,
  recomputeOrganizationCredit,
  startOrganization,
} from '~/lib/organization-storage'
import type { OrganizationOperation, OrganizationOperationMap } from '~/types/organization'
import type { TestDb } from './helpers/db'
import { createTestDb, testId } from './helpers/db'

let raw: TestDb
let db: DbAdapter

function bindings(
  values: unknown[] | undefined,
): (string | number | null | Uint8Array)[] | undefined {
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

async function operation<K extends OrganizationOperation>(
  type: K,
  payload: OrganizationOperationMap[K]['payload'],
): Promise<OrganizationOperationMap[K]['result']> {
  return dispatchOrganization(db, type, payload)
}

async function plan(name: string) {
  return operation('ORGANIZATION_PLAN_SAVE', { name, startDate: '2026-03-10' })
}

function routine(
  id: string,
  name: string,
  policy: 'carry_forward' | 'calendar_bound' = 'carry_forward',
  deferral: 'automatic' | 'manual' | null = 'automatic',
) {
  raw.exec(
    'INSERT INTO saved_routines(id,name,template_id,adopted_template_revision_id,current_revision_id,continuation_policy,deferral_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [
      id,
      name,
      `template-${id}`,
      `revision-${id}`,
      `revision-${id}`,
      policy,
      deferral,
      '2026-03-10T12:00:00.000Z',
      '2026-03-10T12:00:00.000Z',
    ],
  )
}
function strengthWorkout(
  id: string,
  date: string,
  exerciseId: string,
  entries: { id: string; warmup: boolean; completed: boolean; reps: number | null }[],
  endedAt: string | null,
) {
  raw.exec(
    'INSERT INTO exercises(id,name,slug,equipment,equipment_sub,movement,muscles,muscles_sec,logging_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [
      exerciseId,
      'Test squat',
      `slug-${exerciseId}`,
      'barbell',
      'barbell',
      'squat',
      '["quadriceps","glutes"]',
      '["hamstrings"]',
      'strength',
      `${date}T12:00:00.000Z`,
    ],
  )
  raw.exec(
    'INSERT INTO workouts(id,date,started_at,ended_at,session_type,created_at) VALUES(?,?,?,?,?,?)',
    [id, date, `${date}T12:00:00.000Z`, endedAt, 'gym', `${date}T12:00:00.000Z`],
  )
  raw.exec('INSERT INTO workout_exercises(id,workout_id,exercise_id,order_num) VALUES(?,?,?,?)', [
    `we-${id}`,
    id,
    exerciseId,
    0,
  ])
  for (const [index, entry] of entries.entries()) {
    raw.exec(
      'INSERT INTO sets(id,workout_exercise_id,set_num,is_warmup,reps,completed) VALUES(?,?,?,?,?,?)',
      [entry.id, `we-${id}`, index + 1, entry.warmup ? 1 : 0, entry.reps, entry.completed ? 1 : 0],
    )
  }
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
        const value = await fn(db)
        raw.exec('COMMIT')
        return value
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
  }
  await migrateOrganization(db)
})

afterEach(() => raw.close())

describe('persisted training organization', () => {
  it('reopens idempotently, protects a midnight-overdue appointment, and exhausts the 28-date deferral horizon without dropping it', async () => {
    const planA = await plan('Independent A')
    const planB = await plan('Independent B')
    const sharedRoutine = testId('shared-routine')
    routine(sharedRoutine, 'Shared routine')
    const overdue = await operation('ORGANIZATION_APPOINTMENT_CREATE', {
      planId: planA.id,
      routineId: sharedRoutine,
      date: '2026-03-09',
    })
    for (let offset = 0; offset < 28; offset++) {
      await operation('ORGANIZATION_APPOINTMENT_CREATE', {
        planId: planB.id,
        routineId: sharedRoutine,
        date: addCalendarDays('2026-03-10', offset),
      })
    }
    const first = await operation('ORGANIZATION_RECONCILE_OPEN', { today: '2026-03-10' })
    const second = await operation('ORGANIZATION_RECONCILE_OPEN', { today: '2026-03-10' })
    expect(first.find((item) => item.id === overdue.id)?.plannedDate).toBe('2026-03-09')
    expect(second.filter((item) => item.id === overdue.id)).toHaveLength(1)
    expect(second.find((item) => item.id === overdue.id)?.postponed).toBe(false)
    expect(second).toHaveLength(29)
  })

  it('keeps plans independent while allowing different routines to coexist and reports same-routine postponement collisions', async () => {
    const planA = await plan('A')
    const planB = await plan('B')
    const shared = testId('routine')
    const other = testId('routine')
    routine(shared, 'Shared')
    routine(other, 'Other')
    const first = await operation('ORGANIZATION_APPOINTMENT_CREATE', {
      planId: planA.id,
      routineId: shared,
      date: '2026-03-12',
    })
    const parallel = await operation('ORGANIZATION_APPOINTMENT_CREATE', {
      planId: planB.id,
      routineId: shared,
      date: '2026-03-12',
    })
    await operation('ORGANIZATION_APPOINTMENT_CREATE', {
      planId: planB.id,
      routineId: other,
      date: '2026-03-12',
    })
    expect(
      (await operation('ORGANIZATION_APPOINTMENT_LIST', { planId: planA.id })).map(
        (item) => item.id,
      ),
    ).toEqual([first.id])
    expect(
      (await operation('ORGANIZATION_APPOINTMENT_LIST', { planId: planB.id })).map(
        (item) => item.id,
      ),
    ).toEqual(expect.arrayContaining([parallel.id]))
    await expect(
      operation('ORGANIZATION_APPOINTMENT_POSTPONE', {
        appointmentId: first.id,
        date: '2026-03-12',
      }),
    ).rejects.toThrow('Same-routine appointment collision')
    const moved = await operation('ORGANIZATION_APPOINTMENT_POSTPONE', {
      appointmentId: first.id,
      date: '2026-03-12',
      overrideCollision: true,
    })
    expect(moved.collisionIds).toContain(parallel.id)
  })

  it('preserves an explicitly postponed Program appointment when Today reopens', async () => {
    const personalPlan = await plan('Program calendar')
    const routineId = testId('routine')
    routine(routineId, 'Calendar routine', 'calendar_bound', null)
    raw.exec(
      'INSERT INTO program_revisions(id,program_id,revision_num,design_json,structure_hash,created_at) VALUES(?,?,?,?,?,?)',
      [
        'program-revision',
        'program',
        1,
        JSON.stringify({ slots: [{ id: 'slot', week: 1, day: 3 }] }),
        'test',
        '2026-03-10T12:00:00.000Z',
      ],
    )
    raw.exec('UPDATE training_plans SET program_id=?,adopted_program_revision_id=? WHERE id=?', [
      'program',
      'program-revision',
      personalPlan.id,
    ])
    raw.exec(
      'INSERT INTO training_plan_bindings(id,plan_id,program_slot_id,template_id,routine_id,status) VALUES(?,?,?,?,?,?)',
      ['binding', personalPlan.id, 'slot', `template-${routineId}`, routineId, 'bound'],
    )
    const initial = await operation('ORGANIZATION_RECONCILE_OPEN', { today: '2026-03-10' })
    const scheduled = initial.find((item) => item.planId === personalPlan.id)
    if (!scheduled) throw new Error('Expected a Program appointment')
    await operation('ORGANIZATION_APPOINTMENT_POSTPONE', {
      appointmentId: scheduled.id,
      date: '2026-03-15',
    })
    const reopened = await operation('ORGANIZATION_RECONCILE_OPEN', { today: '2026-03-10' })
    expect(reopened.find((item) => item.id === scheduled.id)).toMatchObject({
      originalDate: '2026-03-12',
      plannedDate: '2026-03-15',
      postponed: true,
    })
  })

  it('rejects stale rotation generations, records one skip, and starts consecutive seven-local-date Program weeks from the selected weekday', async () => {
    const planA = await plan('Wednesday start')
    const firstRoutine = testId('routine')
    const secondRoutine = testId('routine')
    routine(firstRoutine, 'First')
    routine(secondRoutine, 'Second')
    const saved = await operation('ORGANIZATION_ROTATION_SAVE', {
      planId: planA.id,
      name: 'Alternating',
      routineIds: [firstRoutine, secondRoutine],
    })
    expect(
      await operation('ORGANIZATION_ROTATION_SKIP', {
        rotationId: saved.id,
        generation: saved.generation,
      }),
    ).toBe(saved.generation + 1)
    await expect(
      operation('ORGANIZATION_ROTATION_SKIP', {
        rotationId: saved.id,
        generation: saved.generation,
      }),
    ).rejects.toThrow('Rotation changed')
    const firstWeek = await operation('ORGANIZATION_PROGRAM_WEEK', {
      planId: planA.id,
      date: '2026-03-11',
    })
    const secondWeek = await operation('ORGANIZATION_PROGRAM_WEEK', {
      planId: planA.id,
      date: '2026-03-18',
    })
    expect(firstWeek).toEqual({ week: 1, weekStart: '2026-03-10', weekEnd: '2026-03-16' })
    expect(secondWeek).toEqual({ week: 2, weekStart: '2026-03-17', weekEnd: '2026-03-23' })
  })
  it('materializes recurring obligations idempotently and defers only when a same-routine clear local date exists', async () => {
    const clearPlan = await plan('Clear day')
    const sharedPlan = await plan('Shared recurrence')
    const clearRoutine = testId('routine')
    const blockedRoutine = testId('routine')
    routine(clearRoutine, 'Clear routine')
    routine(blockedRoutine, 'Blocked routine')
    const overdueClear = await operation('ORGANIZATION_APPOINTMENT_CREATE', {
      planId: clearPlan.id,
      routineId: clearRoutine,
      date: '2026-03-09',
    })
    const clearReview = await operation('ORGANIZATION_RECURRENCE_PREVIEW', {
      planId: sharedPlan.id,
      routineId: clearRoutine,
      weekdays: [1],
      startDate: '2026-03-10',
      endDate: '2026-04-06',
      time: '07:30',
      active: true,
      today: '2026-03-10',
    })
    await operation('ORGANIZATION_RECURRENCE_APPLY', {
      previewId: clearReview.previewId,
      fingerprint: clearReview.fingerprint,
    })
    const clearFirst = await operation('ORGANIZATION_RECONCILE_OPEN', { today: '2026-03-10' })
    const clearSecond = await operation('ORGANIZATION_RECONCILE_OPEN', { today: '2026-03-10' })
    expect(clearFirst.find((item) => item.id === overdueClear.id)?.plannedDate).toBe('2026-03-10')
    expect(
      clearSecond.filter((item) =>
        item.occurrenceKey?.startsWith(`recurrence:${clearReview.rule.id}:`),
      ),
    ).toHaveLength(4)

    const blockedPlan = await plan('Daily commitments')
    const overdueBlocked = await operation('ORGANIZATION_APPOINTMENT_CREATE', {
      planId: blockedPlan.id,
      routineId: blockedRoutine,
      date: '2026-03-09',
    })
    const blockedReview = await operation('ORGANIZATION_RECURRENCE_PREVIEW', {
      planId: sharedPlan.id,
      routineId: blockedRoutine,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      startDate: '2026-03-10',
      endDate: '2026-04-06',
      active: true,
      today: '2026-03-10',
    })
    await operation('ORGANIZATION_RECURRENCE_APPLY', {
      previewId: blockedReview.previewId,
      fingerprint: blockedReview.fingerprint,
    })
    const blocked = await operation('ORGANIZATION_RECONCILE_OPEN', { today: '2026-03-10' })
    expect(blocked.find((item) => item.id === overdueBlocked.id)?.plannedDate).toBe('2026-03-09')
    expect(blocked.filter((item) => item.sourceId === blockedReview.rule.id)).toHaveLength(28)
  })
  it.each(['empty', 'warm-up-only'])(
    'releases an appointment after a %s finish without credit',
    async (kind) => {
      const personalPlan = await plan('Unfulfilled appointment')
      const routineId = testId('routine')
      routine(routineId, 'Scheduled routine', 'calendar_bound', null)
      const appointment = await operation('ORGANIZATION_APPOINTMENT_CREATE', {
        planId: personalPlan.id,
        routineId,
        date: '2026-03-11',
      })
      await operation('ORGANIZATION_GOAL_SAVE', {
        planId: personalPlan.id,
        name: 'Frequency',
        targetCount: 2,
        filter: { sessionTypes: [], exerciseIds: [], movementPatterns: [] },
      })
      strengthWorkout(
        'unqualified',
        '2026-03-11',
        testId('exercise'),
        kind === 'empty' ? [] : [{ id: 'warmup', warmup: true, completed: true, reps: 10 }],
        null,
      )
      await startOrganization(db, 'unqualified', { appointmentId: appointment.id, routineId })
      await finishOrganization(db, 'unqualified')
      expect(
        await operation('ORGANIZATION_APPOINTMENT_LIST', { planId: personalPlan.id }),
      ).toMatchObject([{ id: appointment.id, status: 'open', workoutId: 'unqualified' }])
      await db.exec(
        "UPDATE workouts SET ended_at='2026-03-11T13:00:00.000Z' WHERE id='unqualified'",
      )
      await finishOrganization(db, 'unqualified')
      await finishOrganization(db, 'unqualified')
      expect(
        await operation('ORGANIZATION_APPOINTMENT_LIST', { planId: personalPlan.id }),
      ).toMatchObject([{ id: appointment.id, status: 'open', workoutId: null }])
      expect(await db.queryAll('SELECT * FROM organization_goal_credits')).toEqual([])
      expect(
        await db.queryOne(
          'SELECT appointment_id FROM organization_source_links WHERE workout_id=?',
          ['unqualified'],
        ),
      ).toEqual({
        appointment_id: appointment.id,
      })
      const today = await operation('ORGANIZATION_TODAY', { today: '2026-03-11' })
      expect(today.find((item) => item.id === appointment.id)).toMatchObject({
        workoutId: null,
        explanation: 'Scheduled commitment for today.',
      })
      strengthWorkout('replacement', '2026-03-11', testId('exercise'), [], null)
      await startOrganization(db, 'replacement', { appointmentId: appointment.id, routineId })
      expect(
        await operation('ORGANIZATION_APPOINTMENT_LIST', { planId: personalPlan.id }),
      ).toMatchObject([{ id: appointment.id, workoutId: 'replacement' }])
    },
  )

  it('releases and restores corrected appointment credit without claiming a newer workout link', async () => {
    const personalPlan = await plan('Correctable appointment')
    const routineId = testId('routine')
    routine(routineId, 'Scheduled routine', 'calendar_bound', null)
    const appointment = await operation('ORGANIZATION_APPOINTMENT_CREATE', {
      planId: personalPlan.id,
      routineId,
      date: '2026-03-11',
    })
    strengthWorkout(
      'original',
      '2026-03-11',
      testId('exercise'),
      [{ id: 'original-set', warmup: false, completed: true, reps: 5 }],
      null,
    )
    await startOrganization(db, 'original', { appointmentId: appointment.id, routineId })
    await db.exec("UPDATE workouts SET ended_at='2026-03-11T13:00:00.000Z' WHERE id='original'")
    await finishOrganization(db, 'original')
    await db.exec("UPDATE sets SET completed=0 WHERE id='original-set'")
    await recomputeOrganizationCredit(db, 'original')
    expect(
      await operation('ORGANIZATION_APPOINTMENT_LIST', { planId: personalPlan.id }),
    ).toMatchObject([{ id: appointment.id, status: 'open', workoutId: null }])
    await db.exec("UPDATE sets SET completed=1 WHERE id='original-set'")
    await recomputeOrganizationCredit(db, 'original')
    expect(
      await operation('ORGANIZATION_APPOINTMENT_LIST', { planId: personalPlan.id }),
    ).toMatchObject([{ id: appointment.id, status: 'fulfilled', workoutId: 'original' }])
    await db.exec("UPDATE sets SET completed=0 WHERE id='original-set'")
    await recomputeOrganizationCredit(db, 'original')
    strengthWorkout('newer', '2026-03-11', testId('exercise'), [], null)
    await startOrganization(db, 'newer', { appointmentId: appointment.id, routineId })
    await db.exec("UPDATE sets SET completed=1 WHERE id='original-set'")
    expect(await operation('ORGANIZATION_CREDIT_PREVIEW', { workoutId: 'original' })).toMatchObject(
      {
        qualifies: true,
        appointmentIds: [],
      },
    )
    await recomputeOrganizationCredit(db, 'original')
    expect(
      await operation('ORGANIZATION_APPOINTMENT_LIST', { planId: personalPlan.id }),
    ).toMatchObject([{ id: appointment.id, status: 'open', workoutId: 'newer' }])
  })

  it('credits each matching goal once, rejects warm-up-only work, and advances only a linked qualifying rotation finish once', async () => {
    const planA = await plan('Goal plan')
    const routineA = testId('routine')
    const routineB = testId('routine')
    const exerciseId = testId('exercise')
    routine(routineA, 'Routine A')
    routine(routineB, 'Routine B')
    const rotation = await operation('ORGANIZATION_ROTATION_SAVE', {
      planId: planA.id,
      name: 'Two session rotation',
      routineIds: [routineA, routineB],
    })
    const filter = { sessionTypes: ['gym'], exerciseIds: [exerciseId], movementPatterns: ['squat'] }
    const goals = await Promise.all([
      operation('ORGANIZATION_GOAL_SAVE', {
        planId: planA.id,
        name: 'Strength',
        targetCount: 2,
        filter,
      }),
      operation('ORGANIZATION_GOAL_SAVE', {
        planId: planA.id,
        name: 'Squats',
        targetCount: 2,
        filter: { sessionTypes: [], exerciseIds: [], movementPatterns: ['squat'] },
      }),
      operation('ORGANIZATION_GOAL_SAVE', {
        planId: planA.id,
        name: 'Sessions',
        targetCount: 2,
        filter: { sessionTypes: ['gym'], exerciseIds: [], movementPatterns: [] },
      }),
    ])
    strengthWorkout(
      'linked-finish',
      '2026-03-11',
      exerciseId,
      [
        { id: 'warmup-set', warmup: true, completed: true, reps: 10 },
        { id: 'working-set', warmup: false, completed: true, reps: 5 },
      ],
      null,
    )
    await startOrganization(db, 'linked-finish', {
      rotationId: rotation.id,
      rotationGeneration: rotation.generation,
      routineId: routineA,
    })
    expect(
      await db.queryOne<{ generation: number }>(
        'SELECT generation FROM organization_rotations WHERE id=?',
        [rotation.id],
      ),
    ).toEqual({ generation: 0 })
    await db.exec(
      "UPDATE workouts SET ended_at='2026-03-11T13:00:00.000Z' WHERE id='linked-finish'",
    )
    await finishOrganization(db, 'linked-finish')
    await finishOrganization(db, 'linked-finish')
    const credited = await db.queryAll<{ goal_id: string; workout_id: string }>(
      'SELECT goal_id,workout_id FROM organization_goal_credits WHERE workout_id=?',
      ['linked-finish'],
    )
    expect(credited.map((item) => item.goal_id).sort()).toEqual(goals.map((goal) => goal.id).sort())
    expect(
      await db.queryOne<{ generation: number; position: number }>(
        'SELECT generation,position FROM organization_rotations WHERE id=?',
        [rotation.id],
      ),
    ).toEqual({ generation: 1, position: 1 })
    expect(
      await db.queryOne<{ n: number }>(
        'SELECT COUNT(*) AS n FROM organization_rotation_advances WHERE rotation_id=?',
        [rotation.id],
      ),
    ).toEqual({ n: 1 })
    await db.exec("UPDATE sets SET completed=0 WHERE id='working-set'")
    await recomputeOrganizationCredit(db, 'linked-finish')
    expect(
      await db.queryOne<{ generation: number }>(
        'SELECT generation FROM organization_rotations WHERE id=?',
        [rotation.id],
      ),
    ).toEqual({ generation: 1 })

    strengthWorkout(
      'warmup-only',
      '2026-03-12',
      testId('exercise'),
      [{ id: 'only-warmup', warmup: true, completed: true, reps: 12 }],
      '2026-03-12T13:00:00.000Z',
    )
    expect(
      await operation('ORGANIZATION_CREDIT_PREVIEW', { workoutId: 'warmup-only' }),
    ).toMatchObject({ qualifies: false, goalIds: [] })
    await finishOrganization(db, 'warmup-only')
    expect(
      await db.queryOne<{ generation: number }>(
        'SELECT generation FROM organization_rotations WHERE id=?',
        [rotation.id],
      ),
    ).toEqual({ generation: 1 })
  })
  it('reports only completed working sets with current classifications and keeps unknown primary data visible', async () => {
    const exercise = testId('exercise')
    strengthWorkout(
      'report-current-class',
      '2026-03-11',
      exercise,
      [
        { id: 'report-warmup', warmup: true, completed: true, reps: 8 },
        { id: 'report-working', warmup: false, completed: true, reps: 5 },
        { id: 'report-skipped', warmup: false, completed: false, reps: 10 },
      ],
      '2026-03-11T13:00:00.000Z',
    )
    raw.exec(
      'UPDATE exercises SET movement=\'press\',muscles=\'["chest","triceps","chest"]\',muscles_sec=\'["front_delts","front_delts"]\' WHERE id=?',
      [exercise],
    )
    const unknownExercise = testId('exercise')
    raw.exec(
      'INSERT INTO exercises(id,name,slug,equipment,equipment_sub,movement,muscles,muscles_sec,logging_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [
        unknownExercise,
        'Unknown classification',
        `slug-${unknownExercise}`,
        'other',
        'other',
        '',
        '[]',
        '[]',
        'strength',
        '2026-03-11T12:00:00.000Z',
      ],
    )
    raw.exec(
      'INSERT INTO workouts(id,date,started_at,ended_at,session_type,created_at) VALUES(?,?,?,?,?,?)',
      [
        'report-unknown',
        '2026-03-11',
        '2026-03-11T12:00:00.000Z',
        '2026-03-11T13:00:00.000Z',
        'gym',
        '2026-03-11T12:00:00.000Z',
      ],
    )
    raw.exec('INSERT INTO workout_exercises(id,workout_id,exercise_id,order_num) VALUES(?,?,?,?)', [
      'we-report-unknown',
      'report-unknown',
      unknownExercise,
      0,
    ])
    raw.exec(
      'INSERT INTO sets(id,workout_exercise_id,set_num,is_warmup,reps,completed) VALUES(?,?,?,?,?,?)',
      ['unknown-working', 'we-report-unknown', 1, 0, 6, 1],
    )
    const report = await operation('ORGANIZATION_REPORT', {
      startDate: '2026-03-11',
      endDate: '2026-03-11',
      today: '2026-03-11',
    })
    expect(report.workingSets).toBe(2)
    expect(report.movementPatterns).toEqual(
      expect.arrayContaining([
        { pattern: 'press', sets: 1 },
        { pattern: 'Unclassified', sets: 1 },
      ]),
    )
    expect(report.primaryMuscles).toEqual(
      expect.arrayContaining([
        { muscle: 'chest', sets: 1 },
        { muscle: 'triceps', sets: 1 },
      ]),
    )
    expect(report.secondaryMuscles).toEqual([{ muscle: 'front_delts', sets: 1 }])
    expect(report.primaryMuscles.some((entry) => entry.muscle === 'quadriceps')).toBe(false)
    expect(report.unclassifiedSets).toBe(1)
  })
})
