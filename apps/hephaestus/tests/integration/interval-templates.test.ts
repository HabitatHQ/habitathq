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

function insertIntervalTemplate(
  name: string,
  type = 'custom',
  workSec: number | null = null,
  restSec: number | null = null,
  rounds: number | null = null,
) {
  const id = testId('it')
  db.exec(
    'INSERT INTO interval_templates (id, name, intervals, created_at, type, work_sec, rest_sec, rounds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, '[]', NOW, type, workSec, restSec, rounds],
  )
  return id
}

describe('interval_templates — Phase 7 columns', () => {
  it('type defaults to custom', () => {
    const id = testId('it2')
    db.exec(
      'INSERT INTO interval_templates (id, name, intervals, created_at) VALUES (?, ?, ?, ?)',
      [id, 'Test', '[]', NOW],
    )
    const rows = db.query<{ type: string }>('SELECT type FROM interval_templates WHERE id = ?', [
      id,
    ])
    expect(rows[0].type).toBe('custom')
  })

  it('stores tabata parameters', () => {
    const id = insertIntervalTemplate('My Tabata', 'tabata', 20, 10, 8)
    const rows = db.query<{ type: string; work_sec: number; rest_sec: number; rounds: number }>(
      'SELECT type, work_sec, rest_sec, rounds FROM interval_templates WHERE id = ?',
      [id],
    )
    expect(rows[0].type).toBe('tabata')
    expect(rows[0].work_sec).toBe(20)
    expect(rows[0].rest_sec).toBe(10)
    expect(rows[0].rounds).toBe(8)
  })

  it('stores EMOM parameters', () => {
    const id = insertIntervalTemplate('EMOM 10', 'emom', 60, 0, 10)
    const rows = db.query<{ type: string; rounds: number }>(
      'SELECT type, rounds FROM interval_templates WHERE id = ?',
      [id],
    )
    expect(rows[0].type).toBe('emom')
    expect(rows[0].rounds).toBe(10)
  })

  it('can list all interval templates', () => {
    insertIntervalTemplate('Tabata A', 'tabata', 20, 10, 8)
    insertIntervalTemplate('EMOM 5', 'emom', 60, 0, 5)
    const rows = db.query('SELECT id FROM interval_templates')
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })

  it('deletes an interval template', () => {
    const id = insertIntervalTemplate('To Delete')
    db.exec('DELETE FROM interval_templates WHERE id = ?', [id])
    expect(db.query('SELECT id FROM interval_templates WHERE id = ?', [id])).toHaveLength(0)
  })

  it('can query by type', () => {
    insertIntervalTemplate('Tabata', 'tabata', 20, 10, 8)
    insertIntervalTemplate('EMOM', 'emom', 60, 0, 10)
    const tabatas = db.query('SELECT id FROM interval_templates WHERE type = ?', ['tabata'])
    expect(tabatas.length).toBeGreaterThanOrEqual(1)
  })
})
