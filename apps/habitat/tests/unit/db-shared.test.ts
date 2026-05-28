/**
 * Tests for db-shared.ts shared DB operations.
 * Uses a MockDbAdapter that records calls and returns pre-configured rows.
 * All tests are RED until db-shared.ts is implemented.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DbAdapter } from '~/types/database'
import * as shared from '~/lib/db-shared'
import { buildUpdatePairs } from '~/lib/db-shared'

// ─── buildUpdatePairs ────────────────────────────────────────────────────────

describe('buildUpdatePairs', () => {
  it('picks scalar fields present in the object', () => {
    const pairs = buildUpdatePairs({ name: 'Alice', age: 30 }, [
      { kind: 'scalar', name: 'name' },
      { kind: 'scalar', name: 'age' },
      { kind: 'scalar', name: 'missing' },
    ])
    expect(pairs).toEqual([['name', 'Alice'], ['age', 30]])
  })

  it('handles nullable fields with default null', () => {
    const pairs = buildUpdatePairs({ paused_until: undefined }, [
      { kind: 'nullable', name: 'paused_until' },
    ])
    expect(pairs).toEqual([['paused_until', null]])
  })

  it('handles nullable fields with custom fallback', () => {
    const pairs = buildUpdatePairs({ title: undefined }, [
      { kind: 'nullable', name: 'title', fallback: '' },
    ])
    expect(pairs).toEqual([['title', '']])
  })

  it('handles json fields with fallback', () => {
    const pairs = buildUpdatePairs({ tags: ['a', 'b'] }, [
      { kind: 'json', name: 'tags', fallback: [] },
    ])
    expect(pairs).toEqual([['tags', '["a","b"]']])
  })

  it('uses json fallback when value is nullish', () => {
    const pairs = buildUpdatePairs({ tags: null }, [
      { kind: 'json', name: 'tags', fallback: [] },
    ])
    expect(pairs).toEqual([['tags', '[]']])
  })

  it('handles json-nullable: stringify if non-null, null if null', () => {
    const pairs = buildUpdatePairs({ days: [1, 3], other: null }, [
      { kind: 'json-nullable', name: 'days' },
      { kind: 'json-nullable', name: 'other' },
    ])
    expect(pairs).toEqual([['days', '[1,3]'], ['other', null]])
  })

  it('handles bool fields (value → 0|1)', () => {
    const pairs = buildUpdatePairs({ is_recurring: true, show_in_bored: false }, [
      { kind: 'bool', name: 'is_recurring' },
      { kind: 'bool', name: 'show_in_bored' },
    ])
    expect(pairs).toEqual([['is_recurring', 1], ['show_in_bored', 0]])
  })

  it('skips fields not present in the object', () => {
    const pairs = buildUpdatePairs({}, [
      { kind: 'scalar', name: 'name' },
      { kind: 'json', name: 'tags', fallback: [] },
      { kind: 'bool', name: 'active' },
    ])
    expect(pairs).toEqual([])
  })
})

// ─── MockDbAdapter ────────────────────────────────────────────────────────────

class MockDbAdapter implements DbAdapter {
  calls: { method: string; sql: string; bind?: unknown[] }[] = []
  private rows: Map<string, unknown[]> = new Map()

  /** Pre-configure rows to be returned for a specific SQL call (substring match). */
  setRows(sqlSubstring: string, rows: unknown[]) {
    this.rows.set(sqlSubstring, rows)
  }

  private findRows(sql: string): unknown[] {
    for (const [key, rows] of this.rows) {
      if (sql.includes(key)) return rows
    }
    return []
  }

  async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
    this.calls.push({ method: 'queryAll', sql, bind })
    return this.findRows(sql) as T[]
  }

  async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
    this.calls.push({ method: 'queryOne', sql, bind })
    const rows = this.findRows(sql) as T[]
    return rows[0] ?? null
  }

  async exec(sql: string, bind?: unknown[]): Promise<void> {
    this.calls.push({ method: 'exec', sql, bind })
  }
}

// ─── Row factories ────────────────────────────────────────────────────────────

function habitRow(id = 'h1'): Record<string, unknown> {
  return {
    id, name: 'Exercise', description: '', color: '#22d3ee', icon: 'bolt',
    frequency: 'daily', created_at: '2025-01-01T00:00:00Z', archived_at: null,
    tags: '[]', annotations: '{}', type: 'BOOLEAN', target_value: 1, paused_until: null,
    sched_id: 's1', schedule_type: 'DAILY', frequency_count: null,
    days_of_week: null, due_time: null, start_date: '2025-01-01', end_date: null,
  }
}

