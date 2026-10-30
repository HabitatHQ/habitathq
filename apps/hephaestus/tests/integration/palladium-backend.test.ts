import { generateUuidV7, isUuidV7 } from '@palladium/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppSettings } from '../../app/composables/useAppSettings'
import { createHephaestusBackend, type HephaestusBackend } from '../../app/lib/hephaestus-backend'
import { createTestStorage } from './helpers/storage'

const opened: HephaestusBackend[] = []
const now = '2026-10-30T10:00:00.000Z'
const settings: AppSettings = {
  theme: 'forge',
  weightUnit: 'lbs',
  distanceUnit: 'mi',
  use24HourTime: true,
  reduceMotion: false,
  defaultRestSeconds: 90,
  showRpe: true,
  showRir: true,
  warmupRamps: [40, 60, 80],
  showWarmupSuggestions: true,
  showFailurePrompt: true,
  showSessionNotes: true,
  showSetSchemes: true,
  showVariableRest: true,
  showSupersets: true,
}

afterEach(async () => {
  for (const backend of opened.splice(0)) await backend.close()
})

async function backend() {
  const storage = await createTestStorage()
  const result = await createHephaestusBackend(storage)
  opened.push(result)
  return result
}

async function exercise(db: HephaestusBackend, id = generateUuidV7()): Promise<string> {
  await db.mutate(
    'INSERT INTO exercises(id,name,slug,equipment,movement,created_at) VALUES(?,?,?,?,?,?)',
    [id, 'Squat', `squat-${id}`, 'barbell', 'squat', now],
  )
  return id
}

async function metadata(db: HephaestusBackend) {
  return db.query('SELECT * FROM _sync_row_meta ORDER BY tbl,row_id,col')
}

