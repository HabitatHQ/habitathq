import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestDb } from './helpers/db'
import { createTestDb, NOW, testId } from './helpers/db'

describe('template_groups', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
    // Seed a template
    db.exec('INSERT INTO templates (id, name, description, created_at) VALUES (?,?,?,?)', [
      'tmpl-1',
      'Push Pull Legs',
      null,
      NOW,
    ])
  })

  afterEach(() => db.close())

  it('creates a superset group', () => {
    const gid = testId('group')
    db.exec(
      `INSERT INTO template_groups (id, template_id, label, group_type, transition_rest_sec, rest_after_round_sec, circuit_rest_mode)
       VALUES (?,?,?,?,?,?,?)`,
      [gid, 'tmpl-1', 'A', 'superset', 15, 120, 'after_round'],
    )
    const rows = db.query<{ id: string; label: string; group_type: string }>(
      'SELECT id, label, group_type FROM template_groups WHERE id = ?',
      [gid],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBe('A')
    expect(rows[0]?.group_type).toBe('superset')
  })

  it('cascades delete to template', () => {
    const gid = testId('group')
    db.exec(
      `INSERT INTO template_groups (id, template_id, label, group_type, transition_rest_sec, rest_after_round_sec, circuit_rest_mode)
       VALUES (?,?,?,?,?,?,?)`,
      [gid, 'tmpl-1', 'A', 'superset', 15, 120, 'after_round'],
    )
    db.exec(`DELETE FROM templates WHERE id = 'tmpl-1'`)
    const rows = db.query('SELECT * FROM template_groups WHERE id = ?', [gid])
    expect(rows).toHaveLength(0)
  })

  it('supports all group_types', () => {
    const types = ['superset', 'giant_set', 'circuit', 'pre_exhaust']
    for (const type of types) {
      const gid = testId('group')
      db.exec(
        `INSERT INTO template_groups (id, template_id, label, group_type, transition_rest_sec, rest_after_round_sec, circuit_rest_mode)
         VALUES (?,?,?,?,?,?,?)`,
        [gid, 'tmpl-1', 'A', type, 15, 120, 'after_round'],
      )
      const rows = db.query<{ group_type: string }>(
        'SELECT group_type FROM template_groups WHERE id = ?',
        [gid],
      )
      expect(rows[0]?.group_type).toBe(type)
    }
  })

  it('supports circuit_rest_mode after_each', () => {
    const gid = testId('group')
    db.exec(
      `INSERT INTO template_groups (id, template_id, label, group_type, transition_rest_sec, rest_after_round_sec, circuit_rest_mode)
       VALUES (?,?,?,?,?,?,?)`,
      [gid, 'tmpl-1', 'B', 'circuit', 30, 90, 'after_each'],
    )
    const rows = db.query<{ circuit_rest_mode: string }>(
      'SELECT circuit_rest_mode FROM template_groups WHERE id = ?',
      [gid],
    )
    expect(rows[0]?.circuit_rest_mode).toBe('after_each')
  })

  it('multiple groups per template', () => {
    for (const label of ['A', 'B', 'C']) {
      const gid = testId('group')
      db.exec(
        `INSERT INTO template_groups (id, template_id, label, group_type, transition_rest_sec, rest_after_round_sec, circuit_rest_mode)
         VALUES (?,?,?,?,?,?,?)`,
        [gid, 'tmpl-1', label, 'superset', 15, 120, 'after_round'],
      )
    }
    const rows = db.query(`SELECT * FROM template_groups WHERE template_id = 'tmpl-1'`)
    expect(rows).toHaveLength(3)
  })

  it('updates rest config', () => {
    const gid = testId('group')
    db.exec(
      `INSERT INTO template_groups (id, template_id, label, group_type, transition_rest_sec, rest_after_round_sec, circuit_rest_mode)
       VALUES (?,?,?,?,?,?,?)`,
      [gid, 'tmpl-1', 'A', 'superset', 15, 120, 'after_round'],
    )
    db.exec('UPDATE template_groups SET rest_after_round_sec = 180 WHERE id = ?', [gid])
    const rows = db.query<{ rest_after_round_sec: number }>(
      'SELECT rest_after_round_sec FROM template_groups WHERE id = ?',
      [gid],
    )
    expect(rows[0]?.rest_after_round_sec).toBe(180)
  })
})