function completionRow(id = 'c1'): Record<string, unknown> {
  return {
    id, habit_id: 'h1', date: '2025-01-01', completed_at: '2025-01-01T08:00:00Z',
    notes: '', tags: '[]', annotations: '{}',
  }
}

function todoRow(id = 't1'): Record<string, unknown> {
  return {
    id, title: 'Buy milk', description: '', due_date: null, priority: 'medium',
    estimated_minutes: null, is_done: 0, done_at: null, done_count: 0, last_done_at: null,
    tags: '[]', annotations: '{}', is_recurring: 0, recurrence_rule: null,
    show_in_bored: 0, bored_category_id: null, archived_at: null,
    created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
  }
}

function scribbleRow(id = 'sc1'): Record<string, unknown> {
  return {
    id, title: 'Note', content: 'Hello', tags: '[]', annotations: '{}',
    created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
  }
}

function reminderRow(id = 'r1'): Record<string, unknown> {
  return { id, habit_id: 'h1', trigger_time: '08:00', days_active: null }
}

function checkinTemplateRow(id = 'ct1'): Record<string, unknown> {
  return { id, title: 'Morning', schedule_type: 'DAILY', days_active: null, response_day_count: 0 }
}

function checkinQuestionRow(id = 'cq1'): Record<string, unknown> {
  return { id, template_id: 'ct1', prompt: 'How are you?', response_type: 'TEXT', display_order: 0, desired_answer: 1 }
}

function checkinResponseRow(id = 'cr1'): Record<string, unknown> {
  return { id, question_id: 'cq1', logged_date: '2025-01-01', value_numeric: null, value_text: 'Good' }
}

function checkinReminderRow(id = 'crem1'): Record<string, unknown> {
  return { id, template_id: 'ct1', trigger_time: '08:00', days_active: null }
}

function boredCategoryRow(id = 'bc1'): Record<string, unknown> {
  return { id, name: 'Fun', icon: 'star', color: '#22d3ee', is_system: 0, sort_order: 0, created_at: '2025-01-01T00:00:00Z' }
}

function boredActivityRow(id = 'ba1'): Record<string, unknown> {
  return {
    id, title: 'Read a book', description: '', category_id: 'bc1',
    estimated_minutes: 30, tags: '[]', annotations: '{}',
    is_recurring: 0, recurrence_rule: null, is_done: 0, done_at: null,
    done_count: 0, last_done_at: null, archived_at: null, created_at: '2025-01-01T00:00:00Z',
  }
}

function habitLogRow(id = 'hl1'): Record<string, unknown> {
  return { id, habit_id: 'h1', date: '2025-01-01', logged_at: '2025-01-01T08:00:00Z', value: 5, notes: '' }
}

// ─── Habits ───────────────────────────────────────────────────────────────────

describe('getHabits', () => {
  it('queries non-archived habits ordered by created_at', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM habits', [habitRow()])
    const result = await shared.getHabits(db)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('h1')
    const call = db.calls[0]!
    expect(call.sql).toContain('archived_at IS NULL')
    expect(call.sql).toContain('ORDER BY')
  })
})

describe('createHabit', () => {
  it('inserts habit + schedule and returns parsed result', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE h.id', [habitRow()])
    await shared.createHabit(db, { name: 'Run', description: '', color: '#fff', icon: 'i-x', frequency: 'daily', tags: [], annotations: {}, type: 'BOOLEAN', target_value: 1, paused_until: null, why: '' })
    const execCalls = db.calls.filter(c => c.method === 'exec')
    expect(execCalls.length).toBeGreaterThanOrEqual(2) // habits + habit_schedules
    expect(execCalls[0]!.sql).toContain('INSERT INTO habits')
    expect(execCalls[1]!.sql).toContain('INSERT INTO habit_schedules')
  })

  it('passes why field to INSERT statement', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE h.id', [habitRow()])
    await shared.createHabit(db, { name: 'Run', description: '', color: '#fff', icon: 'i-x', frequency: 'daily', tags: [], annotations: {}, type: 'BOOLEAN', target_value: 1, paused_until: null, why: 'Stay fit' })
    const insert = db.calls.find(c => c.method === 'exec' && c.sql.includes('INSERT INTO habits'))!
    expect(insert.sql).toContain('why')
    expect(insert.bind).toContain('Stay fit')
  })
})

