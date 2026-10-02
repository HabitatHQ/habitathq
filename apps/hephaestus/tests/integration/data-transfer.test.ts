import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupEnvelope,
  dispatchTransfer,
} from '~/lib/data-transfer'
import { EXPORT_VERSION, type ExportPayload } from '~/lib/template-export'
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

describe('database transfer', () => {
  it('round-trips all discovered app tables and preserves settings', async () => {
    const testDb = await createTestDb()
    try {
      const db = adapterFor(testDb)
      await insertWorkout(testDb, 'original')
      testDb.exec('CREATE TABLE future_durable (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
      testDb.exec("INSERT INTO future_durable (id, value) VALUES ('future-1', 'portable ✓')")
      const backup = (await dispatchTransfer(db, 'TRANSFER_EXPORT_BACKUP', {
        settings,
      })) as BackupEnvelope
      expect(backup.format).toBe(BACKUP_FORMAT)
      expect(backup.version).toBe(BACKUP_VERSION)
      expect(backup.tables['workouts']?.rows).toHaveLength(1)
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
      testDb.exec('DELETE FROM future_durable')
      testDb.exec('DELETE FROM workouts')
      expect(await dispatchTransfer(db, 'TRANSFER_PREVIEW_RESTORE', { backup })).toMatchObject({
        valid: true,
        workoutCount: 1,
      })
      await dispatchTransfer(db, 'TRANSFER_RESTORE_BACKUP', { backup })
      expect(
        testDb.query<{ notes: string }>('SELECT notes FROM workouts WHERE id = ?', ['workout-1']),
      ).toEqual([{ notes: 'original' }])
      expect(testDb.query<{ value: string }>('SELECT value FROM future_durable')).toEqual([
        { value: 'portable ✓' },
      ])
    } finally {
      testDb.close()
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
  it('imports a complete standalone template atomically and preserves group settings', async () => {
    const testDb = await createTestDb()
    try {
      testDb.exec(
        `INSERT INTO exercises (id, name, slug, equipment, movement, created_at)
         VALUES ('press-1', 'Bench Press', 'bench-press', 'barbell', 'press', '2026-10-02T00:00:00Z')`,
      )
      const payload: ExportPayload = {
        version: EXPORT_VERSION,
        exportedAt: '2026-10-02T00:00:00Z',
        template: {
          name: 'Imported Push',
          description: 'Full content',
          created_at: '2026-09-01T00:00:00Z',
          archived_at: null,
          sort_order: 4,
          pinned_at: '2026-09-02T00:00:00Z',
          last_used_at: '2026-09-03T00:00:00Z',
          use_count: 2,
          cover_emoji: '🔥',
          scheduled_days: '[1,3,5]',
          notification_enabled: 1,
          notification_time: '07:30',
        },
        exercises: [
          {
            exercise_name: 'Bench Press',
            exercise_movement: 'press',
            order_num: 1,
            sets_planned: 4,
            reps_planned: '6-8',
            rpe_target: 8,
            increment_kg: 2.5,
            rest_seconds: 180,
            set_rest_seconds: '[180,150]',
            transition_rest_sec: 20,
            warmup_counts: 1,
            set_scheme: '{"type":"straight"}',
            notes: 'Controlled',
            failure_target: 0,
            rpe_targets: '[7,8]',
            progression_rule: '{"type":"double_progression"}',
            deload_template_id: null,
            substitutes: '[]',
            tempo: '3-1-1-0',
            resistance_note: 'Pause at chest',
            unilateral: 0,
            superset_group: 'A',
          },
        ],
        groups: [
          {
            group_id: 'source-group',
            label: 'A',
            name: 'Press circuit',
            group_type: 'circuit',
            transition_rest_sec: 20,
            rest_after_round_sec: 90,
            circuit_rest_mode: 'after_round',
            sort_order: 2,
            display_name: 'Press circuit',
            rounds: 3,
            amrap: 1,
            time_cap_sec: 600,
          },
        ],
      }
      const db = adapterFor(testDb)
      expect(
        await dispatchTransfer(db, 'TRANSFER_PREVIEW_TEMPLATE_IMPORT', { content: payload }),
      ).toMatchObject({ valid: true, templateCount: 1 })
      await dispatchTransfer(db, 'TRANSFER_IMPORT_TEMPLATE', { content: payload })
      expect(
        testDb.query<{
          created_at: string
          sort_order: number
          pinned_at: string
          last_used_at: string
          use_count: number
          scheduled_days: string
          notification_enabled: number
          notification_time: string
        }>(
          `SELECT created_at, sort_order, pinned_at, last_used_at, use_count,
                scheduled_days, notification_enabled, notification_time
         FROM templates`,
        ),
      ).toEqual([
        {
          created_at: '2026-09-01T00:00:00Z',
          sort_order: 4,
          pinned_at: '2026-09-02T00:00:00Z',
          last_used_at: '2026-09-03T00:00:00Z',
          use_count: 2,
          scheduled_days: '[1,3,5]',
          notification_enabled: 1,
          notification_time: '07:30',
        },
      ])
      expect(
        testDb.query<{
          name: string
          transition_rest_sec: number
          rest_after_round_sec: number
          circuit_rest_mode: string
          sort_order: number
          rounds: number
          amrap: number
          time_cap_sec: number
        }>(
          `SELECT name, transition_rest_sec, rest_after_round_sec, circuit_rest_mode,
                sort_order, rounds, amrap, time_cap_sec
         FROM template_groups`,
        ),
      ).toEqual([
        {
          name: 'Press circuit',
          transition_rest_sec: 20,
          rest_after_round_sec: 90,
          circuit_rest_mode: 'after_round',
          sort_order: 2,
          rounds: 3,
          amrap: 1,
          time_cap_sec: 600,
        },
      ])
      expect(
        testDb.query<{ superset_group: string }>('SELECT superset_group FROM template_exercises'),
      ).toEqual([{ superset_group: 'A' }])
      await expect(
        dispatchTransfer(db, 'TRANSFER_IMPORT_TEMPLATE', { content: payload }),
      ).rejects.toThrow('already exists')
      expect(testDb.query<{ count: number }>('SELECT COUNT(*) AS count FROM templates')).toEqual([
        { count: 1 },
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
      source.exec(
        `INSERT INTO program_weeks (id, program_id, week_num)
         VALUES ('portable-week-1', 'portable-program-1', 1)`,
      )
      source.exec(
        `INSERT INTO program_days (id, week_id, day_num, template_id)
         VALUES ('portable-day-1', 'portable-week-1', 1, 'portable-tpl-1')`,
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
      expect(destination.query<{ id: string }>('SELECT id FROM templates')).toEqual([
        { id: 'portable-tpl-1' },
      ])
      expect(destination.query<{ id: string }>('SELECT id FROM programs')).toEqual([
        { id: 'portable-program-1' },
      ])
      expect(
        destination.query<{ exercise_id: string; increment_kg: number }>(
          'SELECT exercise_id, increment_kg FROM equipment_profiles',
        ),
      ).toEqual([{ exercise_id: 'custom-ex-1', increment_kg: 0.5 }])
      await expect(
        dispatchTransfer(destinationAdapter, 'TRANSFER_IMPORT_PORTABLE', { bundle }),
      ).rejects.toThrow('already exists')
    } finally {
      source.close()
      destination.close()
    }
  })
})
