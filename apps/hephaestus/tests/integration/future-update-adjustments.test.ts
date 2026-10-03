import type { DbAdapter } from '@palladium/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  dispatchPrescriptionOperation,
  migratePrescriptionDomain,
} from '../../app/lib/prescription-storage'
import { migrateWorkout } from '../../app/lib/workout-schema'
import { dispatchWorkout } from '../../app/lib/workout-storage'
import type { SetRow } from '../../app/types/database'
import type { SerializablePrescription, TemplateRevision } from '../../app/types/prescription'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW } from './helpers/db'

const routineId = '33333333-3333-4333-8333-333333333333'
const workoutId = '44444444-4444-4444-8444-444444444444'
const exerciseId = '11111111-1111-4111-8111-111111111111'
const activityId = '55555555-5555-4555-8555-555555555555'
const setId = '66666666-6666-4666-8666-666666666666'
const repsId = '77777777-7777-4777-8777-777777777777'
const weightId = '88888888-8888-4888-8888-888888888888'
const restId = '99999999-9999-4999-8999-999999999999'

function sqliteBindings(
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
    throw new Error('Test SQLite adapter received an unsupported bind value')
  })
}
function prescription(): SerializablePrescription {
  return {
    schemaVersion: 1,
    evaluatorVersion: 'cel-js-8.0.0-js-number-v1',
    provenance: {
      kind: 'authored',
      migratedAt: null,
      legacyTemplateId: null,
      unresolvedFields: [],
    },
    defaults: { incrementKg: 2.5, restSec: 90 },
    inputs: [],
    groups: [],
    activities: [
      {
        id: activityId,
        exerciseId,
        order: 1,
        loggingMode: 'strength',
        executionGroupId: null,
        notes: null,
        targets: { durationSec: null, distanceM: null },
        sets: [
          {
            id: setId,
            order: 1,
            role: 'working',
            reps: { kind: 'exact', value: { id: repsId, rule: { kind: 'fixed', value: 8 } } },
            weightKg: { id: weightId, rule: { kind: 'fixed', value: 50 } },
            restSec: { id: restId, rule: { kind: 'fixed', value: 90 } },
            rpe: null,
            rir: null,
            notes: null,
            legacyScheme: null,
          },
        ],
      },
    ],
  }
}