describe('updateHabit', () => {
  it('updates specified fields and returns the updated habit', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE h.id', [habitRow()])
    await shared.updateHabit(db, { id: 'h1', name: 'Updated' })
    const execCalls = db.calls.filter(c => c.method === 'exec')
    expect(execCalls[0]!.sql).toContain('UPDATE habits SET')
    expect(execCalls[0]!.sql).toContain('name = ?')
  })

  it('skips update if no fields provided', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE h.id', [habitRow()])
    await shared.updateHabit(db, { id: 'h1' })
    const execCalls = db.calls.filter(c => c.method === 'exec')
    expect(execCalls).toHaveLength(0)
  })

  it('updates why field', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE h.id', [habitRow()])
    await shared.updateHabit(db, { id: 'h1', why: 'Because health matters' })
    const execCalls = db.calls.filter(c => c.method === 'exec')
    expect(execCalls[0]!.sql).toContain('why = ?')
    expect(execCalls[0]!.bind).toContain('Because health matters')
  })
})

describe('archiveHabit', () => {
  it('sets archived_at on the habit', async () => {
    const db = new MockDbAdapter()
    await shared.archiveHabit(db, 'h1')
    const call = db.calls.find(c => c.method === 'exec')!
    expect(call.sql).toContain('UPDATE habits SET archived_at')
    expect(call.bind?.[1]).toBe('h1')
  })
})

describe('deleteHabit', () => {
  it('deletes the habit by id', async () => {
    const db = new MockDbAdapter()
    await shared.deleteHabit(db, 'h1')
    const call = db.calls[0]!
    expect(call.sql).toContain('DELETE FROM habits')
    expect(call.bind?.[0]).toBe('h1')
  })
})

describe('getArchivedHabits', () => {
  it('queries habits where archived_at IS NOT NULL', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM habits', [habitRow()])
    await shared.getArchivedHabits(db)
    expect(db.calls[0]!.sql).toContain('archived_at IS NOT NULL')
  })
})

// ─── Completions ──────────────────────────────────────────────────────────────

describe('getCompletionsForDate', () => {
  it('queries completions by date', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM completions', [completionRow()])
    const result = await shared.getCompletionsForDate(db, '2025-01-01')
    expect(result).toHaveLength(1)
    expect(db.calls[0]!.bind).toContain('2025-01-01')
  })
})

describe('toggleCompletion', () => {
  it('deletes existing completion and returns null', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE habit_id = ? AND date = ?', [completionRow()])
    const result = await shared.toggleCompletion(db, 'h1', '2025-01-01')
    expect(result).toBeNull()
    const del = db.calls.find(c => c.method === 'exec' && c.sql.includes('DELETE'))!
    expect(del.sql).toContain('DELETE FROM completions')
  })

  it('creates completion when none exists and returns it', async () => {
    const db = new MockDbAdapter()
    // First queryAll (check existing) returns empty; second (fetch by id) returns the row
    let callCount = 0
    db.queryAll = async function<T>(sql: string, bind?: unknown[]) {
      this.calls.push({ method: 'queryAll', sql, bind })
      callCount++
      if (callCount === 1) return []
      return [completionRow() as T]
    }
    const result = await shared.toggleCompletion(db, 'h1', '2025-01-01')
    expect(result).not.toBeNull()
    expect(result?.habit_id).toBe('h1')
  })
})

// ─── Habit logs ───────────────────────────────────────────────────────────────

describe('getHabitLogsForDate', () => {
  it('queries habit_logs by date', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM habit_logs', [habitLogRow()])
    const result = await shared.getHabitLogsForDate(db, '2025-01-01')
    expect(result).toHaveLength(1)
    expect(db.calls[0]!.bind).toContain('2025-01-01')
  })
})

describe('logHabitValue', () => {
  it('inserts a habit log entry', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [habitLogRow()])
    await shared.logHabitValue(db, 'h1', '2025-01-01', 3)
    const insert = db.calls.find(c => c.method === 'exec')!
    expect(insert.sql).toContain('INSERT INTO habit_logs')
  })
})

describe('deleteHabitLog', () => {
  it('deletes the log by id', async () => {
    const db = new MockDbAdapter()
    await shared.deleteHabitLog(db, 'hl1')
    expect(db.calls[0]!.sql).toContain('DELETE FROM habit_logs')
    expect(db.calls[0]!.bind?.[0]).toBe('hl1')
  })
})

// ─── Schedules ────────────────────────────────────────────────────────────────

describe('getScheduleForHabit', () => {
  it('returns null when no schedule found', async () => {
    const db = new MockDbAdapter()
    const result = await shared.getScheduleForHabit(db, 'h1')
    expect(result).toBeNull()
  })
})

