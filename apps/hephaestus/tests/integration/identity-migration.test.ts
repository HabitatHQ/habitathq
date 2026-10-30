import { generateUuidV7 } from '@palladium/core'
import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, type BackupEnvelope, dispatchTransfer } from '~/lib/data-transfer'
import { migrateAppIdentities, naturalRowUuidV7 } from '~/lib/db-identity'
import { dispatchHistory } from '~/lib/history-correction'
import type { DbAdapter } from '~/types/database'
import { createTestDb, type TestDb } from './helpers/db'

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

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function adapterFor(db: TestDb): DbAdapter {
  return {
    async queryAll<T>(sql: string, bind?: unknown[]) {
      return db.query<T>(sql, bind as (string | number | null | Uint8Array)[] | undefined)
    },
    async queryOne<T>(sql: string, bind?: unknown[]) {
      return (
        db.query<T>(sql, bind as (string | number | null | Uint8Array)[] | undefined)[0] ?? null
      )
    },
    async exec(sql: string, bind?: unknown[]) {
      db.exec(sql, bind as (string | number | null | Uint8Array)[] | undefined)
    },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) {
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

function seedLegacyInstall(db: TestDb): void {
  db.exec(
    "INSERT INTO exercises (id,name,slug,equipment,movement,created_at) VALUES ('ex-old','Bench','bench','barbell','push','2026-01-01')",
  )
  db.exec(
    "INSERT INTO templates (id,name,created_at) VALUES ('template-old','Legacy template','2026-01-01')",
  )
  db.exec(
    "INSERT INTO workouts (id,date,started_at,ended_at,session_type,template_id,created_at) VALUES ('workout-old','2026-01-01','2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','gym','template-old','2026-01-01T10:00:00Z')",
  )
  db.exec(
    "INSERT INTO workout_intents (workout_id,availability,provenance_json,inputs_json,captured_at) VALUES ('workout-old','captured','{\"sourceId\":\"template-old\",\"note\":\"keep this prose\"}','{}','2026-01-01T10:00:00Z')",
  )
  db.exec(
    "INSERT INTO body_weights (id,date,weight_kg,notes) VALUES ('body-old','2026-01-01',73.25,'unchanged body note')",
  )
  db.exec(
    "INSERT INTO weekly_training_load (week,gym_volume,gym_sets,run_distance_m,run_duration_sec) VALUES ('2026-W01',1234.5,9,NULL,NULL)",
  )
}

describe('app identity migration', () => {
  it('remaps substitute exercise identities without changing prose or breaking exports', async () => {
    const db = await createTestDb()
    try {
      const primary = '11111111-1111-4111-8111-111111111111'
      const substitute = '22222222-2222-4222-8222-222222222222'
      const templateId = '33333333-3333-4333-8333-333333333333'
      db.exec(
        `INSERT INTO exercises (id,name,slug,equipment,movement,created_at) VALUES
         (?, 'Press', 'press', 'barbell', 'push', '2026-01-01'),
         (?, 'Alternate press', 'alternate-press', 'dumbbell', 'push', '2026-01-01')`,
        [primary, substitute],
      )
      db.exec('INSERT INTO templates (id,name,created_at) VALUES(?,?,?)', [
        templateId,
        'Substitute template',
        '2026-01-01',
      ])
      db.exec(
        'INSERT INTO template_exercises (id,template_id,exercise_id,order_num,substitutes,notes) VALUES(?,?,?,?,?,?)',
        [
          '44444444-4444-4444-8444-444444444444',
          templateId,
          primary,
          1,
          JSON.stringify([substitute]),
          'Keep this authored prose',
        ],
      )
      const adapter = adapterFor(db)
      await adapter.transaction((tx) => migrateAppIdentities(tx))

      const exercises = db.query<{ id: string; slug: string }>(
        'SELECT id,slug FROM exercises ORDER BY slug',
      )
      const primaryId = exercises.find((exercise) => exercise.slug === 'press')?.id
      const substituteId = exercises.find((exercise) => exercise.slug === 'alternate-press')?.id
      const entry = db.query<{ exercise_id: string; substitutes: string; notes: string }>(
        'SELECT exercise_id,substitutes,notes FROM template_exercises',
      )[0]
      expect(primaryId).toMatch(UUID_V7)
      expect(substituteId).toMatch(UUID_V7)
      expect(entry).toEqual({
        exercise_id: primaryId,
        substitutes: JSON.stringify([substituteId]),
        notes: 'Keep this authored prose',
      })

      const backup = (await dispatchTransfer(adapter, 'TRANSFER_EXPORT_BACKUP', {
        settings,
      })) as BackupEnvelope
      expect(await dispatchTransfer(adapter, 'TRANSFER_PREVIEW_RESTORE', { backup })).toMatchObject(
        { valid: true },
      )
      const portable = (await dispatchTransfer(adapter, 'TRANSFER_EXPORT_PORTABLE', {})) as {
        tables: Record<string, Array<Record<string, unknown>>>
      }
      expect(portable.tables['template_exercises']?.[0]?.['substitutes']).toBe(
        JSON.stringify([substituteId]),
      )
    } finally {
      db.close()
    }
  })
  it('canonicalizes legacy identities, natural-key rows and captured payloads in one pass', async () => {
    const db = await createTestDb()
    try {
      seedLegacyInstall(db)
      const adapter = adapterFor(db)
      await adapter.transaction((tx) => migrateAppIdentities(tx))

      const template = db.query<{ id: string }>(
        "SELECT id FROM templates WHERE name='Legacy template'",
      )[0]
      const workout = db.query<{ id: string; template_id: string }>(
        'SELECT id,template_id FROM workouts',
      )[0]
      const intent = db.query<{ id: string; provenance_json: string }>(
        'SELECT id,provenance_json FROM workout_intents',
      )[0]
      const weight = db.query<{ id: string; weight_kg: number; notes: string }>(
        'SELECT * FROM body_weights',
      )[0]
      const load = db.query<{ id: string; gym_volume: number }>(
        'SELECT * FROM weekly_training_load',
      )[0]

      expect(template?.id).toMatch(UUID_V7)
      expect(workout?.id).toMatch(UUID_V7)
      expect(workout?.template_id).toBe(template?.id)
      expect(intent?.id).toMatch(UUID_V7)
      expect(JSON.parse(intent?.provenance_json ?? '{}')).toMatchObject({
        sourceId: template?.id,
        note: 'keep this prose',
      })
      expect(weight?.id).toMatch(UUID_V7)
      expect(weight?.weight_kg).toBe(73.25)
      expect(weight?.notes).toBe('unchanged body note')
      expect(load?.id).toBe(naturalRowUuidV7('weekly_training_load', { week: '2026-W01' }))
      expect(load?.gym_volume).toBe(1234.5)
      expect(db.query('PRAGMA foreign_key_check')).toEqual([])

      await adapter.transaction((tx) => migrateAppIdentities(tx))
      expect(db.query<{ id: string }>('SELECT id FROM templates')[0]?.id).toBe(template?.id)
      expect(db.query<{ id: string }>('SELECT id FROM weekly_training_load')[0]?.id).toBe(load?.id)

      db.exec(
        "INSERT INTO weekly_training_load (week,gym_volume,gym_sets,run_distance_m,run_duration_sec) VALUES ('2026-W02',12,1,NULL,NULL)",
      )
      expect(
        db.query<{ id: string }>("SELECT id FROM weekly_training_load WHERE week='2026-W02'")[0]
          ?.id,
      ).toMatch(UUID_V7)
    } finally {
      db.close()
    }
  })

  it('keeps canonical pending history reviews applicable but removes stale legacy previews', async () => {
    const db = await createTestDb()
    try {
      const adapter = adapterFor(db)
      const canonicalWorkoutId = generateUuidV7()
      db.exec(
        'INSERT INTO workouts(id,date,started_at,ended_at,session_type,created_at) VALUES(?,?,?,?,?,?)',
        [
          canonicalWorkoutId,
          '2026-01-01',
          '2026-01-01T10:00:00Z',
          '2026-01-01T11:00:00Z',
          'gym',
          '2026-01-01T10:00:00Z',
        ],
      )
      const detail = await adapter.transaction((tx) =>
        dispatchHistory(tx, 'HISTORY_CORRECTION_READ', { workoutId: canonicalWorkoutId }),
      )
      const preview = await adapter.transaction((tx) =>
        dispatchHistory(tx, 'HISTORY_CORRECTION_PREVIEW', {
          workoutId: canonicalWorkoutId,
          expectedVersion: detail.version,
          title: 'Reviewed title',
        }),
      )
      await adapter.transaction((tx) => migrateAppIdentities(tx))
      expect(db.query('SELECT id FROM history_correction_previews')).toEqual([
        { id: preview.previewId },
      ])
      await adapter.transaction((tx) =>
        dispatchHistory(tx, 'HISTORY_CORRECTION_APPLY', {
          previewId: preview.previewId,
          fingerprint: preview.fingerprint,
        }),
      )
      expect(
        db.query<{ title: string }>('SELECT title FROM workouts WHERE id=?', [canonicalWorkoutId]),
      ).toEqual([{ title: 'Reviewed title' }])

      db.exec(
        "INSERT INTO workouts(id,date,started_at,ended_at,session_type,created_at) VALUES('workout-old','2026-01-02','2026-01-02T10:00:00Z','2026-01-02T11:00:00Z','gym','2026-01-02T10:00:00Z')",
      )
      db.exec(
        "INSERT INTO history_correction_previews(id,workout_id,fingerprint,snapshot_json,created_at) VALUES('legacy-preview','workout-old','fingerprint','{}','2026-01-02T11:00:00Z')",
      )
      await adapter.transaction((tx) => migrateAppIdentities(tx))
      expect(db.query('SELECT id FROM history_correction_previews')).toEqual([])
      expect(db.query('PRAGMA foreign_key_check')).toEqual([])
    } finally {
      db.close()
    }
  })

  it('keeps captured intent immutable after the migration and ignores a nonmatching legacy id', async () => {
    const db = await createTestDb()
    try {
      seedLegacyInstall(db)
      const adapter = adapterFor(db)
      await adapter.transaction((tx) => migrateAppIdentities(tx))
      const workoutId = db.query<{ id: string }>('SELECT id FROM workouts')[0]?.id
      expect(workoutId).toMatch(UUID_V7)
      expect(() =>
        db.exec("UPDATE workout_intents SET availability='absent' WHERE workout_id=?", [workoutId]),
      ).toThrow('Captured workout intent is immutable')
      db.exec("UPDATE workout_intents SET availability='absent' WHERE workout_id='workout-old'")
      expect(
        db.query<{ availability: string }>('SELECT availability FROM workout_intents'),
      ).toEqual([{ availability: 'captured' }])
    } finally {
      db.close()
    }
  })
  it('rolls back every identity write when a protected write fails', async () => {
    const db = await createTestDb()
    try {
      seedLegacyInstall(db)
      const adapter = adapterFor(db)
      db.exec(
        "CREATE TRIGGER reject_template_identity BEFORE UPDATE OF id ON templates BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END",
      )
      await expect(adapter.transaction((tx) => migrateAppIdentities(tx))).rejects.toThrow(
        'injected migration failure',
      )
      expect(db.query<{ id: string }>('SELECT id FROM templates')[0]?.id).toBe('template-old')
      expect(
        db.query<{ template_id: string }>('SELECT template_id FROM workouts')[0]?.template_id,
      ).toBe('template-old')
      expect(db.query<{ id: string }>('SELECT id FROM body_weights')[0]?.id).toBe('body-old')
    } finally {
      db.close()
    }
  })

  it('restores an old backup that omits the surrogate identity deterministically', async () => {
    const legacyBackup = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: '2026-01-02T00:00:00Z',
      settings,
      tables: {
        weekly_training_load: {
          columns: ['week', 'gym_volume', 'gym_sets', 'run_distance_m', 'run_duration_sec'],
          rows: [
            {
              week: '2026-W05',
              gym_volume: 900.5,
              gym_sets: 6,
              run_distance_m: null,
              run_duration_sec: null,
            },
          ],
        },
      },
    }

    const withoutIdentityColumn = await createTestDb()
    try {
      const adapter = adapterFor(withoutIdentityColumn)
      await dispatchTransfer(adapter, 'TRANSFER_RESTORE_BACKUP', { backup: legacyBackup })
      expect(
        withoutIdentityColumn.query<{ id: string; gym_volume: number }>(
          'SELECT id,gym_volume FROM weekly_training_load WHERE week = ?',
          ['2026-W05'],
        ),
      ).toEqual([
        {
          id: naturalRowUuidV7('weekly_training_load', { week: '2026-W05' }),
          gym_volume: 900.5,
        },
      ])
    } finally {
      withoutIdentityColumn.close()
    }

    const withIdentityColumn = await createTestDb()
    try {
      withIdentityColumn.exec('ALTER TABLE weekly_training_load ADD COLUMN id TEXT')
      const adapter = adapterFor(withIdentityColumn)
      await dispatchTransfer(adapter, 'TRANSFER_RESTORE_BACKUP', { backup: legacyBackup })
      expect(
        withIdentityColumn.query<{ id: string }>(
          'SELECT id FROM weekly_training_load WHERE week = ?',
          ['2026-W05'],
        ),
      ).toEqual([{ id: naturalRowUuidV7('weekly_training_load', { week: '2026-W05' }) }])
    } finally {
      withIdentityColumn.close()
    }
  })
})
