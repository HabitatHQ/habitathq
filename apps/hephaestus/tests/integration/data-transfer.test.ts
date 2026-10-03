import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupEnvelope,
  dispatchTransfer,
} from '~/lib/data-transfer'
import { structuralFingerprint } from '~/lib/prescription-domain'
import { migrateHistoryCorrection } from '~/lib/workout-schema'
import type { DbAdapter } from '~/types/database'
import type { TestDb } from './helpers/db'
import { createTestDb } from './helpers/db'

const settings = {
  theme: 'forge',
  weightUnit: 'kg',
  distanceUnit: 'km',
  use24HourTime: false,
  reduceMotion: false,
  defaultRestSeconds: 120,
  showRpe: true,
  showRir: false,
  warmupRamps: [40, 60, 80],
  showWarmupSuggestions: true,
  showFailurePrompt: true,
  showSessionNotes: true,
  showSetSchemes: false,
  showVariableRest: false,
  showSupersets: false,
}

function adapterFor(db: TestDb): DbAdapter {
  return {
    async queryAll<T>(sql, bind) {
      return db.query<T>(sql, bind as (string | number | null)[] | undefined)
    },
    async queryOne<T>(sql, bind) {
      return db.query<T>(sql, bind as (string | number | null)[] | undefined)[0] ?? null
    },
    async exec(sql, bind) {
      db.exec(sql, bind as (string | number | null)[] | undefined)
    },
    async transaction(fn) {
      db.exec('BEGIN')
      try {
        const result = await fn(adapterFor(db))
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

async function insertWorkout(db: TestDb, notes: string) {
  db.exec(
    `INSERT INTO workouts (id, date, started_at, ended_at, session_type, created_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'workout-1',
      '2026-10-02',
      '2026-10-02T09:00:00Z',
      '2026-10-02T10:00:00Z',
      'gym',
      '2026-10-02T09:00:00Z',
      notes,
    ],
  )
}

async function assertRestoreRollback(db: DbAdapter, raw: TestDb, backup: BackupEnvelope) {
  raw.exec("UPDATE workouts SET notes='new local edit' WHERE id='workout-1'")
  raw.exec(
    "CREATE TRIGGER reject_restored_workout BEFORE INSERT ON workouts BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END",
  )
  await expect(dispatchTransfer(db, 'TRANSFER_RESTORE_BACKUP', { backup })).rejects.toThrow(
    'injected restore failure',
  )
  expect(raw.query<{ notes: string }>("SELECT notes FROM workouts WHERE id='workout-1'")).toEqual([
    { notes: 'new local edit' },
  ])
  expect(
    raw.query<{ week_start: string }>(
      "SELECT week_start FROM organization_goal_credits WHERE goal_id='goal-1'",
    ),
  ).toEqual([{ week_start: '2026-09-28' }])
  raw.exec('DROP TRIGGER reject_restored_workout')
}

describe('database transfer', () => {
  it('round-trips all discovered app tables and preserves settings', async () => {
    const testDb = await createTestDb()
    try {
      const db = adapterFor(testDb)
      await migrateHistoryCorrection(db)
      testDb.exec('CREATE TABLE future_durable (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
      testDb.exec("INSERT INTO future_durable VALUES ('future-1', 'portable ✓')")
      await insertWorkout(testDb, 'original')
      testDb.exec(
        `INSERT INTO workouts (id, date, started_at, ended_at, session_type, created_at, notes)
         VALUES ('workout-draft', '2026-10-03', '2026-10-03T09:00:00Z', NULL, 'gym', '2026-10-03T09:00:00Z', 'draft')`,
      )
      testDb.exec(
        'INSERT INTO workout_finish_summaries (workout_id, summary_json) VALUES (\'workout-1\', \'{"note":"summary"}\')',
      )
      testDb.exec(
        "INSERT INTO workout_session_options (workout_id, intensity_modifier, volume_modifier) VALUES ('workout-1', 1.25, 0.75)",
      )
      testDb.exec(
        "INSERT INTO history_correction_previews (id, workout_id, fingerprint, snapshot_json, created_at) VALUES ('preview-1', 'workout-1', 'fingerprint', '{\"version\":1}', '2026-10-02T10:00:00Z')",
      )
      testDb.exec(
        "INSERT INTO history_corrections (id, workout_id, base_version, operation_json, applied_at) VALUES ('correction-1', 'workout-1', 1, '{\"kind\":\"replace\"}', '2026-10-02T10:01:00Z')",
      )
      testDb.exec(
        "INSERT INTO training_plans (id, name, start_local_date, created_at, updated_at) VALUES ('plan-1', 'Plan', '2026-10-02', '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z')",
      )
      testDb.exec(
        "INSERT INTO organization_goals (id, plan_id, name, target_count, filter_json, active, created_at) VALUES ('goal-1', 'plan-1', 'Weekly goal', 3, '{}', 1, '2026-10-02T00:00:00Z')",
      )
      testDb.exec(
        "INSERT INTO organization_goal_credits (goal_id, workout_id, week_start) VALUES ('goal-1', 'workout-1', '2026-09-28')",
      )
      const backup = (await dispatchTransfer(db, 'TRANSFER_EXPORT_BACKUP', {
        settings,
      })) as BackupEnvelope
      expect(backup.format).toBe(BACKUP_FORMAT)
      expect(backup.version).toBe(BACKUP_VERSION)
      expect(backup.tables['workouts']?.rows).toHaveLength(2)
      expect(backup.settings).toEqual(settings)
      const appTables = testDb
        .query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .map((row) => row.name)
        .filter(
          (name) =>
            !['sqlite_', '_palladium', 'palladium_', '_sync_'].some((prefix) =>
              name.startsWith(prefix),
            ),
        )
      expect(Object.keys(backup.tables)).toEqual(appTables)
      expect(backup.tables['future_durable']?.rows).toEqual([
        { id: 'future-1', value: 'portable ✓' },
      ])
      await assertRestoreRollback(db, testDb, backup)
      testDb.exec('DELETE FROM future_durable')
      testDb.exec('DELETE FROM workouts')
      expect(await dispatchTransfer(db, 'TRANSFER_PREVIEW_RESTORE', { backup })).toMatchObject({
        valid: true,
        workoutCount: 2,
        planCount: 1,
      })
      await dispatchTransfer(db, 'TRANSFER_RESTORE_BACKUP', { backup })
      expect(
        testDb.query<{ notes: string }>('SELECT notes FROM workouts WHERE id = ?', ['workout-1']),
      ).toEqual([{ notes: 'original' }])
      expect(
        testDb.query<{ id: string; ended_at: string | null }>(
          "SELECT id, ended_at FROM workouts WHERE id = 'workout-draft'",
        ),
      ).toEqual([{ id: 'workout-draft', ended_at: null }])
      expect(
        testDb.query<{ summary_json: string }>(
          "SELECT summary_json FROM workout_finish_summaries WHERE workout_id = 'workout-1'",
        ),
      ).toEqual([{ summary_json: '{"note":"summary"}' }])
      expect(
        testDb.query<{ operation_json: string }>(
          "SELECT operation_json FROM history_corrections WHERE id = 'correction-1'",
        ),
      ).toEqual([{ operation_json: '{"kind":"replace"}' }])
      expect(
        testDb.query<{ week_start: string }>(
          "SELECT week_start FROM organization_goal_credits WHERE goal_id = 'goal-1' AND workout_id = 'workout-1'",
        ),
      ).toEqual([{ week_start: '2026-09-28' }])
      expect(testDb.query<{ value: string }>('SELECT value FROM future_durable')).toEqual([
        { value: 'portable ✓' },
      ])
    } finally {
      testDb.close()
    }
  })
  it('restores a version-1 partial backup additively into non-empty local data', async () => {
    const source = await createTestDb()
    const destination = await createTestDb()
    try {
      await insertWorkout(source, 'from legacy backup')
      const full = (await dispatchTransfer(adapterFor(source), 'TRANSFER_EXPORT_BACKUP', {
        settings,
      })) as BackupEnvelope
      const legacy = structuredClone(full)
      const workoutsTable = full.tables['workouts']
      if (!workoutsTable) throw new Error('Test backup has no workouts table')
      legacy.version = 1
      legacy.tables = { workouts: workoutsTable }
      destination.exec(
        `INSERT INTO workouts (id, date, started_at, ended_at, session_type, created_at, notes)
         VALUES ('keep-workout', '2026-10-01', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z', 'gym', '2026-10-01T09:00:00Z', 'keep')`,
      )
      const db = adapterFor(destination)
      expect(
        await dispatchTransfer(db, 'TRANSFER_PREVIEW_RESTORE', { backup: legacy }),
      ).toMatchObject({ valid: true, legacy: true, restoreMode: 'additive' })
      await dispatchTransfer(db, 'TRANSFER_RESTORE_BACKUP', { backup: legacy })
      expect(
        destination.query<{ id: string; notes: string }>(
          'SELECT id, notes FROM workouts ORDER BY id',
        ),
      ).toEqual([
        { id: 'keep-workout', notes: 'keep' },
        { id: 'workout-1', notes: 'from legacy backup' },
      ])
    } finally {
      source.close()
      destination.close()
    }
  })

  it('rejects malformed backup before mutation and rolls back a validly shaped constraint failure', async () => {
    const testDb = await createTestDb()
    try {
      const db = adapterFor(testDb)
      await insertWorkout(testDb, 'keep me')
      const backup = (await dispatchTransfer(db, 'TRANSFER_EXPORT_BACKUP', {
        settings,
      })) as BackupEnvelope
      const invalid = { ...backup, version: 99 }
      await expect(
        dispatchTransfer(db, 'TRANSFER_RESTORE_BACKUP', { backup: invalid }),
      ).rejects.toThrow('Unsupported')
      expect(testDb.query<{ notes: string }>('SELECT notes FROM workouts')).toEqual([
        { notes: 'keep me' },
      ])

      const incomplete = structuredClone(backup)
      const workoutTable = incomplete.tables['workouts']
      if (!workoutTable) throw new Error('Test backup has no workouts table')
      workoutTable.columns = workoutTable.columns.filter((column) => column !== 'notes')
      for (const row of workoutTable.rows) delete row['notes']
      await expect(
        dispatchTransfer(db, 'TRANSFER_RESTORE_BACKUP', { backup: incomplete }),
      ).rejects.toThrow('complete supported schema')
      expect(testDb.query<{ notes: string }>('SELECT notes FROM workouts')).toEqual([
        { notes: 'keep me' },
      ])

      const changed = structuredClone(backup)
      const workoutRows = changed.tables['workouts']?.rows
      if (!workoutRows?.[0]) throw new Error('Test backup has no workout row')
      workoutRows[0]['session_type'] = null
      await expect(
        dispatchTransfer(db, 'TRANSFER_RESTORE_BACKUP', { backup: changed }),
      ).rejects.toThrow()
      expect(testDb.query<{ notes: string }>('SELECT notes FROM workouts')).toEqual([
        { notes: 'keep me' },
      ])
    } finally {
      testDb.close()
    }
  })

  it('preflights and atomically imports a portable template/program bundle with its custom exercise profile', async () => {
    const source = await createTestDb()
    const destination = await createTestDb()
    try {
      source.exec(
        `INSERT INTO exercises (id, name, slug, equipment, movement, is_custom, created_at)
         VALUES ('custom-ex-1', 'Cable Press', 'cable-press', 'cable', 'push', 1, '2026-10-02T00:00:00Z')`,
      )
      source.exec(
        `INSERT INTO templates (id, name, description, created_at)
         VALUES ('portable-tpl-1', 'Portable A', 'Description', '2026-10-02T00:00:00Z')`,
      )
      source.exec(
        `INSERT INTO template_groups (id, template_id, label, group_type)
         VALUES ('portable-group-1', 'portable-tpl-1', 'group-1', 'superset')`,
      )
      source.exec(
        `INSERT INTO template_exercises (id, template_id, exercise_id, order_num, superset_group, sets_planned)
         VALUES ('portable-te-1', 'portable-tpl-1', 'custom-ex-1', 1, 'group-1', 3)`,
      )
      source.exec(
        `INSERT INTO equipment_profiles (exercise_id, minimum_kg, increment_kg, updated_at)
         VALUES ('custom-ex-1', 1, 0.5, '2026-10-02T00:00:00Z')`,
      )
      source.exec(
        `INSERT INTO programs (id, name, weeks, created_at, is_builtin)
         VALUES ('portable-program-1', 'Portable Program', 1, '2026-10-02T00:00:00Z', 0)`,
      )
      const design = {
        schemaVersion: 1,
        weeks: 1,
        weekProgression: [],
        slots: [
          {
            id: 'portable-slot-1',
            week: 1,
            day: 1,
            templateId: 'portable-tpl-1',
            templateRevisionId: null,
            assignmentResolved: true,
            label: null,
            progression: {
              intensityModifier: 1,
              volumeModifier: 1,
              isDeload: false,
              phase: null,
              legacyCurrentWeek: null,
            },
          },
        ],
      }
      const structureHash = structuralFingerprint({
        schemaVersion: 1,
        evaluatorVersion: 'program-v1',
        inputs: [],
        defaults: { incrementKg: 1, restSec: 0 },
        groups: [],
        activities: [
          {
            id: 'portable-slot-1',
            exerciseId: 'portable-tpl-1',
            order: 1,
            loggingMode: 'strength',
            executionGroupId: null,
            sets: [],
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
      })
      source.exec(
        `INSERT INTO program_revisions (id, program_id, revision_num, design_json, structure_hash, created_at)
         VALUES (?, ?, 1, ?, ?, ?)`,
        [
          'portable-program-rev-1',
          'portable-program-1',
          JSON.stringify(design),
          structureHash,
          '2026-10-02T00:00:00Z',
        ],
      )
      source.exec(
        `INSERT INTO program_weeks (id, program_id, week_num) VALUES ('portable-week-1', 'portable-program-1', 1)`,
      )
      source.exec(
        `INSERT INTO program_days (id, week_id, day_num, template_id, label)
         VALUES ('portable-day-1', 'portable-week-1', 1, 'portable-tpl-1', 'A')`,
      )
      const sourceAdapter = adapterFor(source)
      const destinationAdapter = adapterFor(destination)
      const bundle = (await dispatchTransfer(sourceAdapter, 'TRANSFER_EXPORT_PORTABLE', {})) as {
        tables: Record<string, Array<Record<string, unknown>>>
      }
      expect(bundle.tables['exercises']).toHaveLength(1)
      expect(bundle.tables['equipment_profiles']).toHaveLength(1)
      expect(bundle.tables['programs']).toHaveLength(1)

      const missingField = structuredClone(bundle)
      const missingNameTemplate = missingField.tables['templates']?.[0]
      if (!missingNameTemplate) throw new Error('Portable bundle has no template')
      delete missingNameTemplate['name']
      await expect(
        dispatchTransfer(destinationAdapter, 'TRANSFER_IMPORT_PORTABLE', { bundle: missingField }),
      ).rejects.toThrow('missing required content')
      expect(destination.query<{ id: string }>('SELECT id FROM templates')).toEqual([])

      const futureVersion = structuredClone(bundle)
      Object.assign(futureVersion, { version: 99 })
      expect(
        await dispatchTransfer(destinationAdapter, 'TRANSFER_PREVIEW_PORTABLE_IMPORT', {
          bundle: futureVersion,
        }),
      ).toMatchObject({ valid: false })
      await expect(
        dispatchTransfer(destinationAdapter, 'TRANSFER_IMPORT_PORTABLE', { bundle: futureVersion }),
      ).rejects.toThrow()
      expect(destination.query<{ id: string }>('SELECT id FROM templates')).toEqual([])
      const futureEvaluator = structuredClone(bundle)
      const programRevision = futureEvaluator.tables['program_revisions']?.[0]
      if (!programRevision) throw new Error('Portable bundle has no Program revision')
      programRevision['design_json'] = JSON.stringify({
        ...design,
        evaluatorVersion: 'program-v99',
      })
      expect(
        await dispatchTransfer(destinationAdapter, 'TRANSFER_PREVIEW_PORTABLE_IMPORT', {
          bundle: futureEvaluator,
        }),
      ).toMatchObject({ valid: false })
      await expect(
        dispatchTransfer(destinationAdapter, 'TRANSFER_IMPORT_PORTABLE', {
          bundle: futureEvaluator,
        }),
      ).rejects.toThrow()
      expect(destination.query<{ id: string }>('SELECT id FROM templates')).toEqual([])
      const malformed = structuredClone(bundle)
      const templateExercise = malformed.tables['template_exercises']?.[0]
      if (!templateExercise) throw new Error('Portable bundle has no template exercise')
      templateExercise['exercise_id'] = 'missing-exercise'
      await expect(
        dispatchTransfer(destinationAdapter, 'TRANSFER_IMPORT_PORTABLE', { bundle: malformed }),
      ).rejects.toThrow('missing template, exercise, group, deload template, or substitute')
      expect(destination.query<{ id: string }>('SELECT id FROM templates')).toEqual([])

      expect(
        await dispatchTransfer(destinationAdapter, 'TRANSFER_PREVIEW_PORTABLE_IMPORT', { bundle }),
      ).toMatchObject({ valid: true, templateCount: 1, programCount: 1 })
      await dispatchTransfer(destinationAdapter, 'TRANSFER_IMPORT_PORTABLE', { bundle })
      const importedTemplate = destination.query<{ id: string }>('SELECT id FROM templates')[0]?.id
      const importedProgram = destination.query<{ id: string }>('SELECT id FROM programs')[0]?.id
      const importedExercise = destination.query<{ id: string }>(
        "SELECT id FROM exercises WHERE slug = 'cable-press'",
      )[0]?.id
      expect(importedTemplate).not.toBe('portable-tpl-1')
      expect(importedProgram).not.toBe('portable-program-1')
      expect(importedExercise).not.toBe('custom-ex-1')
      expect(
        destination.query<{ template_id: string; exercise_id: string }>(
          'SELECT template_id, exercise_id FROM template_exercises',
        ),
      ).toEqual([{ template_id: importedTemplate, exercise_id: importedExercise }])
      expect(
        destination.query<{ template_id: string; program_id: string }>(
          'SELECT pd.template_id, pw.program_id FROM program_days pd JOIN program_weeks pw ON pw.id = pd.week_id',
        ),
      ).toEqual([{ template_id: importedTemplate, program_id: importedProgram }])
      expect(
        destination.query<{ exercise_id: string; increment_kg: number }>(
          'SELECT exercise_id, increment_kg FROM equipment_profiles',
        ),
      ).toEqual([{ exercise_id: importedExercise, increment_kg: 0.5 }])
      await dispatchTransfer(destinationAdapter, 'TRANSFER_IMPORT_PORTABLE', { bundle })
      const importedPairs = destination.query<{ template_id: string; exercise_id: string }>(
        'SELECT template_id, exercise_id FROM template_exercises ORDER BY template_id',
      )
      expect(importedPairs).toHaveLength(2)
      expect(new Set(importedPairs.map((row) => row.template_id)).size).toBe(2)
      expect(new Set(importedPairs.map((row) => row.exercise_id)).size).toBe(2)
      expect(
        importedPairs.every(
          (row) => row.template_id !== 'portable-tpl-1' && row.exercise_id !== 'custom-ex-1',
        ),
      ).toBe(true)
      const repeatedDayLinks = destination.query<{ template_id: string; program_id: string }>(
        'SELECT pd.template_id, pw.program_id FROM program_days pd JOIN program_weeks pw ON pw.id = pd.week_id ORDER BY pw.program_id',
      )
      expect(repeatedDayLinks).toHaveLength(2)
      expect(new Set(repeatedDayLinks.map((row) => row.program_id)).size).toBe(2)
      expect(
        repeatedDayLinks.every((row) =>
          importedPairs.some((pair) => pair.template_id === row.template_id),
        ),
      ).toBe(true)
    } finally {
      source.close()
      destination.close()
    }
  })
  it('converts a legacy template export into a revision-backed template without losing prescription rules', async () => {
    const destination = await createTestDb()
    try {
      destination.exec(
        `INSERT INTO exercises (id, name, slug, equipment, movement, is_custom, created_at)
         VALUES ('11111111-1111-4111-8111-111111111111', 'Legacy Squat', 'legacy-squat', 'barbell', 'squat', 1, '2026-10-02T00:00:00Z')`,
      )
      const legacy = {
        version: 2,
        exportedAt: '2026-10-02T00:00:00Z',
        template: {
          name: 'Legacy strength',
          description: 'Keep authored rules',
          created_at: '2026-10-02T00:00:00Z',
          archived_at: null,
          sort_order: 0,
          pinned_at: null,
          last_used_at: null,
          use_count: 0,
          cover_emoji: null,
          scheduled_days: null,
          notification_enabled: 0,
          notification_time: null,
        },
        exercises: [
          {
            exercise_name: 'Legacy Squat',
            exercise_movement: 'squat',
            order_num: 1,
            sets_planned: 3,
            reps_planned: '8',
            rpe_target: null,
            increment_kg: 1.25,
            rest_seconds: 120,
            set_rest_seconds: null,
            transition_rest_sec: null,
            warmup_counts: 0,
            set_scheme: null,
            notes: null,
            failure_target: 0,
            rpe_targets: null,
            progression_rule: null,
            deload_template_id: null,
            substitutes: '[]',
            tempo: null,
            resistance_note: null,
            unilateral: 0,
            superset_group: null,
          },
        ],
        groups: [],
      }
      const db = adapterFor(destination)
      expect(
        await dispatchTransfer(db, 'TRANSFER_PREVIEW_PORTABLE_IMPORT', { bundle: legacy }),
      ).toMatchObject({ valid: true, legacy: true, restoreMode: 'additive', templateCount: 1 })
      await dispatchTransfer(db, 'TRANSFER_IMPORT_PORTABLE', { bundle: legacy })
      expect(destination.query<{ name: string }>('SELECT name FROM templates')).toEqual([
        { name: 'Legacy strength' },
      ])
      expect(
        destination.query<{ exercise_id: string; reps_planned: string; increment_kg: number }>(
          'SELECT exercise_id, reps_planned, increment_kg FROM template_exercises',
        ),
      ).toEqual([
        {
          exercise_id: '11111111-1111-4111-8111-111111111111',
          reps_planned: '8',
          increment_kg: 1.25,
        },
      ])
      expect(
        destination.query<{ template_id: string; structure_hash: string }>(
          'SELECT template_id, structure_hash FROM template_revisions',
        ),
      ).toHaveLength(1)
    } finally {
      destination.close()
    }
  })
})