describe('pauseHabit', () => {
  it('updates paused_until on the habit', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE h.id', [habitRow()])
    await shared.pauseHabit(db, 'h1', '2025-02-01')
    const call = db.calls.find(c => c.method === 'exec')!
    expect(call.sql).toContain('paused_until')
    expect(call.bind?.[0]).toBe('2025-02-01')
  })
})

// ─── Scribbles ────────────────────────────────────────────────────────────────

describe('getScribbles', () => {
  it('returns scribbles ordered by updated_at DESC', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM scribbles', [scribbleRow()])
    const result = await shared.getScribbles(db)
    expect(result).toHaveLength(1)
    expect(db.calls[0]!.sql).toContain('updated_at DESC')
  })
})

describe('createScribble', () => {
  it('inserts a scribble and returns it', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [scribbleRow()])
    await shared.createScribble(db, { title: 'Note', content: 'Hello', tags: [], annotations: {} })
    const insert = db.calls.find(c => c.method === 'exec')!
    expect(insert.sql).toContain('INSERT INTO scribbles')
  })
})

describe('deleteScribble', () => {
  it('deletes the scribble by id', async () => {
    const db = new MockDbAdapter()
    await shared.deleteScribble(db, 'sc1')
    expect(db.calls[0]!.sql).toContain('DELETE FROM scribbles')
    expect(db.calls[0]!.bind?.[0]).toBe('sc1')
  })
})

// ─── Reminders ────────────────────────────────────────────────────────────────

describe('getAllReminders', () => {
  it('returns reminders ordered by trigger_time', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM reminders', [reminderRow()])
    const result = await shared.getAllReminders(db)
    expect(result).toHaveLength(1)
    expect(result[0]!.habit_id).toBe('h1')
  })
})

describe('createReminder', () => {
  it('inserts a reminder and returns it', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [reminderRow()])
    await shared.createReminder(db, 'h1', '08:00', null)
    const insert = db.calls.find(c => c.method === 'exec')!
    expect(insert.sql).toContain('INSERT INTO reminders')
    expect(insert.bind?.[1]).toBe('h1')
  })
})

// ─── Check-in templates ───────────────────────────────────────────────────────

describe('getCheckinTemplates', () => {
  it('returns templates with response_day_count', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM checkin_templates', [checkinTemplateRow()])
    const result = await shared.getCheckinTemplates(db)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('ct1')
  })
})

describe('createCheckinTemplate', () => {
  it('inserts a template and returns it', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [checkinTemplateRow()])
    await shared.createCheckinTemplate(db, { title: 'Morning', schedule_type: 'DAILY', days_active: null, response_day_count: 0 })
    const insert = db.calls.find(c => c.method === 'exec')!
    expect(insert.sql).toContain('INSERT INTO checkin_templates')
  })
})

describe('deleteCheckinTemplate', () => {
  it('archives the template by id', async () => {
    const db = new MockDbAdapter()
    await shared.deleteCheckinTemplate(db, 'ct1')
    expect(db.calls[0]!.sql).toContain('UPDATE checkin_templates SET archived_at')
  })
})

// ─── Check-in questions ───────────────────────────────────────────────────────

describe('getCheckinQuestions', () => {
  it('queries questions for a template ordered by display_order', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM checkin_questions', [checkinQuestionRow()])
    const result = await shared.getCheckinQuestions(db, 'ct1')
    expect(result).toHaveLength(1)
    expect(db.calls[0]!.bind).toContain('ct1')
  })
})

describe('createCheckinQuestion', () => {
  it('inserts a question', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [checkinQuestionRow()])
    await shared.createCheckinQuestion(db, { template_id: 'ct1', prompt: 'How?', response_type: 'TEXT', display_order: 0, desired_answer: 1 })
    const insert = db.calls.find(c => c.method === 'exec')!
    expect(insert.sql).toContain('INSERT INTO checkin_questions')
  })
})

// ─── Check-in responses ───────────────────────────────────────────────────────

describe('getCheckinResponses', () => {
  it('queries responses for template+date', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM checkin_responses', [checkinResponseRow()])
    const result = await shared.getCheckinResponses(db, 'ct1', '2025-01-01')
    expect(result).toHaveLength(1)
    expect(db.calls[0]!.bind).toContain('ct1')
    expect(db.calls[0]!.bind).toContain('2025-01-01')
  })
})

