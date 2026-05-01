import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildTagSeed } from '../../app/lib/tags'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW, TODAY, testId } from './helpers/db'

describe('tags and workout_tags', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(() => db.close())

  function seedWorkout(id: string) {
    db.exec(
      `INSERT INTO workouts (id, date, started_at, session_type, created_at)
       VALUES (?,?,?,?,?)`,
      [id, TODAY, NOW, 'gym', NOW],
    )
  }

  it('inserts predefined tags from buildTagSeed', () => {
    const tags = buildTagSeed(NOW)
    for (const tag of tags) {
      db.exec(
        `INSERT INTO tags (id, name, category, is_predefined, color, created_at)
         VALUES (?,?,?,?,?,?)`,
        [tag.id, tag.name, tag.category, tag.is_predefined, tag.color, tag.created_at],
      )
    }
    const rows = db.query('SELECT * FROM tags WHERE is_predefined = 1')
    expect(rows).toHaveLength(12)
  })

  it('tag names are unique', () => {
    const tags = buildTagSeed(NOW)
    for (const tag of tags) {
      db.exec(
        `INSERT INTO tags (id, name, category, is_predefined, color, created_at)
         VALUES (?,?,?,?,?,?)`,
        [tag.id, tag.name, tag.category, tag.is_predefined, tag.color, tag.created_at],
      )
    }
    expect(() =>
      db.exec(
        `INSERT INTO tags (id, name, category, is_predefined, color, created_at)
         VALUES (?,?,?,?,?,?)`,
        ['dup-id', '#pr-day', 'performance', 0, null, NOW],
      ),
    ).toThrow()
  })

  it('associates tags with workout via workout_tags', () => {
    seedWorkout('wk-1')
    db.exec(
      'INSERT INTO tags (id, name, category, is_predefined, color, created_at) VALUES (?,?,?,?,?,?)',
      ['tag-1', '#pr-day', 'performance', 1, '#f97316', NOW],
    )
    db.exec('INSERT INTO workout_tags (workout_id, tag_id) VALUES (?,?)', ['wk-1', 'tag-1'])
    const rows = db.query(
      'SELECT t.name FROM workout_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.workout_id = ?',
      ['wk-1'],
    )
    expect(rows).toHaveLength(1)
    expect((rows[0] as { name: string }).name).toBe('#pr-day')
  })

  it('workout can have multiple tags', () => {
    seedWorkout('wk-2')
    for (const [id, name] of [
      ['t1', '#heavy'],
      ['t2', '#strong'],
    ]) {
      db.exec(
        'INSERT INTO tags (id, name, category, is_predefined, color, created_at) VALUES (?,?,?,?,?,?)',
        [id, name, 'performance', 1, '#f97316', NOW],
      )
      db.exec('INSERT INTO workout_tags (workout_id, tag_id) VALUES (?,?)', ['wk-2', id])
    }
    const rows = db.query(`SELECT * FROM workout_tags WHERE workout_id = 'wk-2'`)
    expect(rows).toHaveLength(2)
  })

  it('prevents duplicate workout_tags (primary key)', () => {
    seedWorkout('wk-3')
    db.exec(
      'INSERT INTO tags (id, name, category, is_predefined, color, created_at) VALUES (?,?,?,?,?,?)',
      ['tag-2', '#volume', 'performance', 1, '#a855f7', NOW],
    )
    db.exec('INSERT INTO workout_tags (workout_id, tag_id) VALUES (?,?)', ['wk-3', 'tag-2'])
    expect(() =>
      db.exec('INSERT INTO workout_tags (workout_id, tag_id) VALUES (?,?)', ['wk-3', 'tag-2']),
    ).toThrow()
  })

  it('workout_tags cascade delete on workout', () => {
    seedWorkout('wk-4')
    db.exec(
      'INSERT INTO tags (id, name, category, is_predefined, color, created_at) VALUES (?,?,?,?,?,?)',
      ['tag-3', '#deload', 'performance', 1, '#60a5fa', NOW],
    )
    db.exec('INSERT INTO workout_tags (workout_id, tag_id) VALUES (?,?)', ['wk-4', 'tag-3'])
    db.exec(`DELETE FROM workouts WHERE id = 'wk-4'`)
    const rows = db.query(`SELECT * FROM workout_tags WHERE workout_id = 'wk-4'`)
    expect(rows).toHaveLength(0)
  })

  it('creates a custom tag', () => {
    const tid = testId('tag')
    db.exec(
      'INSERT INTO tags (id, name, category, is_predefined, color, created_at) VALUES (?,?,?,?,?,?)',
      [tid, '#my-custom', 'custom', 0, null, NOW],
    )
    const rows = db.query<{ is_predefined: number; category: string }>(
      'SELECT is_predefined, category FROM tags WHERE id = ?',
      [tid],
    )
    expect(rows[0]?.is_predefined).toBe(0)
    expect(rows[0]?.category).toBe('custom')
  })
})
