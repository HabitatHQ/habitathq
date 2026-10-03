import type { DbAdapter } from '@palladium/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migratePrescriptionDomain } from '../../app/lib/prescription-storage'
import { migrateWorkout } from '../../app/lib/workout-schema'
import type { SerializablePrescription } from '../../app/types/prescription'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW } from './helpers/db'

const templateId = '11111111-1111-4111-8111-111111111111'
const exerciseId = '22222222-2222-4222-8222-222222222222'
const pyramidExerciseRowId = '33333333-3333-4333-8333-333333333333'
const dropExerciseRowId = '44444444-4444-4444-8444-444444444444'

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

describe('legacy prescription conversion', () => {
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
    db.exec(
      'INSERT INTO exercises (id,name,slug,equipment,movement,muscles,created_at) VALUES (?,?,?,?,?,?,?)',
      [exerciseId, 'Squat', 'legacy-convert-squat', 'barbell', 'squat', '[]', NOW],
    )
    db.exec('INSERT INTO templates (id,name,description,created_at) VALUES (?,?,?,?)', [
      templateId,
      'Legacy session',
      null,
      NOW,
    ])
    db.exec(
      `INSERT INTO template_exercises (id,template_id,exercise_id,order_num,sets_planned,reps_planned,rest_seconds,set_rest_seconds,warmup_counts,set_scheme,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        pyramidExerciseRowId,
        templateId,
        exerciseId,
        1,
        3,
        '8',
        120,
        null,
        1,
        JSON.stringify({
          type: 'pyramid_ascending',
          config: {
            type: 'ascending',
            steps: 3,
            startWeight: 40,
            weightStep: 5,
            stepType: 'absolute',
            repsPerStep: [10, 8, 6],
            restPerStep: [60, 90, 120],
          },
        }),
        'Keep the bar path consistent',
      ],
    )
    db.exec(
      `INSERT INTO template_exercises (id,template_id,exercise_id,order_num,sets_planned,reps_planned,rest_seconds,set_rest_seconds,warmup_counts,set_scheme,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        dropExerciseRowId,
        templateId,
        exerciseId,
        2,
        3,
        '8',
        120,
        null,
        0,
        JSON.stringify({
          type: 'drop_set',
          config: { drops: 2, dropType: 'percent', dropValue: 20 },
        }),
        null,
      ],
    )
    await migratePrescriptionDomain(adapter)
  })

  afterEach(() => db.close())

  it('converts ordered pyramid reps/rest and drop-set roles while retaining unknown loads and legacy provenance', () => {
    const row = db.query<{ prescription_json: string }>(
      'SELECT prescription_json FROM template_revisions WHERE template_id=?',
      [templateId],
    )[0]
    if (!row) throw new Error('Expected migrated legacy revision')
    const prescription = JSON.parse(row.prescription_json) as SerializablePrescription
    const [pyramid, drop] = prescription.activities
    expect(
      pyramid?.sets.map((set) => ({
        reps:
          set.reps?.kind === 'exact'
            ? set.reps.value.rule.kind === 'fixed'
              ? set.reps.value.rule.value
              : null
            : null,
        rest:
          set.restSec?.rule.kind === 'input'
            ? null
            : set.restSec?.rule.kind === 'fixed'
              ? set.restSec.rule.value
              : null,
      })),
    ).toEqual([
      { reps: 10, rest: 60 },
      { reps: 8, rest: 90 },
      { reps: 6, rest: 120 },
    ])
    expect(drop?.sets.map((set) => set.role)).toEqual(['top', 'back_off', 'back_off'])
    expect(pyramid?.sets[0]?.weightKg).toBeNull()
    expect(pyramid?.sets[0]?.legacyScheme).toContain('pyramid_ascending')
    expect(prescription.provenance.unresolvedFields).toContain('load_targets')
    expect(prescription.provenance.unresolvedFields).toContain('historical_set_roles')
  })
})