describe('upsertCheckinResponse', () => {
  it('updates existing response', async () => {
    const db = new MockDbAdapter()
    let callCount = 0
    db.queryAll = async function<T>(sql: string, bind?: unknown[]) {
      this.calls.push({ method: 'queryAll', sql, bind })
      callCount++
      if (callCount === 1) return [{ id: 'cr1' } as T] // existing
      return [checkinResponseRow() as T]
    }
    await shared.upsertCheckinResponse(db, 'cq1', '2025-01-01', null, 'Good')
    const update = db.calls.find(c => c.method === 'exec' && c.sql.includes('UPDATE'))!
    expect(update.sql).toContain('UPDATE checkin_responses')
  })

  it('inserts new response when none exists', async () => {
    const db = new MockDbAdapter()
    let callCount = 0
    db.queryAll = async function<T>(sql: string, bind?: unknown[]) {
      this.calls.push({ method: 'queryAll', sql, bind })
      callCount++
      if (callCount === 1) return []
      return [checkinResponseRow() as T]
    }
    await shared.upsertCheckinResponse(db, 'cq1', '2025-01-01', null, 'Good')
    const insert = db.calls.find(c => c.method === 'exec' && c.sql.includes('INSERT'))!
    expect(insert.sql).toContain('INSERT INTO checkin_responses')
  })
})

// ─── Check-in reminders ───────────────────────────────────────────────────────

describe('createCheckinReminder', () => {
  it('inserts a checkin reminder', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [checkinReminderRow()])
    await shared.createCheckinReminder(db, 'ct1', '08:00', null)
    const insert = db.calls.find(c => c.method === 'exec')!
    expect(insert.sql).toContain('INSERT INTO checkin_reminders')
  })
})

describe('deleteCheckinReminder', () => {
  it('deletes the reminder by id', async () => {
    const db = new MockDbAdapter()
    await shared.deleteCheckinReminder(db, 'crem1')
    expect(db.calls[0]!.sql).toContain('DELETE FROM checkin_reminders')
  })
})

// ─── Check-in entries ─────────────────────────────────────────────────────────

describe('upsertCheckinEntry', () => {
  it('inserts when no existing entry', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [{ id: 'e1', entry_date: '2025-01-01', content: 'hi', created_at: 't', updated_at: 't' }])
    await shared.upsertCheckinEntry(db, '2025-01-01', 'hello')
    const insert = db.calls.find(c => c.method === 'exec' && c.sql.includes('INSERT'))!
    expect(insert.sql).toContain('INSERT INTO checkin_entries')
  })
})

// ─── Bored categories ─────────────────────────────────────────────────────────

describe('getBoredCategories', () => {
  it('returns categories ordered by system first', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM bored_categories', [boredCategoryRow()])
    const result = await shared.getBoredCategories(db)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Fun')
  })
})

describe('createBoredCategory', () => {
  it('inserts a category', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [boredCategoryRow()])
    await shared.createBoredCategory(db, { name: 'Fun', icon: 'i-x', color: '#fff', is_system: false, sort_order: 0 })
    const insert = db.calls.find(c => c.method === 'exec')!
    expect(insert.sql).toContain('INSERT INTO bored_categories')
  })
})

describe('deleteBoredCategory', () => {
  it('only deletes non-system categories', async () => {
    const db = new MockDbAdapter()
    await shared.deleteBoredCategory(db, 'bc1')
    expect(db.calls[0]!.sql).toContain('is_system = 0')
  })
})

// ─── Bored activities ─────────────────────────────────────────────────────────

describe('getBoredActivities', () => {
  it('returns non-archived activities', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM bored_activities', [boredActivityRow()])
    const result = await shared.getBoredActivities(db)
    expect(result).toHaveLength(1)
    expect(db.calls[0]!.sql).toContain('archived_at IS NULL')
  })
})

describe('markBoredActivityDone', () => {
  it('archives non-recurring activity (is_done = 1)', async () => {
    const db = new MockDbAdapter()
    let callCount = 0
    db.queryAll = async function<T>(sql: string, bind?: unknown[]) {
      this.calls.push({ method: 'queryAll', sql, bind })
      callCount++
      const row = callCount === 1
        ? boredActivityRow()
        : { ...boredActivityRow(), is_done: 1 }
      return [row as T]
    }
    const result = await shared.markBoredActivityDone(db, 'ba1')
    expect(result.is_done).toBe(true)
    const update = db.calls.find(c => c.method === 'exec')!
    expect(update.sql).toContain('is_done = 1')
  })

  it('increments done_count for recurring activity without marking done', async () => {
    const db = new MockDbAdapter()
    let callCount = 0
    db.queryAll = async function<T>(sql: string, bind?: unknown[]) {
      this.calls.push({ method: 'queryAll', sql, bind })
      callCount++
      const row = callCount === 1
        ? { ...boredActivityRow(), is_recurring: 1 }
        : boredActivityRow()
      return [row as T]
    }
    await shared.markBoredActivityDone(db, 'ba1')
    const update = db.calls.find(c => c.method === 'exec')!
    expect(update.sql).not.toContain('is_done = 1')
    expect(update.sql).toContain('done_count')
  })
})

