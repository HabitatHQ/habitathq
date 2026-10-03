import type { DbAdapter } from '@palladium/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatchTransfer, type PortableBundle } from '../../app/lib/data-transfer'
import { dispatchOrganization } from '../../app/lib/organization-storage'
import {
  dispatchPrescriptionOperation,
  migratePrescriptionDomain,
} from '../../app/lib/prescription-storage'
import { migrateWorkout } from '../../app/lib/workout-schema'
import { dispatchWorkout } from '../../app/lib/workout-storage'
import type { SetRow } from '../../app/types/database'
import type { SerializablePrescription } from '../../app/types/prescription'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW } from './helpers/db'

const routineId = '33333333-3333-4333-8333-333333333333'
const workoutId = '44444444-4444-4444-8444-444444444444'
const exerciseId = '11111111-1111-4111-8111-111111111111'
const activityId = '55555555-5555-4555-8555-555555555555'
const setId = '66666666-6666-4666-8666-666666666666'
const targetId = '77777777-7777-4777-8777-777777777777'
function sqliteBindings(
  values: unknown[] | undefined,
): (string | number | null | Uint8Array)[] | undefined {
  if (values === undefined) return undefined
  return values.map((value) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      value === null ||
      value instanceof Uint8Array
    )
      return value
    throw new Error('Test SQLite adapter received an unsupported bind value')
  })
}

function prescription(weight: number): SerializablePrescription {
  return {
    schemaVersion: 1,
    evaluatorVersion: 'unresolved-v1',
    inputs: [],
    defaults: { incrementKg: 2.5, restSec: 120 },
    groups: [],
    activities: [
      {
        id: activityId,
        exerciseId,
        order: 1,
        loggingMode: 'strength',
        executionGroupId: null,
        sets: [
          {
            id: setId,
            order: 1,
            role: 'working',
            reps: { kind: 'exact', value: { id: targetId, rule: { kind: 'fixed', value: 8 } } },
            weightKg: {
              id: '88888888-8888-4888-8888-888888888888',
              rule: { kind: 'fixed', value: weight },
            },
            restSec: null,
            rpe: null,
            rir: null,
            notes: null,
            legacyScheme: null,
          },
        ],
        targets: { durationSec: null, distanceM: null },
        notes: null,
      },
    ],
    provenance: {
      kind: 'authored',
      migratedAt: null,
      legacyTemplateId: null,
      unresolvedFields: [],
    },
  }
}

