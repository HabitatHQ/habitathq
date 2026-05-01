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

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function insertExercise(slug: string, name: string, movement = 'press') {
  const id = testId('ex')
  db.exec(
    `INSERT INTO exercises (id, name, slug, equipment, movement, muscles, muscles_sec, cues, icon, is_custom, created_at)
     VALUES (?, ?, ?, 'barbell', ?, '[]', '[]', NULL, 'i-ph-barbell', 0, ?)`,
    [id, name, slug, movement, NOW],
  )
  return id
}

function insertTemplate(name: string, description: string | null = null) {
  const id = testId('tpl')
  db.exec('INSERT INTO templates (id, name, description, created_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    description,
    NOW,
  ])
  return id
}

function insertTemplateExercise(
  templateId: string,
  exerciseId: string,
  orderNum: number,
  setsPlanned = 3,
  repsPlanned = '8',
) {
  const id = testId('te')
  db.exec(
    `INSERT INTO template_exercises
       (id, template_id, exercise_id, order_num, superset_group, sets_planned, reps_planned, rpe_target, increment_kg, rest_seconds)
     VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, 2.5, 120)`,
    [id, templateId, exerciseId, orderNum, setsPlanned, repsPlanned],
  )
  return id
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('templates — CRUD', () => {
  it('creates a template', () => {
    const id = insertTemplate('Push Day', 'Chest, shoulders, triceps')
    const rows = db.query<{ id: string; name: string; description: string | null }>(
      'SELECT id, name, description FROM templates WHERE id = ?',
      [id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Push Day')
    expect(rows[0].description).toBe('Chest, shoulders, triceps')
  })

  it('creates a template without description', () => {
    const id = insertTemplate('Full Body', null)
    const rows = db.query<{ description: string | null }>(
      'SELECT description FROM templates WHERE id = ?',
      [id],
    )
    expect(rows[0].description).toBeNull()
  })

  it('lists templates ordered by created_at DESC', () => {
    db.exec('INSERT INTO templates (id, name, description, created_at) VALUES (?, ?, NULL, ?)', [
      'tpl-first',
      'First Template',
      '2026-03-09T10:00:00Z',
    ])
    db.exec('INSERT INTO templates (id, name, description, created_at) VALUES (?, ?, NULL, ?)', [
      'tpl-second',
      'Second Template',
      '2026-03-10T10:00:00Z',
    ])
    const rows = db.query<{ name: string }>('SELECT name FROM templates ORDER BY created_at DESC')
    expect(rows[0].name).toBe('Second Template')
    expect(rows[1].name).toBe('First Template')
  })

  it('deletes a template', () => {
    const id = insertTemplate('To Delete')
    db.exec('DELETE FROM templates WHERE id = ?', [id])
    expect(db.query('SELECT id FROM templates WHERE id = ?', [id])).toHaveLength(0)
  })
})

describe('template_exercises — relationships', () => {
  it('adds exercises to a template in order', () => {
    const tplId = insertTemplate('PPL Push')
    const exBench = insertExercise('bench-press', 'Bench Press', 'press')
    const exOhp = insertExercise('ohp', 'Overhead Press', 'press')
    const exFly = insertExercise('cable-fly', 'Cable Fly', 'isolation')
    insertTemplateExercise(tplId, exBench, 1)
    insertTemplateExercise(tplId, exOhp, 2)
    insertTemplateExercise(tplId, exFly, 3)

    const rows = db.query<{ order_num: number; exercise_name: string }>(
      `SELECT te.order_num, e.name AS exercise_name
       FROM template_exercises te
       JOIN exercises e ON e.id = te.exercise_id
       WHERE te.template_id = ?
       ORDER BY te.order_num`,
      [tplId],
    )
    expect(rows.map((r) => r.order_num)).toEqual([1, 2, 3])
    expect(rows.map((r) => r.exercise_name)).toEqual(['Bench Press', 'Overhead Press', 'Cable Fly'])
  })

  it('stores sets_planned and reps_planned correctly', () => {
    const tplId = insertTemplate('Strength')
    const exId = insertExercise('squat', 'Squat', 'squat')
    insertTemplateExercise(tplId, exId, 1, 5, '5')

    const rows = db.query<{ sets_planned: number; reps_planned: string }>(
      'SELECT sets_planned, reps_planned FROM template_exercises WHERE template_id = ?',
      [tplId],
    )
    expect(rows[0].sets_planned).toBe(5)
    expect(rows[0].reps_planned).toBe('5')
  })

  it('JOIN fetches exercise_name, movement, and icon', () => {
    const tplId = insertTemplate('Test Template')
    const exId = insertExercise('deadlift', 'Deadlift', 'hinge')
    db.exec("UPDATE exercises SET icon = 'i-ph-arrows-down-up' WHERE id = ?", [exId])
    insertTemplateExercise(tplId, exId, 1)

    const rows = db.query<{
      exercise_name: string
      exercise_movement: string
      exercise_icon: string | null
    }>(
      `SELECT te.*, e.name AS exercise_name, e.movement AS exercise_movement, e.icon AS exercise_icon
       FROM template_exercises te
       JOIN exercises e ON e.id = te.exercise_id
       WHERE te.template_id = ?`,
      [tplId],
    )
    expect(rows[0].exercise_name).toBe('Deadlift')
    expect(rows[0].exercise_movement).toBe('hinge')
    expect(rows[0].exercise_icon).toBe('i-ph-arrows-down-up')
  })

  it('CASCADE deletes template_exercises when template is deleted', () => {
    const tplId = insertTemplate('Cascade Test')
    const exId = insertExercise('pull-up', 'Pull-up', 'row')
    const teId = insertTemplateExercise(tplId, exId, 1)

    db.exec('DELETE FROM templates WHERE id = ?', [tplId])

    const rows = db.query('SELECT id FROM template_exercises WHERE id = ?', [teId])
    expect(rows).toHaveLength(0)
  })

  it('counts exercises per template', () => {
    const tpl1 = insertTemplate('Push')
    const tpl2 = insertTemplate('Pull')
    const exA = insertExercise('bench', 'Bench Press', 'press')
    const exB = insertExercise('fly', 'Cable Fly', 'isolation')
    const exC = insertExercise('row', 'Row', 'row')
    insertTemplateExercise(tpl1, exA, 1)
    insertTemplateExercise(tpl1, exB, 2)
    insertTemplateExercise(tpl2, exC, 1)

    const rows = db.query<{ template_id: string; cnt: number }>(
      'SELECT template_id, COUNT(*) AS cnt FROM template_exercises GROUP BY template_id ORDER BY cnt DESC',
    )
    expect(rows[0].cnt).toBe(2)
    expect(rows[1].cnt).toBe(1)
  })
})

// ─── Phase 1: Schema v3 new columns ───────────────────────────────────────────

describe('templates — Phase 1 new columns', () => {
  it('archived_at defaults to NULL', () => {
    const id = insertTemplate('Archive Test')
    const rows = db.query<{ archived_at: string | null }>(
      'SELECT archived_at FROM templates WHERE id = ?',
      [id],
    )
    expect(rows[0].archived_at).toBeNull()
  })

  it('can set and query archived_at', () => {
    const id = insertTemplate('Archived')
    db.exec('UPDATE templates SET archived_at = ? WHERE id = ?', ['2026-03-10T12:00:00Z', id])
    const rows = db.query<{ archived_at: string | null }>(
      'SELECT archived_at FROM templates WHERE id = ?',
      [id],
    )
    expect(rows[0].archived_at).toBe('2026-03-10T12:00:00Z')
  })

  it('sort_order defaults to 0', () => {
    const id = insertTemplate('Sort Test')
    const rows = db.query<{ sort_order: number }>('SELECT sort_order FROM templates WHERE id = ?', [
      id,
    ])
    expect(rows[0].sort_order).toBe(0)
  })

  it('pinned_at defaults to NULL', () => {
    const id = insertTemplate('Pin Test')
    const rows = db.query<{ pinned_at: string | null }>(
      'SELECT pinned_at FROM templates WHERE id = ?',
      [id],
    )
    expect(rows[0].pinned_at).toBeNull()
  })

  it('last_used_at defaults to NULL', () => {
    const id = insertTemplate('Last Used Test')
    const rows = db.query<{ last_used_at: string | null }>(
      'SELECT last_used_at FROM templates WHERE id = ?',
      [id],
    )
    expect(rows[0].last_used_at).toBeNull()
  })

  it('use_count defaults to 0', () => {
    const id = insertTemplate('Use Count Test')
    const rows = db.query<{ use_count: number }>('SELECT use_count FROM templates WHERE id = ?', [
      id,
    ])
    expect(rows[0].use_count).toBe(0)
  })

  it('cover_emoji defaults to NULL', () => {
    const id = insertTemplate('Emoji Test')
    const rows = db.query<{ cover_emoji: string | null }>(
      'SELECT cover_emoji FROM templates WHERE id = ?',
      [id],
    )
    expect(rows[0].cover_emoji).toBeNull()
  })

  it('can set cover_emoji', () => {
    const id = insertTemplate('Emoji Set')
    db.exec('UPDATE templates SET cover_emoji = ? WHERE id = ?', ['💪', id])
    const rows = db.query<{ cover_emoji: string | null }>(
      'SELECT cover_emoji FROM templates WHERE id = ?',
      [id],
    )
    expect(rows[0].cover_emoji).toBe('💪')
  })

  it('can clone template by copying all fields', () => {
    const srcId = insertTemplate('Source', 'My template')
    db.exec('UPDATE templates SET cover_emoji = ?, sort_order = ? WHERE id = ?', ['🏋️', 2, srcId])
    const src = db.query<{
      name: string
      description: string | null
      cover_emoji: string | null
      sort_order: number
    }>('SELECT name, description, cover_emoji, sort_order FROM templates WHERE id = ?', [srcId])[0]!
    const cloneId = testId('tpl')
    db.exec(
      'INSERT INTO templates (id, name, description, cover_emoji, created_at) VALUES (?, ?, ?, ?, ?)',
      [cloneId, `Copy of ${src.name}`, src.description, src.cover_emoji, NOW],
    )
    const cloneRows = db.query<{ name: string; cover_emoji: string | null }>(
      'SELECT name, cover_emoji FROM templates WHERE id = ?',
      [cloneId],
    )
    expect(cloneRows[0].name).toBe('Copy of Source')
    expect(cloneRows[0].cover_emoji).toBe('🏋️')
  })

  it('filters out archived templates when archived_at IS NOT NULL', () => {
    const active = insertTemplate('Active Template')
    const archived = insertTemplate('Archived Template')
    db.exec('UPDATE templates SET archived_at = ? WHERE id = ?', [NOW, archived])
    const rows = db.query<{ id: string }>(
      'SELECT id FROM templates WHERE archived_at IS NULL ORDER BY created_at DESC',
    )
    expect(rows.map((r) => r.id)).toContain(active)
    expect(rows.map((r) => r.id)).not.toContain(archived)
  })

  it('shows archived templates when explicitly requested', () => {
    const active = insertTemplate('Active')
    const archived = insertTemplate('Archived')
    db.exec('UPDATE templates SET archived_at = ? WHERE id = ?', [NOW, archived])
    const rows = db.query<{ id: string }>('SELECT id FROM templates ORDER BY created_at DESC')
    expect(rows.map((r) => r.id)).toContain(active)
    expect(rows.map((r) => r.id)).toContain(archived)
  })

  it('can reorder templates by setting sort_order', () => {
    const t1 = insertTemplate('T1')
    const t2 = insertTemplate('T2')
    const t3 = insertTemplate('T3')
    db.exec('UPDATE templates SET sort_order = ? WHERE id = ?', [1, t1])
    db.exec('UPDATE templates SET sort_order = ? WHERE id = ?', [3, t2])
    db.exec('UPDATE templates SET sort_order = ? WHERE id = ?', [2, t3])
    const rows = db.query<{ id: string }>('SELECT id FROM templates ORDER BY sort_order ASC')
    expect(rows.map((r) => r.id)).toEqual([t1, t3, t2])
  })

  it('pinned templates sort before unpinned', () => {
    const _t1 = insertTemplate('Unpinned')
    const t2 = insertTemplate('Pinned')
    db.exec('UPDATE templates SET pinned_at = ? WHERE id = ?', [NOW, t2])
    const rows = db.query<{ id: string }>(`
      SELECT id FROM templates
      ORDER BY CASE WHEN pinned_at IS NOT NULL THEN 0 ELSE 1 END,
               sort_order ASC, created_at DESC
    `)
    expect(rows[0].id).toBe(t2)
  })

  it('increments use_count on mark_used', () => {
    const id = insertTemplate('Marked')
    db.exec('UPDATE templates SET use_count = use_count + 1, last_used_at = ? WHERE id = ?', [
      NOW,
      id,
    ])
    const rows = db.query<{ use_count: number; last_used_at: string | null }>(
      'SELECT use_count, last_used_at FROM templates WHERE id = ?',
      [id],
    )
    expect(rows[0].use_count).toBe(1)
    expect(rows[0].last_used_at).toBe(NOW)
  })
})