// ─── Todos ────────────────────────────────────────────────────────────────────

describe('getTodos', () => {
  it('returns non-archived todos', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM todos', [todoRow()])
    const result = await shared.getTodos(db)
    expect(result).toHaveLength(1)
    expect(db.calls[0]!.sql).toContain('archived_at IS NULL')
  })
})

describe('createTodo', () => {
  it('inserts a todo and returns it', async () => {
    const db = new MockDbAdapter()
    db.setRows('WHERE id = ?', [todoRow()])
    await shared.createTodo(db, {
      title: 'Buy milk', description: '', due_date: null, priority: 'medium',
      estimated_minutes: null, tags: [], annotations: {}, is_recurring: false,
      recurrence_rule: null, show_in_bored: false, bored_category_id: null,
    })
    const insert = db.calls.find(c => c.method === 'exec')!
    expect(insert.sql).toContain('INSERT INTO todos')
  })
})

describe('toggleTodo', () => {
  it('marks undone todo as done', async () => {
    const db = new MockDbAdapter()
    let callCount = 0
    db.queryAll = async function<T>(sql: string, bind?: unknown[]) {
      this.calls.push({ method: 'queryAll', sql, bind })
      callCount++
      const row = callCount === 1 ? todoRow() : { ...todoRow(), is_done: 1 }
      return [row as T]
    }
    const result = await shared.toggleTodo(db, 't1')
    expect(result.is_done).toBe(true)
    const update = db.calls.find(c => c.method === 'exec')!
    expect(update.sql).toContain('is_done = 1')
  })

  it('marks done todo as undone', async () => {
    const db = new MockDbAdapter()
    let callCount = 0
    db.queryAll = async function<T>(sql: string, bind?: unknown[]) {
      this.calls.push({ method: 'queryAll', sql, bind })
      callCount++
      const row = callCount === 1 ? { ...todoRow(), is_done: 1 } : todoRow()
      return [row as T]
    }
    const result = await shared.toggleTodo(db, 't1')
    expect(result.is_done).toBe(false)
    const update = db.calls.find(c => c.method === 'exec')!
    expect(update.sql).toContain('is_done = 0')
  })

  it('throws when todo not found', async () => {
    const db = new MockDbAdapter()
    await expect(shared.toggleTodo(db, 'missing')).rejects.toThrow('Todo not found')
  })
})

describe('archiveTodo', () => {
  it('sets archived_at on the todo', async () => {
    const db = new MockDbAdapter()
    await shared.archiveTodo(db, 't1')
    expect(db.calls[0]!.sql).toContain('archived_at')
    expect(db.calls[0]!.bind).toContain('t1')
  })
})

// ─── Misc ─────────────────────────────────────────────────────────────────────

describe('isDefaultApplied', () => {
  it('returns true when key exists in applied_defaults', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM applied_defaults', [{ key: 'seed:foo' }])
    const result = await shared.isDefaultApplied(db, 'seed:foo')
    expect(result).toBe(true)
  })

  it('returns false when key missing', async () => {
    const db = new MockDbAdapter()
    const result = await shared.isDefaultApplied(db, 'seed:missing')
    expect(result).toBe(false)
  })
})

describe('deleteAllHabits', () => {
  it('executes DELETE FROM habits', async () => {
    const db = new MockDbAdapter()
    await shared.deleteAllHabits(db)
    expect(db.calls[0]!.sql).toContain('DELETE FROM habits')
  })
})

describe('deleteAllBoredData', () => {
  it('deletes activities and custom categories', async () => {
    const db = new MockDbAdapter()
    await shared.deleteAllBoredData(db)
    const sqls = db.calls.map(c => c.sql)
    expect(sqls.some(s => s.includes('DELETE FROM bored_activities'))).toBe(true)
    expect(sqls.some(s => s.includes('DELETE FROM bored_categories'))).toBe(true)
  })
})

