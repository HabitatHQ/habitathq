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

function insertTemplate(name: string) {
  const id = testId('tpl')
  db.exec('INSERT INTO templates (id, name, created_at) VALUES (?, ?, ?)', [id, name, NOW])
  return id
}

function insertFolder(name: string, color: string | null = null) {
  const id = testId('fld')
  db.exec('INSERT INTO template_folders (id, name, color, created_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    color,
    NOW,
  ])
  return id
}

function insertTag(name: string) {
  const id = testId('tag')
  db.exec(
    "INSERT INTO tags (id, name, category, is_predefined, created_at) VALUES (?, ?, 'custom', 0, ?)",
    [id, name, NOW],
  )
  return id
}

describe('template_folders — CRUD', () => {
  it('creates a folder', () => {
    const id = insertFolder('Push Day', 'orange')
    const rows = db.query<{ name: string; color: string | null }>(
      'SELECT name, color FROM template_folders WHERE id = ?',
      [id],
    )
    expect(rows[0].name).toBe('Push Day')
    expect(rows[0].color).toBe('orange')
  })

  it('sort_order defaults to 0', () => {
    const id = insertFolder('Test')
    const rows = db.query<{ sort_order: number }>(
      'SELECT sort_order FROM template_folders WHERE id = ?',
      [id],
    )
    expect(rows[0].sort_order).toBe(0)
  })

  it('can reorder folders', () => {
    const f1 = insertFolder('F1')
    const f2 = insertFolder('F2')
    const f3 = insertFolder('F3')
    db.exec('UPDATE template_folders SET sort_order = 3 WHERE id = ?', [f1])
    db.exec('UPDATE template_folders SET sort_order = 1 WHERE id = ?', [f2])
    db.exec('UPDATE template_folders SET sort_order = 2 WHERE id = ?', [f3])
    const rows = db.query<{ id: string }>('SELECT id FROM template_folders ORDER BY sort_order ASC')
    expect(rows.map((r) => r.id)).toEqual([f2, f3, f1])
  })

  it('deletes a folder', () => {
    const id = insertFolder('To Delete')
    db.exec('DELETE FROM template_folders WHERE id = ?', [id])
    expect(db.query('SELECT id FROM template_folders WHERE id = ?', [id])).toHaveLength(0)
  })
})

describe('template_folder_items', () => {
  it('adds a template to a folder', () => {
    const tpl = insertTemplate('Push A')
    const fld = insertFolder('Push Day')
    db.exec(
      'INSERT INTO template_folder_items (template_id, folder_id, sort_order) VALUES (?, ?, 0)',
      [tpl, fld],
    )
    const rows = db.query<{ template_id: string }>(
      'SELECT template_id FROM template_folder_items WHERE folder_id = ?',
      [fld],
    )
    expect(rows[0].template_id).toBe(tpl)
  })

  it('cascades delete when folder is deleted', () => {
    const tpl = insertTemplate('Push A')
    const fld = insertFolder('Folder')
    db.exec(
      'INSERT INTO template_folder_items (template_id, folder_id, sort_order) VALUES (?, ?, 0)',
      [tpl, fld],
    )
    db.exec('DELETE FROM template_folders WHERE id = ?', [fld])
    const rows = db.query('SELECT * FROM template_folder_items WHERE folder_id = ?', [fld])
    expect(rows).toHaveLength(0)
  })

  it('cascades delete when template is deleted', () => {
    const tpl = insertTemplate('Push A')
    const fld = insertFolder('Folder')
    db.exec(
      'INSERT INTO template_folder_items (template_id, folder_id, sort_order) VALUES (?, ?, 0)',
      [tpl, fld],
    )
    db.exec('DELETE FROM templates WHERE id = ?', [tpl])
    const rows = db.query('SELECT * FROM template_folder_items WHERE template_id = ?', [tpl])
    expect(rows).toHaveLength(0)
  })

  it('fetches templates in a folder via JOIN', () => {
    const t1 = insertTemplate('Push A')
    const t2 = insertTemplate('Push B')
    const _t3 = insertTemplate('Pull A')
    const fld = insertFolder('Push Day')
    db.exec(
      'INSERT INTO template_folder_items (template_id, folder_id, sort_order) VALUES (?, ?, 0)',
      [t1, fld],
    )
    db.exec(
      'INSERT INTO template_folder_items (template_id, folder_id, sort_order) VALUES (?, ?, 1)',
      [t2, fld],
    )

    const rows = db.query<{ name: string }>(
      `SELECT t.name FROM templates t
       JOIN template_folder_items tfi ON tfi.template_id = t.id
       WHERE tfi.folder_id = ?
       ORDER BY tfi.sort_order`,
      [fld],
    )
    expect(rows.map((r) => r.name)).toEqual(['Push A', 'Push B'])
    expect(rows.map((r) => r.name)).not.toContain('Pull A')
  })
})

describe('template_tags', () => {
  it('adds a tag to a template', () => {
    const tpl = insertTemplate('Push Day')
    const tag = insertTag('strength')
    db.exec('INSERT INTO template_tags (template_id, tag_id) VALUES (?, ?)', [tpl, tag])
    const rows = db.query<{ tag_id: string }>(
      'SELECT tag_id FROM template_tags WHERE template_id = ?',
      [tpl],
    )
    expect(rows[0].tag_id).toBe(tag)
  })

  it('cascades delete when template is deleted', () => {
    const tpl = insertTemplate('Push Day')
    const tag = insertTag('hypertrophy')
    db.exec('INSERT INTO template_tags (template_id, tag_id) VALUES (?, ?)', [tpl, tag])
    db.exec('DELETE FROM templates WHERE id = ?', [tpl])
    expect(db.query('SELECT * FROM template_tags WHERE template_id = ?', [tpl])).toHaveLength(0)
  })

  it('can filter templates by tag', () => {
    const t1 = insertTemplate('Push A')
    const t2 = insertTemplate('Pull A')
    const tag = insertTag('strength')
    db.exec('INSERT INTO template_tags (template_id, tag_id) VALUES (?, ?)', [t1, tag])

    const rows = db.query<{ template_id: string }>(
      'SELECT template_id FROM template_tags WHERE tag_id = ?',
      [tag],
    )
    expect(rows.map((r) => r.template_id)).toContain(t1)
    expect(rows.map((r) => r.template_id)).not.toContain(t2)
  })

  it('enforces unique constraint (no duplicate tags per template)', () => {
    const tpl = insertTemplate('Push Day')
    const tag = insertTag('endurance')
    db.exec('INSERT INTO template_tags (template_id, tag_id) VALUES (?, ?)', [tpl, tag])
    expect(() => {
      db.exec('INSERT INTO template_tags (template_id, tag_id) VALUES (?, ?)', [tpl, tag])
    }).toThrow()
  })
})