describe('captured workout prescription persistence', () => {
  let db: TestDb
  let adapter: DbAdapter

  beforeEach(async () => {
    db = await createTestDb()
    adapter = {
      queryAll: async <T>(sql: string, bind?: unknown[]) => db.query<T>(sql, sqliteBindings(bind)),
      queryOne: async <T>(sql: string, bind?: unknown[]) =>
        db.query<T>(sql, sqliteBindings(bind))[0] ?? null,
      exec: async (sql: string, bind?: unknown[]) => db.exec(sql, sqliteBindings(bind)),
      transaction: async <T>(fn: (tx: DbAdapter) => Promise<T>) => {
        db.exec('BEGIN')
        try {
          const result = await fn(adapter)
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
    }
    await migrateWorkout(adapter)
    await migratePrescriptionDomain(adapter)
    db.exec(
      'INSERT INTO exercises (id,name,slug,equipment,movement,muscles,created_at) VALUES (?,?,?,?,?,?,?)',
      [exerciseId, 'Bench Press', 'bench-press-capture', 'barbell', 'push', '[]', NOW],
    )
  })

  afterEach(() => db.close())

  it('imports formula-backed routines twice with independent identities and resolvable references', async () => {
    const initial = prescription(90)
    initial.evaluatorVersion = 'cel-js-8.0.0-js-number-v1'
    const inputId = crypto.randomUUID()
    initial.inputs = [
      {
        id: inputId,
        name: 'Load',
        field: 'weightKg',
        required: true,
        defaultValue: 100,
        minimum: 0,
        maximum: null,
        integer: false,
      },
    ]
    const authoredSet = initial.activities[0]?.sets[0]
    if (!authoredSet) throw new Error('Missing set')
    authoredSet.weightKg = {
      id: crypto.randomUUID(),
      rule: {
        kind: 'formula',
        source: 'load * 0.9',
        resultType: 'number',
        evaluatorVersion: initial.evaluatorVersion,
        bindings: [
          { id: crypto.randomUUID(), variable: 'load', source: { kind: 'input', inputId } },
        ],
      },
    }
    const template = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
        name: 'Portable formula',
        description: null,
        prescription: initial,
        now: NOW,
      }),
    )
    const routine = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_SAVE', {
        name: 'Portable routine',
        templateId: template.templateId,
        templateRevisionId: template.id,
        inputs: { [inputId]: 100 },
        continuationPolicy: 'calendar_bound',
        deferralMode: null,
        now: NOW,
      }),
    )
    const bundle = (await dispatchTransfer(adapter, 'TRANSFER_EXPORT_PORTABLE', {
      templateId: template.templateId,
    })) as PortableBundle
    await dispatchTransfer(adapter, 'TRANSFER_IMPORT_PORTABLE', { bundle })
    await dispatchTransfer(adapter, 'TRANSFER_IMPORT_PORTABLE', { bundle })
    const imported = db.query<{ id: string }>('SELECT id FROM saved_routines WHERE id != ?', [
      routine.routineId,
    ])
    expect(imported).toHaveLength(2)
    const importedInputIds: string[] = []
    for (const row of imported) {
      const result = await dispatchPrescriptionOperation(adapter, 'ROUTINE_GET', {
        routineId: row.id,
      })
      const importedInput = result.revision.prescription.inputs[0]
      const importedActivity = result.revision.prescription.activities[0]
      if (!importedInput || !importedActivity) throw new Error('Incomplete imported prescription')
      importedInputIds.push(importedInput.id)
      expect(importedInput.id).not.toBe(inputId)
      expect(importedActivity.id).not.toBe(activityId)
      expect(importedActivity.sets[0]?.id).not.toBe(setId)
      expect(result.revision.inputs).toEqual({ [importedInput.id]: 100 })
      expect(importedActivity.sets[0]?.weightKg).toMatchObject({
        resolvedValue: 90,
        rule: {
          source: 'load * 0.9',
          bindings: [{ variable: 'load', source: { kind: 'input', inputId: importedInput.id } }],
        },
      })
    }
    expect(new Set(importedInputIds).size).toBe(2)
  })

  it('reloads a resolved formula routine and preserves its source through session capture and recovery', async () => {
    const initial = prescription(90)
    initial.evaluatorVersion = 'cel-js-8.0.0-js-number-v1'
    const authoredSet = initial.activities[0]?.sets[0]
    if (!authoredSet) throw new Error('Missing formula fixture set')
    authoredSet.weightKg = {
      id: '88888888-8888-4888-8888-888888888888',
      rule: {
        kind: 'formula',
        source: '100 * 0.9',
        resultType: 'number',
        evaluatorVersion: initial.evaluatorVersion,
        bindings: [],
      },
    }
    const template = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
        name: 'Formula press',
        description: null,
        prescription: initial,
        now: NOW,
      }),
    )
    await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_SAVE', {
        id: routineId,
        name: 'Formula routine',
        templateId: template.templateId,
        templateRevisionId: template.id,
        inputs: {},
        continuationPolicy: 'calendar_bound',
        deferralMode: null,
        now: NOW,
      }),
    )
    const reloaded = await dispatchPrescriptionOperation(adapter, 'ROUTINE_GET', { routineId })
    expect(reloaded.revision.prescription.activities[0]?.sets[0]?.weightKg).toMatchObject({
      rule: { kind: 'formula', source: '100 * 0.9' },
      resolvedValue: 90,
    })
    await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_START', { id: workoutId, now: NOW, routineId }),
    )
    const recovered = await dispatchWorkout(adapter, 'WORKOUT_ACTIVE', {})
    expect(recovered).toMatchObject({
      sets: [expect.objectContaining({ weight_kg: 90, reps: 8, completed: 0 })],
    })
    const snapshot = db.query<{ prescription_json: string }>(
      'SELECT prescription_json FROM workout_intents WHERE workout_id=?',
      [workoutId],
    )[0]
    expect(JSON.parse(snapshot?.prescription_json ?? 'null')).toMatchObject({
      activities: [
        {
          sets: [
            {
              weightKg: {
                rule: { kind: 'formula', source: '100 * 0.9' },
                resolvedValue: 90,
              },
            },
          ],
        },
      ],
    })
  })

  it('starts a saved routine with immutable revision provenance and editable pending correspondence', async () => {
    const initial = prescription(42.5)
    const templateRevision = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
        name: 'Press',
        description: null,
        prescription: initial,
        now: NOW,
      }),
    )
    await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_SAVE', {
        id: routineId,
        name: 'Press A',
        templateId: templateRevision.templateId,
        templateRevisionId: templateRevision.id,
        inputs: {},
        fixedTargetValues: { '88888888-8888-4888-8888-888888888888': 50 },
        continuationPolicy: 'calendar_bound',
        deferralMode: null,
        now: NOW,
      }),
    )

    const session = await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_START', {
        id: workoutId,
        now: NOW,
        routineId,
        options: { sessionType: 'gym', intensityModifier: 0.5 },
      }),
    )
    expect(session).toMatchObject({
      workout: { id: workoutId, template_id: templateRevision.templateId },
    })
    expect(session).toMatchObject({
      sets: [expect.objectContaining({ weight_kg: 25, reps: 8, completed: 0 })],
    })
    const actual = db.query<SetRow>('SELECT * FROM sets')[0]
    if (!actual) throw new Error('Missing planned row')
    expect(session).toMatchObject({
      setIntents: { [actual.id]: { intentSetId: setId, weightKg: 25, exactReps: 8 } },
    })
    await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_SAVE_DRAFT', { set: { ...actual, weight_kg: 30 } }),
    )
    expect(await dispatchWorkout(adapter, 'WORKOUT_ACTIVE', {})).toMatchObject({
      sets: [expect.objectContaining({ id: actual.id, weight_kg: 30, completed: 0 })],
      setIntents: { [actual.id]: { weightKg: 25 } },
    })

    const nextPrescription = prescription(60)
    await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_EDIT', {
        templateId: templateRevision.templateId,
        expectedRevisionId: templateRevision.id,
        name: 'Press',
        description: null,
        prescription: nextPrescription,
        now: '2026-10-03T12:00:00.000Z',
      }),
    )
    const captured = db.query<{ prescription_json: string }>(
      'SELECT prescription_json FROM workout_intents WHERE workout_id=?',
      [workoutId],
    )[0]?.prescription_json
    expect(JSON.parse(captured ?? 'null')).toMatchObject({
      activities: [
        { sets: [{ weightKg: { rule: { kind: 'fixed', value: 50 }, resolvedValue: 25 } }] },
      ],
    })
    expect(() =>
      db.exec('UPDATE workout_intents SET captured_at=? WHERE workout_id=?', ['later', workoutId]),
    ).toThrow()
    await expect(
      dispatchWorkout(adapter, 'WORKOUT_START', {
        id: '99999999-9999-4999-8999-999999999999',
        now: NOW,
        routineId,
      }),
    ).rejects.toThrow(/unfinished session/i)
  })

  it('scales prescribed working rows without multiplying warm-ups or labeling prescribed repeats as extra', async () => {
    const initial = prescription(40)
    const activity = initial.activities[0]
    const working = activity?.sets[0]
    if (!activity || !working) throw new Error('Missing fixture activity')
    working.order = 2
    const warmup = {
      ...working,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      order: 1,
      role: 'warm_up' as const,
      weightKg: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        rule: { kind: 'fixed' as const, value: 20 },
      },
      reps: {
        kind: 'exact' as const,
        value: {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          rule: { kind: 'fixed' as const, value: 5 },
        },
      },
    }
    activity.sets = [warmup, working]
    const template = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
        name: 'Scaled press',
        description: null,
        prescription: initial,
        now: NOW,
      }),
    )
    await expect(
      adapter.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_START', {
          id: workoutId,
          now: NOW,
          templateId: template.templateId,
          options: { volumeModifier: 1001, expectedTemplateRevisionId: template.id },
        }),
      ),
    ).rejects.toThrow(/more than 1000 sets/)
    expect(await dispatchWorkout(adapter, 'WORKOUT_ACTIVE', {})).toBeNull()
    const started = await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_START', {
        id: workoutId,
        now: NOW,
        templateId: template.templateId,
        options: { volumeModifier: 2, expectedTemplateRevisionId: template.id },
      }),
    )
    const rows = db.query<SetRow>('SELECT * FROM sets ORDER BY set_num')
    expect(rows).toMatchObject([
      { set_num: 1, is_warmup: 1, weight_kg: 20, reps: 5, completed: 0 },
      { set_num: 2, is_warmup: 0, weight_kg: 40, reps: 8, completed: 0 },
      { set_num: 3, is_warmup: 0, weight_kg: 40, reps: 8, completed: 0 },
    ])
    const repeated = rows[2]
    if (!repeated) throw new Error('Missing prescribed repeat')
    expect(started).toMatchObject({
      setIntents: { [repeated.id]: { intentSetId: setId, role: 'working', weightKg: 40 } },
    })
  })

  it('backfills legacy actual modes once and preserves them across later reference edits and startup', async () => {
    db.exec('ALTER TABLE workout_exercises DROP COLUMN logging_mode')
    db.exec('UPDATE exercises SET logging_mode=? WHERE id=?', ['cardio', exerciseId])
    db.exec(
      'INSERT INTO workouts(id,date,started_at,ended_at,session_type,created_at) VALUES(?,?,?,?,?,?)',
      [workoutId, '2026-03-11', NOW, NOW, 'gym', NOW],
    )
    db.exec('INSERT INTO workout_exercises(id,workout_id,exercise_id,order_num) VALUES(?,?,?,?)', [
      'legacy-activity',
      workoutId,
      exerciseId,
      1,
    ])
    await adapter.transaction((tx) => migrateWorkout(tx))
    expect(db.query('SELECT logging_mode FROM workout_exercises')).toEqual([
      { logging_mode: 'cardio' },
    ])
    db.exec('UPDATE exercises SET logging_mode=? WHERE id=?', ['strength', exerciseId])
    await adapter.transaction((tx) => migrateWorkout(tx))
    expect(db.query('SELECT logging_mode FROM workout_exercises')).toEqual([
      { logging_mode: 'cardio' },
    ])
  })

  it.each(['cardio', 'distance'] as const)(
    'retains %s targets separately from achieved drafts and captured measurement eligibility',
    async (loggingMode) => {
      const initial = prescription(0)
      const activity = initial.activities[0]
      if (!activity) throw new Error('Missing fixture activity')
      activity.loggingMode = loggingMode
      activity.sets = []
      activity.targets = {
        durationSec: { id: targetId, rule: { kind: 'fixed', value: 90.5 } },
        distanceM: {
          id: '88888888-8888-4888-8888-888888888888',
          rule: { kind: 'fixed', value: 400 },
        },
      }
      const template = await adapter.transaction((tx) =>
        dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
          name: 'Intervals',
          description: null,
          prescription: initial,
          now: NOW,
        }),
      )
      await adapter.transaction((tx) =>
        dispatchPrescriptionOperation(tx, 'ROUTINE_SAVE', {
          id: routineId,
          name: 'Intervals A',
          templateId: template.templateId,
          templateRevisionId: template.id,
          inputs: {},
          continuationPolicy: 'calendar_bound',
          deferralMode: null,
          now: NOW,
        }),
      )
      const started = await adapter.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_START', {
          id: workoutId,
          now: NOW,
          routineId,
          options: { sessionType: 'gym' },
        }),
      )
      expect(started.exercises[0]).toMatchObject({ logging_mode: loggingMode })
      db.exec('UPDATE exercises SET logging_mode=? WHERE id=?', ['strength', exerciseId])
      const draft = db.query<SetRow>(
        'SELECT s.* FROM sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id WHERE e.workout_id=?',
        [workoutId],
      )[0]
      if (!draft) throw new Error('Non-strength activity must have a durable row')
      expect(draft).toMatchObject({
        distance_m: 400,
        duration_sec: 90.5,
        completed: 0,
        rpe: null,
        rir: null,
      })
      expect(started).toMatchObject({
        activityIntents: {
          [draft.workout_exercise_id]: {
            intentActivityId: activityId,
            loggingMode,
            distanceM: 400,
            durationSec: 90.5,
          },
        },
      })
      await adapter.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_SAVE_DRAFT', {
          set: { ...draft, distance_m: 350, duration_sec: 100.25 },
        }),
      )
      const recovered = await dispatchWorkout(adapter, 'WORKOUT_ACTIVE', {})
      expect(recovered).toMatchObject({
        sets: [
          expect.objectContaining({
            id: draft.id,
            distance_m: 350,
            duration_sec: 100.25,
            completed: 0,
          }),
        ],
        activityIntents: { [draft.workout_exercise_id]: { distanceM: 400, durationSec: 90.5 } },
      })
      await adapter.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_LOG_SET', {
          set: { ...draft, distance_m: 350, duration_sec: 100.25, completed: 1, logged_at: NOW },
        }),
      )
      await adapter.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_UNDO_SET', { setId: draft.id }),
      )
      expect(await dispatchWorkout(adapter, 'WORKOUT_ACTIVE', {})).toMatchObject({
        sets: [
          expect.objectContaining({
            id: draft.id,
            distance_m: 350,
            duration_sec: 100.25,
            completed: 0,
          }),
        ],
      })
      await adapter.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_LOG_SET', {
          set: { ...draft, distance_m: 350, duration_sec: 100.25, completed: 1, logged_at: NOW },
        }),
      )
      expect(
        await adapter.transaction((tx) =>
          dispatchWorkout(tx, 'WORKOUT_FINISH', { workoutId, endedAt: NOW, options: {} }),
        ),
      ).toMatchObject({ totalSets: 0, totalVolume: 0, newPRs: [] })
      expect(db.query('SELECT id FROM personal_records')).toEqual([])
      expect(
        await dispatchOrganization(adapter, 'ORGANIZATION_CREDIT_PREVIEW', { workoutId }),
      ).toMatchObject({ qualifies: true })
      const workoutDate = db.query<{ date: string }>('SELECT date FROM workouts WHERE id=?', [
        workoutId,
      ])[0]?.date
      if (!workoutDate) throw new Error('Missing finished workout date')
      expect(
        await dispatchOrganization(adapter, 'ORGANIZATION_REPORT', {
          startDate: workoutDate,
          endDate: workoutDate,
          today: workoutDate,
        }),
      ).toMatchObject({
        workingSets: 0,
        activities: [{ mode: loggingMode, distanceM: 350, durationSec: 100.25, items: 1 }],
        exerciseTonnage: [],
      })
    },
  )

  it('captures one-off configured values and rolls back a start with missing required inputs', async () => {
    const initial = prescription(0)
    const inputId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    initial.inputs = [
      {
        id: inputId,
        name: 'Working load',
        field: 'weightKg',
        required: true,
        defaultValue: null,
        minimum: 0,
        maximum: 200,
        integer: false,
      },
    ]
    const set = initial.activities[0]?.sets[0]
    if (!set?.weightKg) throw new Error('Missing fixture target')
    set.weightKg.rule = { kind: 'input', inputId }
    const template = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
        name: 'One-off press',
        description: null,
        prescription: initial,
        now: NOW,
      }),
    )
    await expect(
      adapter.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_START', {
          id: workoutId,
          now: NOW,
          templateId: template.templateId,
        }),
      ),
    ).rejects.toThrow(/input|required/i)
    expect(await dispatchWorkout(adapter, 'WORKOUT_ACTIVE', {})).toBeNull()
    if (set.reps?.kind !== 'exact') throw new Error('Missing fixture repetitions')
    set.reps.value.rule = { kind: 'fixed', value: 10 }
    const updated = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_EDIT', {
        templateId: template.templateId,
        expectedRevisionId: template.id,
        name: 'Updated one-off press',
        description: null,
        prescription: initial,
        now: NOW,
      }),
    )
    await expect(
      adapter.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_START', {
          id: workoutId,
          now: NOW,
          templateId: template.templateId,
          options: { expectedTemplateRevisionId: template.id, inputs: { [inputId]: 64.25 } },
        }),
      ),
    ).rejects.toThrow(/changed after preview/i)
    expect(await dispatchWorkout(adapter, 'WORKOUT_ACTIVE', {})).toBeNull()
    const started = await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_START', {
        id: workoutId,
        now: NOW,
        templateId: template.templateId,
        options: { expectedTemplateRevisionId: updated.id, inputs: { [inputId]: 64.25 } },
      }),
    )
    expect(started).toMatchObject({
      sets: [expect.objectContaining({ weight_kg: 64.25, reps: 10, completed: 0 })],
    })
    const intent = db.query<{ inputs_json: string }>(
      'SELECT inputs_json FROM workout_intents WHERE workout_id=?',
      [workoutId],
    )[0]
    expect(JSON.parse(intent?.inputs_json ?? '{}')).toEqual({ [inputId]: 64.25 })
  })

  it('persists freestyle sessions as known-absent intent rather than unavailable history', async () => {
    await dispatchWorkout(adapter, 'WORKOUT_START', { id: workoutId, now: NOW })
    expect(
      db.query<{ availability: string; provenance_json: string }>(
        'SELECT availability,provenance_json FROM workout_intents WHERE workout_id=?',
        [workoutId],
      )[0],
    ).toMatchObject({ availability: 'absent' })
  })

  it('rejects stale template-adoption reviews without appending a routine revision', async () => {
    const initial = prescription(42.5)
    const template = await dispatchPrescriptionOperation(adapter, 'TEMPLATE_CREATE', {
      name: 'Press',
      description: null,
      prescription: initial,
      now: NOW,
    })
    await dispatchPrescriptionOperation(adapter, 'ROUTINE_SAVE', {
      id: routineId,
      name: 'Press A',
      templateId: template.templateId,
      templateRevisionId: template.id,
      inputs: {},
      continuationPolicy: 'calendar_bound',
      deferralMode: null,
      now: NOW,
    })
    const review = await dispatchPrescriptionOperation(
      adapter,
      'ROUTINE_PREVIEW_TEMPLATE_ADOPTION',
      {
        routineId,
        templateRevisionId: template.id,
      },
    )
    const edited = prescription(60)
    await dispatchPrescriptionOperation(adapter, 'TEMPLATE_EDIT', {
      templateId: template.templateId,
      expectedRevisionId: template.id,
      name: 'Press',
      description: null,
      prescription: edited,
      now: '2026-10-03T12:00:00.000Z',
    })
    await expect(
      dispatchPrescriptionOperation(adapter, 'ROUTINE_APPLY_TEMPLATE_ADOPTION', {
        previewId: review.previewId,
      }),
    ).rejects.toThrow(/changed/i)
    expect(
      db.query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM routine_revisions WHERE routine_id=?',
        [routineId],
      )[0]?.count,
    ).toBe(1)
  })

  it('rolls back revision writes and keeps repeated domain migration idempotent', async () => {
    await expect(
      adapter.transaction(async (tx) => {
        await dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
          name: 'Press',
          description: null,
          prescription: prescription(42.5),
          now: NOW,
        })
        throw new Error('abort transaction')
      }),
    ).rejects.toThrow('abort transaction')
    expect(db.query<{ count: number }>('SELECT COUNT(*) AS count FROM templates')[0]?.count).toBe(0)
    expect(
      db.query<{ count: number }>('SELECT COUNT(*) AS count FROM template_revisions')[0]?.count,
    ).toBe(0)

    const template = await dispatchPrescriptionOperation(adapter, 'TEMPLATE_CREATE', {
      name: 'Press',
      description: null,
      prescription: prescription(42.5),
      now: NOW,
    })
    await migratePrescriptionDomain(adapter)
    await migratePrescriptionDomain(adapter)
    expect(
      db.query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM template_revisions WHERE template_id=?',
        [template.templateId],
      )[0]?.count,
    ).toBe(1)
  })
})
