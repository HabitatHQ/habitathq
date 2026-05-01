import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestDb } from './helpers/db'
import { createTestDb } from './helpers/db'

describe('schema v2 migrations', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('exercises has logging_mode column', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(exercises)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('logging_mode')
  })

  it('template_exercises has set_rest_seconds and transition_rest_sec', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(template_exercises)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('set_rest_seconds')
    expect(cols).toContain('transition_rest_sec')
  })

  it('sets has cardio + annotation columns', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(sets)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('distance_m')
    expect(cols).toContain('duration_sec')
    expect(cols).toContain('speed_kmh')
    expect(cols).toContain('level')
    expect(cols).toContain('technique_flag')
    expect(cols).toContain('body_feel')
  })

  it('workouts has environment column', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(workouts)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('environment')
  })

  it('template_groups table exists with all columns', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(template_groups)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('id')
    expect(cols).toContain('template_id')
    expect(cols).toContain('label')
    expect(cols).toContain('name')
    expect(cols).toContain('group_type')
    expect(cols).toContain('transition_rest_sec')
    expect(cols).toContain('rest_after_round_sec')
    expect(cols).toContain('circuit_rest_mode')
  })

  it('template_exercises has warmup_counts and set_scheme columns', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(template_exercises)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('warmup_counts')
    expect(cols).toContain('set_scheme')
  })

  it('sets has failure_flag, failure_type, partial_reps columns', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(sets)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('failure_flag')
    expect(cols).toContain('failure_type')
    expect(cols).toContain('partial_reps')
  })

  it('tags table exists with all columns', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(tags)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('id')
    expect(cols).toContain('name')
    expect(cols).toContain('category')
    expect(cols).toContain('is_predefined')
    expect(cols).toContain('color')
    expect(cols).toContain('created_at')
  })

  it('workout_tags junction table exists', () => {
    const rows = db.query<{ name: string }>('PRAGMA table_info(workout_tags)')
    const cols = rows.map((r) => r.name)
    expect(cols).toContain('workout_id')
    expect(cols).toContain('tag_id')
  })

  it('template_groups cascade deletes with template', () => {
    db.exec(
      `INSERT INTO templates (id, name, description, created_at) VALUES ('t1','Test',NULL,'2026-01-01')`,
    )
    db.exec(
      `INSERT INTO template_groups (id, template_id, label, group_type, transition_rest_sec, rest_after_round_sec, circuit_rest_mode) VALUES ('g1','t1','A','superset',15,120,'after_round')`,
    )
    db.exec(`DELETE FROM templates WHERE id = 't1'`)
    const groups = db.query(`SELECT * FROM template_groups WHERE id = 'g1'`)
    expect(groups).toHaveLength(0)
  })

  it('workout_tags cascade deletes with workout', () => {
    db.exec(
      `INSERT INTO workouts (id, date, started_at, session_type, created_at) VALUES ('w1','2026-01-01','2026-01-01T10:00:00Z','gym','2026-01-01T10:00:00Z')`,
    )
    db.exec(`INSERT INTO tags VALUES ('tag1','#pr-day','performance',1,NULL,'2026-01-01')`)
    db.exec(`INSERT INTO workout_tags VALUES ('w1','tag1')`)
    db.exec(`DELETE FROM workouts WHERE id = 'w1'`)
    const wt = db.query(`SELECT * FROM workout_tags WHERE workout_id = 'w1'`)
    expect(wt).toHaveLength(0)
  })
})
