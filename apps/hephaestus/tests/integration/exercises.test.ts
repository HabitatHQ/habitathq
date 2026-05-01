import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW, testId } from './helpers/db'

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

afterEach(() => {
  db.close()
})

function insertExercise(
  overrides: {
    id?: string
    name?: string
    slug?: string
    equipment?: string
    movement?: string
    muscles?: string
    muscles_sec?: string
    cues?: string | null
    icon?: string | null
    is_custom?: number
  } = {},
) {
  const id = overrides.id ?? testId('ex')
  db.exec(
    `INSERT INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, cues, icon, is_custom, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.name ?? 'Barbell Squat',
      overrides.slug ?? 'barbell-squat',
      overrides.equipment ?? 'barbell',
      overrides.movement ?? 'squat',
      overrides.muscles ?? '["quads","glutes"]',
      overrides.muscles_sec ?? '["hamstrings"]',
      overrides.cues ?? 'Brace and squat.',
      'icon' in overrides ? overrides.icon : 'i-ph-barbell',
      overrides.is_custom ?? 0,
      NOW,
    ],
  )
  return id
}

describe('exercises — insert', () => {
  it('inserts a seed exercise with all fields', () => {
    const id = insertExercise()
    const rows = db.query<{ id: string; name: string; icon: string | null }>(
      'SELECT id, name, icon FROM exercises WHERE id = ?',
      [id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Barbell Squat')
    expect(rows[0].icon).toBe('i-ph-barbell')
  })

  it('inserts multiple exercises', () => {
    insertExercise({ slug: 'deadlift', name: 'Deadlift', movement: 'hinge' })
    insertExercise({ slug: 'bench-press', name: 'Bench Press', movement: 'press' })
    insertExercise({ slug: 'pull-up', name: 'Pull-up', equipment: 'bodyweight', movement: 'row' })
    const rows = db.query<{ name: string }>('SELECT name FROM exercises ORDER BY name')
    expect(rows.map((r) => r.name)).toEqual(['Bench Press', 'Deadlift', 'Pull-up'])
  })

  it('enforces UNIQUE slug constraint', () => {
    insertExercise({ slug: 'squat' })
    expect(() => insertExercise({ slug: 'squat', name: 'Squat v2' })).toThrow()
  })

  it('stores icon field correctly, including null', () => {
    const id = insertExercise({ icon: null })
    const rows = db.query<{ icon: string | null }>('SELECT icon FROM exercises WHERE id = ?', [id])
    expect(rows[0].icon).toBeNull()
  })

  it('inserts custom exercise with is_custom = 1', () => {
    const id = insertExercise({
      is_custom: 1,
      name: 'My Custom Move',
      slug: 'my-custom-move',
      icon: 'i-ph-person',
    })
    const rows = db.query<{ is_custom: number; icon: string | null }>(
      'SELECT is_custom, icon FROM exercises WHERE id = ?',
      [id],
    )
    expect(rows[0].is_custom).toBe(1)
    expect(rows[0].icon).toBe('i-ph-person')
  })
})

describe('exercises — query & filter', () => {
  beforeEach(() => {
    insertExercise({
      slug: 'barbell-squat',
      name: 'Barbell Squat',
      equipment: 'barbell',
      movement: 'squat',
    })
    insertExercise({ slug: 'deadlift', name: 'Deadlift', equipment: 'barbell', movement: 'hinge' })
    insertExercise({
      slug: 'bench-press',
      name: 'Bench Press',
      equipment: 'barbell',
      movement: 'press',
    })
    insertExercise({ slug: 'pull-up', name: 'Pull-up', equipment: 'bodyweight', movement: 'row' })
    insertExercise({
      slug: 'running',
      name: 'Running',
      equipment: 'bodyweight',
      movement: 'cardio',
      icon: 'i-ph-person-simple-run',
    })
    insertExercise({
      slug: 'custom-lift',
      name: 'Custom Lift',
      equipment: 'dumbbell',
      movement: 'isolation',
      is_custom: 1,
    })
  })

  it('returns all exercises ordered by name', () => {
    const rows = db.query<{ name: string }>('SELECT name FROM exercises ORDER BY name ASC')
    expect(rows.map((r) => r.name)).toEqual([
      'Barbell Squat',
      'Bench Press',
      'Custom Lift',
      'Deadlift',
      'Pull-up',
      'Running',
    ])
  })

  it('filters by equipment', () => {
    const rows = db.query<{ name: string }>(
      "SELECT name FROM exercises WHERE equipment = 'barbell' ORDER BY name",
    )
    expect(rows.map((r) => r.name)).toEqual(['Barbell Squat', 'Bench Press', 'Deadlift'])
  })

  it('filters by movement pattern', () => {
    const rows = db.query<{ name: string }>("SELECT name FROM exercises WHERE movement = 'squat'")
    expect(rows.map((r) => r.name)).toEqual(['Barbell Squat'])
  })

  it('filters custom exercises', () => {
    const rows = db.query<{ name: string }>('SELECT name FROM exercises WHERE is_custom = 1')
    expect(rows.map((r) => r.name)).toEqual(['Custom Lift'])
  })

  it('retrieves icon field for cardio exercises', () => {
    const rows = db.query<{ name: string; icon: string | null }>(
      "SELECT name, icon FROM exercises WHERE movement = 'cardio'",
    )
    expect(rows[0].icon).toBe('i-ph-person-simple-run')
  })

  it('searches by name LIKE', () => {
    const rows = db.query<{ name: string }>(
      "SELECT name FROM exercises WHERE lower(name) LIKE '%squat%'",
    )
    expect(rows.map((r) => r.name)).toEqual(['Barbell Squat'])
  })
})

describe('exercises — update & delete', () => {
  it('updates exercise icon', () => {
    const id = insertExercise({ slug: 'goblet-squat', name: 'Goblet Squat', icon: null })
    db.exec("UPDATE exercises SET icon = 'i-ph-barbell' WHERE id = ?", [id])
    const rows = db.query<{ icon: string | null }>('SELECT icon FROM exercises WHERE id = ?', [id])
    expect(rows[0].icon).toBe('i-ph-barbell')
  })

  it('deletes an exercise', () => {
    const id = insertExercise({ slug: 'to-delete', name: 'To Delete' })
    db.exec('DELETE FROM exercises WHERE id = ?', [id])
    const rows = db.query('SELECT id FROM exercises WHERE id = ?', [id])
    expect(rows).toHaveLength(0)
  })

  it('uses INSERT OR IGNORE to skip duplicates gracefully', () => {
    const id = testId('ex')
    db.exec(
      `INSERT OR IGNORE INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, cues, icon, is_custom, created_at)
       VALUES (?, ?, ?, ?, ?, '[]', '[]', NULL, NULL, 0, ?)`,
      [id, 'Exercise A', 'exercise-a', 'barbell', 'squat', NOW],
    )
    db.exec(
      `INSERT OR IGNORE INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, cues, icon, is_custom, created_at)
       VALUES (?, ?, ?, ?, ?, '[]', '[]', NULL, NULL, 0, ?)`,
      [id, 'Exercise A Dupe', 'exercise-a', 'dumbbell', 'press', NOW],
    )
    const rows = db.query<{ name: string }>('SELECT name FROM exercises WHERE id = ?', [id])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Exercise A')
  })
})

describe('applied_defaults — seed tracking', () => {
  it('tracks whether a seed has been applied', () => {
    db.exec("INSERT OR IGNORE INTO applied_defaults (key) VALUES ('seed:exercises:v4')")
    const rows = db.query<{ key: string }>(
      "SELECT key FROM applied_defaults WHERE key = 'seed:exercises:v4'",
    )
    expect(rows).toHaveLength(1)
  })

  it('INSERT OR IGNORE does not duplicate seed keys', () => {
    db.exec("INSERT OR IGNORE INTO applied_defaults (key) VALUES ('seed:v1')")
    db.exec("INSERT OR IGNORE INTO applied_defaults (key) VALUES ('seed:v1')")
    const rows = db.query("SELECT key FROM applied_defaults WHERE key = 'seed:v1'")
    expect(rows).toHaveLength(1)
  })

  it('returns false-like when key not present', () => {
    const rows = db.query("SELECT key FROM applied_defaults WHERE key = 'seed:nonexistent'")
    expect(rows).toHaveLength(0)
  })
})
