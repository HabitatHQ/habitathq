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

function insertProgram(name: string, weeks = 4) {
  const id = testId('prog')
  db.exec('INSERT INTO programs (id, name, weeks, created_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    weeks,
    NOW,
  ])
  return id
}

function insertProgramWeek(programId: string, weekNum: number, isDeload = 0) {
  const id = testId('pw')
  db.exec('INSERT INTO program_weeks (id, program_id, week_num, is_deload) VALUES (?, ?, ?, ?)', [
    id,
    programId,
    weekNum,
    isDeload,
  ])
  return id
}

function insertProgramDay(
  weekId: string,
  dayNum: number,
  templateId: string | null = null,
  label: string | null = null,
) {
  const id = testId('pd')
  db.exec(
    'INSERT INTO program_days (id, week_id, day_num, template_id, label) VALUES (?, ?, ?, ?, ?)',
    [id, weekId, dayNum, templateId, label],
  )
  return id
}

function insertTemplate(name: string) {
  const id = testId('tpl')
  db.exec('INSERT INTO templates (id, name, created_at) VALUES (?, ?, ?)', [id, name, NOW])
  return id
}

describe('programs — CRUD', () => {
  it('creates a program', () => {
    const id = insertProgram('5/3/1', 4)
    const rows = db.query<{ name: string; weeks: number }>(
      'SELECT name, weeks FROM programs WHERE id = ?',
      [id],
    )
    expect(rows[0].name).toBe('5/3/1')
    expect(rows[0].weeks).toBe(4)
  })

  it('current_week defaults to 1', () => {
    const id = insertProgram('PPL')
    const rows = db.query<{ current_week: number }>(
      'SELECT current_week FROM programs WHERE id = ?',
      [id],
    )
    expect(rows[0].current_week).toBe(1)
  })

  it('active defaults to 0', () => {
    const id = insertProgram('GZCLP')
    const rows = db.query<{ active: number }>('SELECT active FROM programs WHERE id = ?', [id])
    expect(rows[0].active).toBe(0)
  })

  it('only one program can be active', () => {
    const p1 = insertProgram('PPL')
    const p2 = insertProgram('PHUL')
    db.exec('UPDATE programs SET active = 0')
    db.exec('UPDATE programs SET active = 1 WHERE id = ?', [p1])
    db.exec('UPDATE programs SET active = 0')
    db.exec('UPDATE programs SET active = 1 WHERE id = ?', [p2])
    const active = db.query<{ id: string }>('SELECT id FROM programs WHERE active = 1')
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe(p2)
  })
})

describe('program_weeks', () => {
  it('creates weeks with deload support', () => {
    const progId = insertProgram('5/3/1')
    const _w1 = insertProgramWeek(progId, 1)
    const _w4 = insertProgramWeek(progId, 4, 1)
    const rows = db.query<{ week_num: number; is_deload: number }>(
      'SELECT week_num, is_deload FROM program_weeks WHERE program_id = ? ORDER BY week_num',
      [progId],
    )
    expect(rows[0].is_deload).toBe(0)
    expect(rows[1].is_deload).toBe(1)
  })

  it('intensity_modifier defaults to 1.0', () => {
    const progId = insertProgram('Test')
    const weekId = insertProgramWeek(progId, 1)
    const rows = db.query<{ intensity_modifier: number }>(
      'SELECT intensity_modifier FROM program_weeks WHERE id = ?',
      [weekId],
    )
    expect(rows[0].intensity_modifier).toBe(1.0)
  })

  it('cascades delete weeks when program is deleted', () => {
    const progId = insertProgram('Test')
    const weekId = insertProgramWeek(progId, 1)
    db.exec('DELETE FROM programs WHERE id = ?', [progId])
    expect(db.query('SELECT id FROM program_weeks WHERE id = ?', [weekId])).toHaveLength(0)
  })
})

describe('program_days', () => {
  it('assigns a template to a day', () => {
    const progId = insertProgram('PPL')
    const tplId = insertTemplate('Push A')
    const weekId = insertProgramWeek(progId, 1)
    const dayId = insertProgramDay(weekId, 1, tplId, 'Monday Push')

    const rows = db.query<{ template_id: string | null; label: string | null }>(
      'SELECT template_id, label FROM program_days WHERE id = ?',
      [dayId],
    )
    expect(rows[0].template_id).toBe(tplId)
    expect(rows[0].label).toBe('Monday Push')
  })

  it('supports rest days (null template)', () => {
    const progId = insertProgram('PPL')
    const weekId = insertProgramWeek(progId, 1)
    const dayId = insertProgramDay(weekId, 0, null, 'Rest')
    const rows = db.query<{ template_id: string | null }>(
      'SELECT template_id FROM program_days WHERE id = ?',
      [dayId],
    )
    expect(rows[0].template_id).toBeNull()
  })

  it("can fetch today's program days by day_num", () => {
    const progId = insertProgram('PPL')
    const tplId = insertTemplate('Push A')
    const weekId = insertProgramWeek(progId, 1)
    insertProgramDay(weekId, 2, tplId, 'Tuesday Push') // day 2 = Tuesday
    insertProgramDay(weekId, 4, null, 'Thursday Pull')

    const todayRows = db.query<{ label: string | null }>(
      `SELECT pd.label FROM program_days pd
       JOIN program_weeks pw ON pw.id = pd.week_id
       WHERE pw.program_id = ? AND pd.day_num = ?`,
      [progId, 2],
    )
    expect(todayRows.map((r) => r.label)).toContain('Tuesday Push')
  })
})
