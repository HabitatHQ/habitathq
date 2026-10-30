import {
  generateUuidV7,
  isUuidV7,
  type StorageAdapter,
  type TransactableStorageAdapter,
} from '@palladium/core'
import initSqlJs from 'sql.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createSerialQueue, executeBatch } from '../../../app/lib/database-operations'
import { resetDatabase } from '../../../app/lib/database-reset'
import { HEPHAESTUS_SCHEMA, initializeSchema } from '../../../app/lib/db-schema'
import { toAppDbAdapter } from '../../../app/lib/palladium-database'
import { dispatchWorkout } from '../../../app/lib/workout-storage'
import type { DbAdapter } from '../../../app/types/database'

interface TestSqlStatement {
  bind(params: Array<string | number | null | Uint8Array>): void
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): void
}

interface TestSqlDatabase {
  prepare(sql: string): TestSqlStatement
  run(sql: string): void
  close(): void
}

interface TestSqlModule {
  Database: new () => TestSqlDatabase
}

let SQL: TestSqlModule | undefined
const databases: TestSqlDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

async function makeDatabase() {
  SQL ??= (await initSqlJs()) as TestSqlModule
  const sqlModule = SQL
  if (!sqlModule) throw new Error('sql.js initialization failed')
  const raw = new sqlModule.Database()
  databases.push(raw)
  let failOnSql: string | null = null
  const storage: TransactableStorageAdapter = {
    async open() {},
    async exec<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (failOnSql && sql.includes(failOnSql)) throw new Error('injected migration failure')
      if (params.length === 0 && !/^(SELECT|PRAGMA|WITH)\b/i.test(sql.trim())) {
        raw.run(sql)
        return []
      }
      const statement = raw.prepare(sql)
      try {
        statement.bind(params as (string | number | null | Uint8Array)[])
        const rows: T[] = []
        while (statement.step()) rows.push(statement.getAsObject() as T)
        return rows
      } finally {
        statement.free()
      }
    },
    async put() {},
    async patch() {},
    async remove() {},
    async runMigrations(scripts: readonly string[]) {
      for (const script of scripts) raw.run(script)
    },
    async close() {
      raw.close()
    },
    async transaction<T>(run: (tx: StorageAdapter) => Promise<T>): Promise<T> {
      raw.run('BEGIN')
      try {
        const result = await run(storage)
        raw.run('COMMIT')
        return result
      } catch (error) {
        raw.run('ROLLBACK')
        throw error
      }
    },
  }
  return {
    raw,
    storage,
    adapter: toAppDbAdapter(storage),
    failOn(sql: string | null) {
      failOnSql = sql
    },
  }
}

async function createLegacyTables(db: DbAdapter) {
  await db.exec(`CREATE TABLE exercises (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, equipment TEXT NOT NULL,
    equipment_sub TEXT NOT NULL DEFAULT 'other', movement TEXT NOT NULL,
    muscles TEXT NOT NULL DEFAULT '[]', muscles_sec TEXT NOT NULL DEFAULT '[]',
    cues TEXT, icon TEXT, is_custom INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`)
  await db.exec(`CREATE TABLE templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL
  )`)
  await db.exec(`CREATE TABLE template_exercises (
    id TEXT PRIMARY KEY, template_id TEXT NOT NULL, exercise_id TEXT NOT NULL, order_num INTEGER NOT NULL,
    superset_group TEXT, sets_planned INTEGER, reps_planned TEXT, rpe_target REAL,
    increment_kg REAL DEFAULT 2.5, rest_seconds INTEGER DEFAULT 120
  )`)
  await db.exec(`CREATE TABLE template_groups (
    id TEXT PRIMARY KEY, template_id TEXT NOT NULL, label TEXT NOT NULL,
    group_type TEXT NOT NULL DEFAULT 'superset', transition_rest_sec INTEGER NOT NULL DEFAULT 15,
    rest_after_round_sec INTEGER NOT NULL DEFAULT 120, circuit_rest_mode TEXT NOT NULL DEFAULT 'after_round'
  )`)
  await db.exec(`CREATE TABLE workouts (
    id TEXT PRIMARY KEY, date TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
    session_type TEXT NOT NULL DEFAULT 'gym', training_block_id TEXT, template_id TEXT,
    mood_rating INTEGER, energy_rating INTEGER, notes TEXT, created_at TEXT NOT NULL
  )`)
  await db.exec(`CREATE TABLE sets (
    id TEXT PRIMARY KEY, workout_exercise_id TEXT NOT NULL, set_num INTEGER NOT NULL,
    is_warmup INTEGER DEFAULT 0, weight_kg REAL, reps INTEGER, rpe REAL, rir INTEGER,
    notes TEXT, completed INTEGER DEFAULT 0, logged_at TEXT
  )`)
  await db.exec(`CREATE TABLE interval_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, intervals TEXT NOT NULL, created_at TEXT NOT NULL
  )`)
  await db.exec(`CREATE TABLE programs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, weeks INTEGER NOT NULL,
    is_builtin INTEGER DEFAULT 0, created_at TEXT NOT NULL
  )`)
  await db.exec(`CREATE TABLE program_weeks (
    id TEXT PRIMARY KEY, program_id TEXT NOT NULL, week_num INTEGER NOT NULL, is_deload INTEGER DEFAULT 0
  )`)
}