describe('future routine updates preserve unmodified session adjustments', () => {
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
      [exerciseId, 'Bench Press', 'future-update-bench', 'barbell', 'push', '[]', NOW],
    )
  })
  afterEach(() => db.close())

  async function startRoutine(
    value: SerializablePrescription,
    inputs: Record<string, number> = {},
  ) {
    const template = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
        name: 'Review prescription',
        description: null,
        prescription: value,
        now: NOW,
      }),
    )
    await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_SAVE', {
        id: routineId,
        name: 'Review routine',
        templateId: template.templateId,
        templateRevisionId: template.id,
        inputs,
        fixedTargetValues: {},
        continuationPolicy: 'calendar_bound',
        deferralMode: null,
        now: NOW,
      }),
    )
    return adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_START', {
        id: workoutId,
        routineId,
        now: NOW,
        options: { sessionType: 'gym' },
      }),
    )
  }

  it('offers explicit unchanged inputs for formula updates without inferring inverse formulas', async () => {
    const value = prescription()
    const plannedSet = value.activities[0]?.sets[0]
    if (!plannedSet) throw new Error('Expected working set')
    const inputId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    value.inputs = [
      {
        id: inputId,
        name: 'Working load',
        field: 'weightKg',
        required: true,
        defaultValue: 100,
        minimum: 0,
        maximum: 500,
        integer: false,
      },
    ]
    plannedSet.weightKg = {
      id: weightId,
      rule: {
        kind: 'formula',
        source: 'base * 0.9',
        resultType: 'number',
        evaluatorVersion: value.evaluatorVersion,
        bindings: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            variable: 'base',
            source: { kind: 'input', inputId },
          },
        ],
      },
    }
    const started = await startRoutine(value, { [inputId]: 100 })
    const pending = started.sets[0]
    if (!pending) throw new Error('Expected pending set')
    await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_LOG_SET', {
        set: { ...pending, weight_kg: 80, completed: 1, logged_at: NOW },
      }),
    )
    const preview = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_PREVIEW_FUTURE_UPDATE', { workoutId }),
    )
    expect(preview?.candidates).toEqual([
      expect.objectContaining({
        id: inputId,
        kind: 'input',
        capturedValue: 100,
        actualValue: null,
        currentValue: 100,
        proposedValue: 100,
      }),
    ])
    if (!preview) throw new Error('Expected input review')
    const updated = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_APPLY_FUTURE_UPDATE', {
        previewId: preview.previewId,
        selectedValues: { [inputId]: 105 },
      }),
    )
    expect(updated.inputs[inputId]).toBe(105)
    expect(updated.prescription.activities[0]?.sets[0]?.weightKg?.resolvedValue).toBe(94.5)
    expect(updated.prescription.activities[0]?.sets[0]?.weightKg?.rule).toEqual(
      plannedSet.weightKg.rule,
    )
    expect(
      db.query<{ weight_kg: number }>('SELECT weight_kg FROM sets WHERE id=?', [pending.id])[0]
        ?.weight_kg,
    ).toBe(80)
  })

  it('reviews completed non-strength duration and distance against captured activity targets', async () => {
    const value = prescription()
    const activity = value.activities[0]
    const plannedSet = activity?.sets[0]
    if (!activity || !plannedSet) throw new Error('Expected activity')
    activity.loggingMode = 'cardio'
    activity.targets = {
      durationSec: { id: restId, rule: { kind: 'fixed', value: 600 } },
      distanceM: { id: weightId, rule: { kind: 'fixed', value: 1500 } },
    }
    plannedSet.reps = null
    plannedSet.weightKg = null
    plannedSet.restSec = null
    const started = await startRoutine(value)
    const pending = started.sets[0]
    if (!pending) throw new Error('Expected pending activity')
    await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_LOG_SET', {
        set: { ...pending, duration_sec: 660, distance_m: 1600, completed: 1, logged_at: NOW },
      }),
    )
    const preview = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_PREVIEW_FUTURE_UPDATE', { workoutId }),
    )
    expect(preview?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: restId,
          capturedValue: 600,
          actualValue: 660,
          proposedValue: 660,
        }),
        expect.objectContaining({
          id: weightId,
          capturedValue: 1500,
          actualValue: 1600,
          proposedValue: 1600,
        }),
      ]),
    )
    if (!preview) throw new Error('Expected activity review')
    const updated = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_APPLY_FUTURE_UPDATE', {
        previewId: preview.previewId,
        selectedValues: { [restId]: 660 },
      }),
    )
    expect(updated.prescription.activities[0]?.targets.durationSec?.resolvedValue).toBe(660)
    expect(updated.prescription.activities[0]?.targets.distanceM?.resolvedValue).toBe(1500)
  })

  it('reviews achieved exact reps separately from a formula load without rewriting the formula or captured intent', async () => {
    const value = prescription()
    const plannedSet = value.activities[0]?.sets[0]
    if (!plannedSet) throw new Error('Expected planned working set')
    const formula: NonNullable<typeof plannedSet.weightKg>['rule'] = {
      kind: 'formula',
      source: '100 * 0.9',
      resultType: 'number',
      evaluatorVersion: value.evaluatorVersion,
      bindings: [],
    }
    plannedSet.weightKg = { id: weightId, rule: formula }
    const template = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
        name: 'Formula press',
        description: null,
        prescription: value,
        now: NOW,
      }),
    )
    await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_SAVE', {
        id: routineId,
        name: 'Formula press A',
        templateId: template.templateId,
        templateRevisionId: template.id,
        inputs: {},
        fixedTargetValues: {},
        continuationPolicy: 'calendar_bound',
        deferralMode: null,
        now: NOW,
      }),
    )
    const started = await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_START', {
        id: workoutId,
        routineId,
        now: NOW,
        options: { sessionType: 'gym' },
      }),
    )
    const pending = started.sets[0]
    if (!pending) throw new Error('Expected pending set')
    const captured = db.query<{ prescription_json: string }>(
      'SELECT prescription_json FROM workout_intents WHERE workout_id=?',
      [workoutId],
    )[0]?.prescription_json
    await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_LOG_SET', {
        set: { ...pending, weight_kg: 92.5, reps: 7, completed: 1, logged_at: NOW },
      }),
    )
    const preview = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_PREVIEW_FUTURE_UPDATE', { workoutId }),
    )
    expect(preview?.candidates).toEqual([
      expect.objectContaining({
        id: repsId,
        capturedValue: 8,
        actualValue: 7,
        currentValue: 8,
        proposedValue: 7,
      }),
    ])
    if (!preview) throw new Error('Expected future-update review')
    const updated = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_APPLY_FUTURE_UPDATE', {
        previewId: preview.previewId,
        selectedValues: { [repsId]: 7 },
      }),
    )
    expect(updated.prescription.activities[0]?.sets[0]?.reps).toEqual({
      kind: 'exact',
      value: { id: repsId, rule: { kind: 'fixed', value: 7 }, resolvedValue: 7 },
    })
    expect(updated.prescription.activities[0]?.sets[0]?.weightKg?.rule).toEqual(formula)
    expect(
      db.query<{ prescription_json: string }>(
        'SELECT prescription_json FROM workout_intents WHERE workout_id=?',
        [workoutId],
      )[0]?.prescription_json,
    ).toBe(captured)
  })

  it('normalizes intensity, excludes ambiguous targets, rejects stale reviews, and preserves unrelated later edits', async () => {
    const template = (await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
        name: 'Press',
        description: null,
        prescription: prescription(),
        now: NOW,
      }),
    )) as TemplateRevision
    const routineRevision = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_SAVE', {
        id: routineId,
        name: 'Press A',
        templateId: template.templateId,
        templateRevisionId: template.id,
        inputs: {},
        fixedTargetValues: { [weightId]: 50, [restId]: 90 },
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
        options: { sessionType: 'gym', intensityModifier: 0.5 },
      }),
    )
    const pending = started.sets[0]
    if (!pending) throw new Error('Expected prescribed working set')
    await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_EDIT', {
        routineId,
        expectedRevisionId: routineRevision.id,
        inputs: {},
        fixedTargetValues: { [weightId]: 50, [restId]: 180 },
        now: '2026-10-03T12:00:00.000Z',
      }),
    )
    await adapter.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_LOG_SET', {
        set: { ...pending, weight_kg: 30, completed: 1, logged_at: NOW } as SetRow,
      }),
    )
    const repeatedSetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    db.exec(
      'INSERT INTO sets (id,workout_exercise_id,set_num,weight_kg,reps,completed,logged_at) SELECT ?,workout_exercise_id,2,weight_kg,reps,0,NULL FROM sets WHERE id=?',
      [repeatedSetId, pending.id],
    )
    db.exec(
      'INSERT INTO workout_intent_sets (set_id,intent_set_id,target_snapshot_json) SELECT ?,intent_set_id,target_snapshot_json FROM workout_intent_sets WHERE set_id=?',
      [repeatedSetId, pending.id],
    )
    db.exec('UPDATE sets SET weight_kg=?,completed=1,logged_at=? WHERE id=?', [
      32,
      NOW,
      repeatedSetId,
    ])
    const ambiguousPreview = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_PREVIEW_FUTURE_UPDATE', { workoutId }),
    )
    expect(ambiguousPreview?.candidates).not.toContainEqual(
      expect.objectContaining({ id: weightId }),
    )
    db.exec('UPDATE sets SET weight_kg=? WHERE id=?', [30, repeatedSetId])
    const preview = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_PREVIEW_FUTURE_UPDATE', { workoutId }),
    )
    expect(preview?.ambiguities).toEqual([])

    expect(preview?.candidates).toContainEqual(
      expect.objectContaining({
        id: weightId,
        capturedValue: 50,
        actualValue: 60,
        currentValue: 50,
        proposedValue: 60,
      }),
    )
    expect(preview?.candidates).not.toContainEqual(expect.objectContaining({ id: restId }))
    if (!preview) throw new Error('Expected future-update review')
    const concurrentRevision = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_EDIT', {
        routineId,
        expectedRevisionId: preview.currentRoutineRevisionId,
        inputs: {},
        fixedTargetValues: { [weightId]: 50, [restId]: 210 },
        now: '2026-10-03T13:00:00.000Z',
      }),
    )
    await expect(
      adapter.transaction((tx) =>
        dispatchPrescriptionOperation(tx, 'ROUTINE_APPLY_FUTURE_UPDATE', {
          previewId: preview.previewId,
          selectedValues: { [weightId]: 60 },
        }),
      ),
    ).rejects.toThrow(/changed/i)
    const unchanged = await dispatchPrescriptionOperation(adapter, 'ROUTINE_GET', { routineId })
    expect(unchanged.revision.id).toBe(concurrentRevision.id)
    const refreshed = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_PREVIEW_FUTURE_UPDATE', { workoutId }),
    )
    if (!refreshed) throw new Error('Expected refreshed future-update review')
    const updated = await adapter.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'ROUTINE_APPLY_FUTURE_UPDATE', {
        previewId: refreshed.previewId,
        selectedValues: { [weightId]: 60 },
      }),
    )
    const set = updated.prescription.activities[0]?.sets[0]
    expect(set?.weightKg?.rule).toEqual({ kind: 'fixed', value: 60 })
    expect(set?.restSec?.rule).toEqual({ kind: 'fixed', value: 210 })
  })
})