describe('local-only Palladium backend', () => {
  it('captures inserts and upserts after upgrading a natural-key table without an identity column', async () => {
    const storage = await createTestStorage()
    await storage.exec(`CREATE TABLE weekly_training_load (
      week TEXT PRIMARY KEY,
      gym_volume REAL,
      gym_sets INTEGER,
      run_distance_m REAL,
      run_duration_sec INTEGER
    )`)
    await storage.exec('INSERT INTO weekly_training_load(week,gym_volume,gym_sets) VALUES(?,?,?)', [
      '2026-W43',
      100,
      2,
    ])
    const db = await createHephaestusBackend(storage)
    opened.push(db)
    const migrated = await db.query<{ id: string; gym_volume: number }>(
      'SELECT id,gym_volume FROM weekly_training_load WHERE week=?',
      ['2026-W43'],
    )
    expect(migrated[0]?.gym_volume).toBe(100)
    expect(isUuidV7(migrated[0]?.id ?? '')).toBe(true)
    await db.mutate('INSERT INTO weekly_training_load(week,gym_volume,gym_sets) VALUES(?,?,?)', [
      '2026-W44',
      10,
      1,
    ])
    const [inserted] = await db.query<{ id: string }>(
      'SELECT id FROM weekly_training_load WHERE week=?',
      ['2026-W44'],
    )
    if (!inserted) throw new Error('New weekly load missing after migration')
    expect(isUuidV7(inserted.id)).toBe(true)
    await db.mutate(
      'INSERT INTO weekly_training_load(week,gym_volume,gym_sets) VALUES(?,?,?) ON CONFLICT(week) DO UPDATE SET gym_volume=excluded.gym_volume,gym_sets=excluded.gym_sets',
      ['2026-W44', 30, 3],
    )
    expect(
      await db.query('SELECT id,gym_volume,gym_sets FROM weekly_training_load WHERE week=?', [
        '2026-W44',
      ]),
    ).toEqual([{ id: inserted.id, gym_volume: 30, gym_sets: 3 }])
    expect(
      await db.query(
        'SELECT row_id,col FROM _sync_row_meta WHERE tbl=? AND row_id=? ORDER BY col',
        ['weekly_training_load', inserted.id],
      ),
    ).toEqual(
      ['gym_sets', 'gym_volume', 'id', 'run_distance_m', 'run_duration_sec', 'week'].map((col) => ({
        row_id: inserted.id,
        col,
      })),
    )
  })

  it('tracks SQL changes, upserts, and composite-key rows while preserving natural uniqueness', async () => {
    const db = await backend()
    const id = await exercise(db)
    await db.mutate(
      'INSERT INTO equipment_profiles(exercise_id,minimum_kg,increment_kg,updated_at) VALUES(?,?,?,?) ON CONFLICT(exercise_id) DO UPDATE SET increment_kg=excluded.increment_kg',
      [id, 20, 2.5, now],
    )
    await db.mutate(
      'INSERT INTO equipment_profiles(exercise_id,minimum_kg,increment_kg,updated_at) VALUES(?,?,?,?) ON CONFLICT(exercise_id) DO UPDATE SET increment_kg=excluded.increment_kg',
      [id, 20, 5, now],
    )
    const profiles = await db.query<{ id: string; increment_kg: number }>(
      'SELECT id,increment_kg FROM equipment_profiles WHERE exercise_id=?',
      [id],
    )
    expect(profiles).toHaveLength(1)
    const profile = profiles[0]
    if (!profile) throw new Error('Equipment profile missing')
    expect(isUuidV7(profile.id)).toBe(true)
    expect(profile.increment_kg).toBe(5)
    expect(
      await db.query('SELECT row_id FROM _sync_row_meta WHERE tbl=? AND col=?', [
        'equipment_profiles',
        'increment_kg',
      ]),
    ).toEqual([{ row_id: profile.id }])
    expect(await db.query('SELECT name FROM sqlite_master WHERE name=?', ['_sync_outbox'])).toEqual(
      [],
    )
  })

  it('does not publish or stamp writes rolled back by a factual-preview savepoint', async () => {
    const db = await backend()
    const id = await exercise(db)
    const before = await metadata(db)
    const clock = await db.query("SELECT value FROM _sync_state WHERE key='hlc'")
    await db.dispatch({
      type: 'BATCH',
      payload: {
        statements: [
          { sql: 'SAVEPOINT factual_preview' },
          { sql: 'UPDATE exercises SET name=? WHERE id=?', bind: ['Preview only', id] },
          { sql: 'ROLLBACK TO factual_preview' },
          { sql: 'RELEASE factual_preview' },
        ],
      },
    })
    expect(await db.query('SELECT name FROM exercises WHERE id=?', [id])).toEqual([
      { name: 'Squat' },
    ])
    expect(await metadata(db)).toEqual(before)
    expect(await db.query("SELECT value FROM _sync_state WHERE key='hlc'")).toEqual(clock)
  })

  it('rolls back data and tracking together when a batch or captured identity is invalid', async () => {
    const db = await backend()
    const id = await exercise(db)
    const before = await metadata(db)
    await expect(
      db.dispatch({
        type: 'BATCH',
        payload: {
          statements: [
            { sql: 'UPDATE exercises SET name=? WHERE id=?', bind: ['Must roll back', id] },
            { sql: 'INSERT INTO missing_table(id) VALUES(?)', bind: [generateUuidV7()] },
          ],
        },
      }),
    ).rejects.toThrow()
    expect(await db.query('SELECT name FROM exercises WHERE id=?', [id])).toEqual([
      { name: 'Squat' },
    ])
    expect(await metadata(db)).toEqual(before)
    await expect(exercise(db, 'noncanonical-row')).rejects.toThrow(/canonical|Palladium identity/)
    expect(await db.query('SELECT id FROM exercises WHERE id=?', ['noncanonical-row'])).toEqual([])
  })

  it('captures cascading child deletion, not only the explicit parent SQL statement', async () => {
    const db = await backend()
    const exerciseId = await exercise(db)
    const workoutId = generateUuidV7(),
      activityId = generateUuidV7(),
      setId = generateUuidV7()
    await db.dispatch({
      type: 'BATCH',
      payload: {
        statements: [
          {
            sql: 'INSERT INTO workouts(id,date,started_at,created_at) VALUES(?,?,?,?)',
            bind: [workoutId, '2026-10-30', now, now],
          },
          {
            sql: 'INSERT INTO workout_exercises(id,workout_id,exercise_id,order_num) VALUES(?,?,?,1)',
            bind: [activityId, workoutId, exerciseId],
          },
          {
            sql: 'INSERT INTO sets(id,workout_exercise_id,set_num,reps,weight_kg,completed) VALUES(?,?,1,5,100,1)',
            bind: [setId, activityId],
          },
        ],
      },
    })
    await db.mutate('DELETE FROM workouts WHERE id=?', [workoutId])
    expect(await db.query('SELECT id FROM sets WHERE id=?', [setId])).toEqual([])
    const retired = await db.query<{ tbl: string; row_id: string }>(
      "SELECT tbl,row_id FROM _sync_row_meta WHERE col='__palladium_deleted__' ORDER BY tbl",
    )
    expect(retired).toEqual([
      { tbl: 'sets', row_id: setId },
      { tbl: 'workout_exercises', row_id: activityId },
      { tbl: 'workouts', row_id: workoutId },
    ])
  })

  it('restores an identical backup with complete metadata and restores previously deleted identities', async () => {
    const db = await backend()
    const id = await exercise(db)
    const backup = await db.dispatch({ type: 'TRANSFER_EXPORT_BACKUP', payload: { settings } })
    const before = await db.query(
      'SELECT col FROM _sync_row_meta WHERE tbl=? AND row_id=? ORDER BY col',
      ['exercises', id],
    )
    await db.dispatch({ type: 'TRANSFER_RESTORE_BACKUP', payload: { backup } })
    expect(
      await db.query('SELECT col FROM _sync_row_meta WHERE tbl=? AND row_id=? ORDER BY col', [
        'exercises',
        id,
      ]),
    ).toEqual(before)
    await db.mutate('DELETE FROM exercises WHERE id=?', [id])
    await db.dispatch({ type: 'TRANSFER_RESTORE_BACKUP', payload: { backup } })
    expect(await db.query('SELECT name FROM exercises WHERE id=?', [id])).toEqual([
      { name: 'Squat' },
    ])
    expect(
      await db.query(
        "SELECT row_id FROM _sync_row_meta WHERE tbl='exercises' AND col='__palladium_deleted__' AND row_id=?",
        [id],
      ),
    ).toEqual([])
  })

  it('resets only app data and tracking, retaining engine identity and allowing backup recovery', async () => {
    const db = await backend()
    const id = await exercise(db)
    const backup = await db.dispatch({ type: 'TRANSFER_EXPORT_BACKUP', payload: { settings } })
    const node = await db.query("SELECT value FROM _sync_state WHERE key='node_id'")
    await db.dispatch({ type: 'RESET_DATABASE' })
    expect(await db.query('SELECT id FROM exercises')).toEqual([])
    expect(await metadata(db)).toEqual([])
    expect(await db.query("SELECT value FROM _sync_state WHERE key='node_id'")).toEqual(node)
    await db.dispatch({ type: 'TRANSFER_RESTORE_BACKUP', payload: { backup } })
    expect(await db.query('SELECT name FROM exercises WHERE id=?', [id])).toEqual([
      { name: 'Squat' },
    ])
    await db.mutate('DELETE FROM exercises WHERE id=?', [id])
    expect(
      await db.query(
        "SELECT row_id FROM _sync_row_meta WHERE tbl='exercises' AND col='__palladium_deleted__'",
      ),
    ).toEqual([{ row_id: id }])
  })

  it('rejects reset side effects outside app ownership and retains capture after rollback', async () => {
    const db = await backend()
    const id = await exercise(db)
    await db.mutate('CREATE TABLE unrelated_data(value TEXT)')
    await db.mutate("INSERT INTO unrelated_data(value) VALUES('keep')")
    await db.mutate(
      'CREATE TEMP TRIGGER unrelated_delete AFTER DELETE ON exercises BEGIN DELETE FROM unrelated_data; END',
    )
    const before = await metadata(db)
    await expect(db.dispatch({ type: 'RESET_DATABASE' })).rejects.toThrow(/trigger/)
    expect(await db.query('SELECT name FROM exercises WHERE id=?', [id])).toEqual([
      { name: 'Squat' },
    ])
    expect(await db.query('SELECT value FROM unrelated_data')).toEqual([{ value: 'keep' }])
    expect(await metadata(db)).toEqual(before)
    await db.mutate('DROP TRIGGER unrelated_delete')
    await db.mutate('DELETE FROM exercises WHERE id=?', [id])
    expect(
      await db.query(
        "SELECT row_id FROM _sync_row_meta WHERE tbl='exercises' AND col='__palladium_deleted__'",
      ),
    ).toEqual([{ row_id: id }])
  })
})