describe('getBoredOracle', () => {
  it('returns null when no eligible items', async () => {
    const db = new MockDbAdapter()
    const result = await shared.getBoredOracle(db, [], null)
    expect(result).toBeNull()
  })

  it('returns a result from the eligible pool', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM bored_activities', [boredActivityRow()])
    db.setRows('FROM todos', [])
    db.setRows('FROM bored_categories', [boredCategoryRow()])
    const result = await shared.getBoredOracle(db, [], null)
    expect(result).not.toBeNull()
    expect(result?.source).toBe('activity')
  })
})

describe('calculateNextDue', () => {
  it('advances daily by 1 day', () => {
    expect(shared.calculateNextDue('2025-01-01', 'daily')).toBe('2025-01-02')
  })

  it('advances weekly by 7 days', () => {
    expect(shared.calculateNextDue('2025-01-01', 'weekly')).toBe('2025-01-08')
  })

  it('advances monthly by 1 month', () => {
    expect(shared.calculateNextDue('2025-01-15', 'monthly')).toBe('2025-02-15')
  })
})

describe('getCheckinResponseDates', () => {
  it('returns dates with counts', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM checkin_responses', [{ date: '2025-01-01', count: 3 }])
    const result = await shared.getCheckinResponseDates(db)
    expect(result[0]!.date).toBe('2025-01-01')
    expect(result[0]!.count).toBe(3)
  })
})

describe('getContextTags', () => {
  it('returns an array of strings', async () => {
    const db = new MockDbAdapter()
    db.setRows('SELECT tag', [{ tag: 'health' }])
    const result = await shared.getContextTags(db)
    expect(result[0]).toBe('health')
  })
})

describe('getAllTags', () => {
  it('returns tag rows with tag, source, and count', async () => {
    const db = new MockDbAdapter()
    db.setRows('SELECT tag, src, cnt', [
      { tag: 'work', src: 'todo', cnt: 5 },
      { tag: 'exercise', src: 'habit', cnt: 3 },
    ])
    const result = await shared.getAllTags(db)
    expect(result).toEqual([
      { tag: 'work', source: 'todo', count: 5 },
      { tag: 'exercise', source: 'habit', count: 3 },
    ])
  })

  it('returns empty array when no tags exist', async () => {
    const db = new MockDbAdapter()
    const result = await shared.getAllTags(db)
    expect(result).toEqual([])
  })
})

describe('searchGlobal', () => {
  it('returns results from habits, todos, scribbles, checkins', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM habits WHERE', [{ id: 'h1', name: 'Exercise', icon: 'i-x', color: '#fff', archived_at: null }])
    db.setRows('FROM todos WHERE', [{ id: 't1', title: 'Buy milk', is_done: 0 }])
    db.setRows('FROM scribbles WHERE', [])
    db.setRows('FROM checkin_templates WHERE', [])
    const result = await shared.searchGlobal(db, 'e')
    expect(result.some(r => r.kind === 'habit')).toBe(true)
  })
})

// ─── getAllTags: scribbles CTE must not reference archived_at ─────────────────

describe('getAllTags — scribbles CTE', () => {
  it('does not reference scribbles.archived_at (column does not exist)', async () => {
    const db = new MockDbAdapter()
    db.setRows('SELECT tag, src, cnt', [])
    await shared.getAllTags(db)
    const sql = db.calls[0]!.sql
    // The scribble CTE should not filter by archived_at
    const scribbleCte = sql.slice(sql.indexOf('scribbles s'))
    expect(scribbleCte).not.toContain('archived_at')
  })
})

// ─── Voice / Image note CRUD ─────────────────────────────────────────────────

describe('createVoiceNote', () => {
  it('uses INSERT OR IGNORE', async () => {
    const db = new MockDbAdapter()
    await shared.dispatch(db, {
      type: 'CREATE_VOICE_NOTE',
      payload: { id: 'v1', title: '', mime_type: 'audio/webm', duration: 5.2, created_at: '2025-01-01T00:00:00Z' },
    })
    const insert = db.calls.find(c => c.method === 'exec' && c.sql.includes('voice_notes'))!
    expect(insert.sql).toContain('INSERT OR IGNORE')
    expect(insert.bind).toEqual(['v1', '', 'audio/webm', 5.2, '2025-01-01T00:00:00Z'])
  })
})

describe('createImageNote', () => {
  it('uses INSERT OR IGNORE', async () => {
    const db = new MockDbAdapter()
    await shared.dispatch(db, {
      type: 'CREATE_IMAGE_NOTE',
      payload: { id: 'i1', mime_type: 'image/jpeg', filename: 'photo.jpg', created_at: '2025-01-01T00:00:00Z' },
    })
    const insert = db.calls.find(c => c.method === 'exec' && c.sql.includes('image_notes'))!
    expect(insert.sql).toContain('INSERT OR IGNORE')
    expect(insert.bind).toEqual(['i1', 'image/jpeg', 'photo.jpg', '2025-01-01T00:00:00Z'])
  })
})