describe('Palladium Hephaestus local database boundary', () => {
  it('retries legacy and interrupted upgrades while preserving existing rows', async () => {
    const { storage, adapter } = await makeDatabase()
    await createLegacyTables(adapter)
    await adapter.exec(
      `INSERT INTO exercises (id,name,slug,equipment,movement,muscles,muscles_sec,created_at) VALUES ('legacy','Squat','squat','barbell','squat','[]','[]','2026-01-01')`,
    )
    await adapter.exec(
      `INSERT INTO workouts (id,date,started_at,ended_at,session_type,created_at) VALUES ('legacy-other','2026-01-01','2026-01-01T08:00:00Z','2026-01-01T09:00:00Z','other','2026-01-01T08:00:00Z')`,
    )
    await adapter.exec(
      `INSERT INTO programs (id,name,weeks,created_at) VALUES ('legacy-program','Legacy plan',4,'2026-01-01')`,
    )
    await adapter.exec(
      `INSERT INTO program_weeks (id,program_id,week_num) VALUES ('legacy-week','legacy-program',1)`,
    )
    await adapter.exec(
      `ALTER TABLE exercises ADD COLUMN logging_mode TEXT NOT NULL DEFAULT 'strength'`,
    )
    await initializeSchema(storage)

    const exercise = await adapter.queryOne<{ id: string; name: string; logging_mode: string }>(
      'SELECT id,name,logging_mode FROM exercises WHERE slug = ?',
      ['squat'],
    )
    expect(exercise).toEqual({
      id: expect.any(String),
      name: 'Squat',
      logging_mode: 'strength',
    })
    expect(isUuidV7(exercise?.id ?? '')).toBe(true)
    const workouts = await adapter.queryAll<{ id: string; session_type: string }>(
      'SELECT id,session_type FROM workouts',
    )
    expect(workouts).toEqual([{ id: expect.any(String), session_type: 'other' }])
    expect(isUuidV7(workouts[0]?.id ?? '')).toBe(true)
    const program = await adapter.queryOne<{ id: string; completed_at: string | null }>(
      'SELECT id,completed_at FROM programs WHERE name = ?',
      ['Legacy plan'],
    )
    expect(program).toEqual({ id: expect.any(String), completed_at: null })
    expect(isUuidV7(program?.id ?? '')).toBe(true)
    const weeks = await adapter.queryAll<{
      id: string
      program_id: string
      intensity_modifier: number
    }>('SELECT id,program_id,intensity_modifier FROM program_weeks')
    expect(weeks).toEqual([
      { id: expect.any(String), program_id: program?.id, intensity_modifier: 1 },
    ])
    expect(isUuidV7(weeks[0]?.id ?? '')).toBe(true)
    await initializeSchema(storage)
    expect(await adapter.queryAll('SELECT id,session_type FROM workouts')).toEqual(workouts)
    expect(
      await adapter.queryAll('SELECT id,program_id,intensity_modifier FROM program_weeks'),
    ).toEqual(weeks)
    expect(
      await adapter.queryOne('SELECT id,name,logging_mode FROM exercises WHERE slug = ?', [
        'squat',
      ]),
    ).toEqual(exercise)

    await adapter.transaction((tx: DbAdapter) =>
      dispatchWorkout(tx, 'WORKOUT_START', {
        id: 'new-session',
        now: '2026-01-02T12:00:00Z',
        options: { sessionType: 'gym' },
      }),
    )
    const resumed = await adapter.transaction((tx: DbAdapter) =>
      dispatchWorkout(tx, 'WORKOUT_ACTIVE', null),
    )
    expect(resumed).toMatchObject({ workout: { id: 'new-session' }, exercises: [], sets: [] })
    await expect(
      adapter.transaction((tx: DbAdapter) =>
        dispatchWorkout(tx, 'WORKOUT_START', {
          id: 'second-session',
          now: '2026-01-02T13:00:00Z',
        }),
      ),
    ).rejects.toThrow('An unfinished session already exists')
  })
  it('rolls back legacy baseline, additive migrations, and version stamp together, then retries', async () => {
    const { storage, adapter, failOn } = await makeDatabase()
    await createLegacyTables(adapter)
    await adapter.exec(
      `INSERT INTO exercises (id,name,slug,equipment,movement,created_at) VALUES ('retry','Squat','retry-squat','barbell','squat','2026-01-01')`,
    )
    failOn('ALTER TABLE templates ADD COLUMN notification_enabled')
    await expect(initializeSchema(storage)).rejects.toThrow('injected migration failure')
    expect(await adapter.queryOne<{ user_version: number }>('PRAGMA user_version')).toEqual({
      user_version: 0,
    })
    await expect(adapter.queryAll('SELECT logging_mode FROM exercises')).rejects.toThrow()
    expect(await adapter.queryOne('SELECT id FROM exercises WHERE id = ?', ['retry'])).toEqual({
      id: 'retry',
    })

    failOn(null)
    await initializeSchema(storage)
    expect(await adapter.queryOne<{ user_version: number }>('PRAGMA user_version')).toEqual({
      user_version: HEPHAESTUS_SCHEMA.version,
    })
    const migrated = await adapter.queryAll<{ id: string; name: string }>(
      'SELECT id,name FROM exercises WHERE slug = ?',
      ['retry-squat'],
    )
    expect(migrated).toEqual([{ id: expect.any(String), name: 'Squat' }])
    expect(isUuidV7(migrated[0]?.id ?? '')).toBe(true)
  })

  it('rolls back versioned prescription conversion and retries without duplicating legacy revisions', async () => {
    const { storage, adapter, failOn } = await makeDatabase()
    await createLegacyTables(adapter)
    await adapter.exec(
      "INSERT INTO templates (id,name,created_at) VALUES ('legacy-prescription','Preserved template','2026-01-01')",
    )
    await adapter.exec('PRAGMA user_version = 1')
    failOn('INSERT INTO template_revisions')

    await expect(initializeSchema(storage)).rejects.toThrow('injected migration failure')
    expect(await adapter.queryOne('PRAGMA user_version')).toEqual({ user_version: 1 })
    expect(
      await adapter.queryOne(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='template_revisions'",
      ),
    ).toBeNull()
    expect(
      await adapter.queryOne('SELECT name FROM templates WHERE id=?', ['legacy-prescription']),
    ).toEqual({ name: 'Preserved template' })

    failOn(null)
    await initializeSchema(storage)
    await initializeSchema(storage)
    expect(await adapter.queryOne('PRAGMA user_version')).toEqual({
      user_version: HEPHAESTUS_SCHEMA.version,
    })
    const template = await adapter.queryOne<{ id: string }>(
      'SELECT id FROM templates WHERE name=?',
      ['Preserved template'],
    )
    expect(isUuidV7(template?.id ?? '')).toBe(true)
    expect(
      await adapter.queryOne(
        'SELECT COUNT(*) AS revision_count FROM template_revisions WHERE template_id=?',
        [template?.id],
      ),
    ).toEqual({ revision_count: 1 })
  })

  it('replays the current schema without changing existing user data', async () => {
    const { storage, adapter } = await makeDatabase()
    await initializeSchema(storage)
    const exerciseId = generateUuidV7()
    await adapter.exec(
      'INSERT INTO exercises (id,name,slug,equipment,movement,created_at) VALUES (?,?,?,?,?,?)',
      [exerciseId, 'Bench', 'bench', 'barbell', 'press', '2026-01-01'],
    )
    await initializeSchema(storage)
    expect(await adapter.queryAll('SELECT id,name,slug FROM exercises')).toEqual([
      { id: exerciseId, name: 'Bench', slug: 'bench' },
    ])
  })

  it('rolls back every batch statement after a later failure', async () => {
    const { storage, adapter } = await makeDatabase()
    await initializeSchema(storage)
    await adapter.exec(
      'CREATE TABLE batch_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)',
    )
    await expect(
      executeBatch(adapter, [
        { sql: 'INSERT INTO batch_probe (value) VALUES (?)', bind: ['first'] },
        { sql: 'INSERT INTO batch_probe (value) VALUES (?)', bind: ['first'] },
      ]),
    ).rejects.toThrow()
    expect(await adapter.queryAll('SELECT value FROM batch_probe')).toEqual([])
  })

  it('serializes overlapping operations and continues after a rejected operation', async () => {
    const queue = createSerialQueue()
    const order: string[] = []
    const first = queue(async () => {
      order.push('first-start')
      await Promise.resolve()
      order.push('first-end')
    })
    const failed = queue(async () => {
      order.push('failed')
      throw new Error('expected')
    })
    const last = queue(async () => {
      order.push('last')
      return 'complete'
    })
    await first
    await expect(failed).rejects.toThrow('expected')
    await expect(last).resolves.toBe('complete')
    expect(order).toEqual(['first-start', 'first-end', 'failed', 'last'])
  })

  it('clears only explicit Hephaestus tables transactionally, preserves sync metadata, and rolls back failures', async () => {
    const { storage, adapter } = await makeDatabase()
    await initializeSchema(storage)
    await adapter.exec('CREATE TABLE _sync_state (value TEXT)')
    await adapter.exec('CREATE TABLE sibling_data (value TEXT)')
    await adapter.exec('CREATE TABLE _palladium_private (value TEXT)')
    await adapter.exec(
      `INSERT INTO exercises (id,name,slug,equipment,movement,created_at) VALUES ('reset-me','Row','row','barbell','row','2026-01-01')`,
    )
    await adapter.exec(
      `INSERT INTO equipment_profiles (exercise_id,minimum_kg,increment_kg,maximum_kg,additional_loads_kg,updated_at) VALUES ('reset-me', 2.5, 1.25, 20, '[]', '2026-01-01')`,
    )
    await adapter.exec(
      `INSERT INTO organization_source_links (workout_id,appointment_id,rotation_id,rotation_generation) VALUES ('reset-me', NULL, NULL, NULL)`,
    )
    await adapter.exec(`INSERT INTO _palladium_private VALUES ('preserve')`)
    await adapter.exec(`INSERT INTO _sync_state VALUES ('preserve-sync')`)
    await adapter.exec(`INSERT INTO sibling_data VALUES ('preserve-sibling')`)
    await resetDatabase(adapter)
    expect(await adapter.queryAll('SELECT exercise_id FROM equipment_profiles')).toEqual([])
    expect(await adapter.queryAll('SELECT workout_id FROM organization_source_links')).toEqual([])
    expect(await adapter.queryAll('SELECT value FROM _palladium_private')).toEqual([
      { value: 'preserve' },
    ])
    expect(await adapter.queryAll('SELECT value FROM _sync_state')).toEqual([
      { value: 'preserve-sync' },
    ])
    expect(await adapter.queryAll('SELECT value FROM sibling_data')).toEqual([
      { value: 'preserve-sibling' },
    ])
    expect(await adapter.queryAll('SELECT key FROM applied_defaults')).toEqual([])
    await resetDatabase(adapter)

    await adapter.exec(
      `INSERT INTO exercises (id,name,slug,equipment,movement,created_at) VALUES ('keep-on-error','Row','row2','barbell','row','2026-01-01')`,
    )
    await adapter.exec(
      `CREATE TRIGGER reject_reset BEFORE DELETE ON exercises BEGIN SELECT RAISE(ABORT, 'reset rejected'); END`,
    )
    await expect(resetDatabase(adapter)).rejects.toThrow('reset rejected')
    expect(await adapter.queryAll('SELECT id FROM exercises')).toEqual([{ id: 'keep-on-error' }])
  })
})