describe('getVoiceNotes', () => {
  it('queries voice_notes ordered by created_at DESC', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM voice_notes', [
      { id: 'v1', mime_type: 'audio/webm', duration: 5, created_at: '2025-01-01' },
    ])
    const result = await shared.dispatch(db, { type: 'GET_VOICE_NOTES' })
    expect(result).toHaveLength(1)
    const sql = db.calls.find(c => c.sql.includes('voice_notes'))!.sql
    expect(sql).toContain('ORDER BY created_at DESC')
  })
})

describe('getImageNotes', () => {
  it('queries image_notes ordered by created_at DESC', async () => {
    const db = new MockDbAdapter()
    db.setRows('FROM image_notes', [
      { id: 'i1', mime_type: 'image/png', filename: 'pic.png', created_at: '2025-01-01' },
    ])
    const result = await shared.dispatch(db, { type: 'GET_IMAGE_NOTES' })
    expect(result).toHaveLength(1)
    const sql = db.calls.find(c => c.sql.includes('image_notes'))!.sql
    expect(sql).toContain('ORDER BY created_at DESC')
  })
})

describe('deleteVoiceNote', () => {
  it('deletes by id', async () => {
    const db = new MockDbAdapter()
    await shared.dispatch(db, { type: 'DELETE_VOICE_NOTE', payload: { id: 'v1' } })
    const del = db.calls.find(c => c.sql.includes('DELETE FROM voice_notes'))!
    expect(del.bind).toEqual(['v1'])
  })
})

describe('deleteImageNote', () => {
  it('deletes by id', async () => {
    const db = new MockDbAdapter()
    await shared.dispatch(db, { type: 'DELETE_IMAGE_NOTE', payload: { id: 'i1' } })
    const del = db.calls.find(c => c.sql.includes('DELETE FROM image_notes'))!
    expect(del.bind).toEqual(['i1'])
  })
})

// ─── deleteAllMediaNotes ─────────────────────────────────────────────────────

describe('deleteAllMediaNotes', () => {
  it('deletes from both voice_notes and image_notes', async () => {
    const db = new MockDbAdapter()
    await shared.dispatch(db, { type: 'DELETE_ALL_MEDIA_NOTES', payload: null })
    const sqls = db.calls.filter(c => c.method === 'exec').map(c => c.sql)
    expect(sqls).toContainEqual('DELETE FROM voice_notes')
    expect(sqls).toContainEqual('DELETE FROM image_notes')
  })
})

// ─── clearAppliedDefaults ────────────────────────────────────────────────────

describe('clearAppliedDefaults', () => {
  it('deletes from both applied_defaults and _palladium_seeds', async () => {
    const db = new MockDbAdapter()
    await shared.clearAppliedDefaults(db)
    const sqls = db.calls.filter(c => c.method === 'exec').map(c => c.sql)
    expect(sqls).toContainEqual('DELETE FROM applied_defaults')
    expect(sqls).toContainEqual('DELETE FROM _palladium_seeds')
  })
})

// ─── importJson: habits INSERT includes why column ───────────────────────────

describe('importJson — why column', () => {
  it('includes why field in habits INSERT', async () => {
    const db = new MockDbAdapter()
    const data = {
      version: 1 as const,
      exported_at: '2025-01-01T00:00:00Z',
      habits: [{
        id: 'h1', name: 'Run', description: 'Go for a run', why: 'Stay healthy',
        color: '#fff', icon: 'star', frequency: 'daily',
        created_at: '2025-01-01T00:00:00Z', archived_at: null,
        tags: [], annotations: {}, type: 'BOOLEAN' as const, target_value: 1, paused_until: null,
      }],
      completions: [], habit_logs: [], habit_schedules: [],
      checkin_templates: [], checkin_questions: [], checkin_responses: [],
      reminders: [], checkin_reminders: [], scribbles: [],
      checkin_entries: [], bored_categories: [], bored_activities: [], todos: [],
    }
    await shared.importJson(db, data)
    const habitInsert = db.calls.find(c => c.method === 'exec' && c.sql.includes('INSERT OR IGNORE INTO habits'))!
    expect(habitInsert.sql).toContain('why')
    expect(habitInsert.bind).toContain('Stay healthy')
  })
})
