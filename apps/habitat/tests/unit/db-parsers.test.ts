import { describe, it, expect } from 'vitest'
import {
  parseHabit,
  parseHabitWithSchedule,
  parseHabitSchedule,
  parseCompletion,
  parseCheckinResponse,
  parseBoredActivity,
  parseTodo,
  parseScribble,
} from '~/lib/db-parsers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function habitRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'h1',
    name: 'Exercise',
    description: 'Daily exercise',
    color: '#22d3ee',
    icon: 'bolt',
    frequency: 'daily',
    created_at: '2025-01-01T00:00:00Z',
    archived_at: null,
    tags: '["health"]',
    annotations: '{}',
    type: 'BOOLEAN',
    target_value: 1,
    paused_until: null,
    ...overrides,
  }
}

// ─── parseHabit ───────────────────────────────────────────────────────────────

describe('parseHabit', () => {
  it('parses a normal row', () => {
    const h = parseHabit(habitRow())
    expect(h.id).toBe('h1')
    expect(h.tags).toEqual(['health'])
    expect(h.archived_at).toBeNull()
  })

  it('returns [] for null tags (JSON-null string)', () => {
    const h = parseHabit(habitRow({ tags: 'null' }))
    expect(h.tags).toEqual([])
  })

  it('returns [] for SQL-null tags', () => {
    const h = parseHabit(habitRow({ tags: null }))
    expect(h.tags).toEqual([])
  })

  it('defaults type to BOOLEAN when missing', () => {
    const h = parseHabit(habitRow({ type: null }))
    expect(h.type).toBe('BOOLEAN')
  })

  it('defaults target_value to 1 when null', () => {
    const h = parseHabit(habitRow({ target_value: null }))
    expect(h.target_value).toBe(1)
  })

  it('preserves paused_until string', () => {
    const h = parseHabit(habitRow({ paused_until: '2025-06-01T00:00:00Z' }))
    expect(h.paused_until).toBe('2025-06-01T00:00:00Z')
  })

  it('parses why field when present', () => {
    const h = parseHabit(habitRow({ why: 'Keeps me healthy' }))
    expect(h.why).toBe('Keeps me healthy')
  })

  it('defaults why to empty string when column is missing', () => {
    const h = parseHabit(habitRow())
    expect(h.why).toBe('')
  })
})

// ─── parseHabitWithSchedule ───────────────────────────────────────────────────

describe('parseHabitWithSchedule', () => {
  it('returns schedule: null when sched_id is null', () => {
    const h = parseHabitWithSchedule(habitRow({ sched_id: null }))
    expect(h.schedule).toBeNull()
  })

  it('parses schedule when sched_id is present', () => {
    const row = habitRow({
      sched_id: 's1',
      schedule_type: 'WEEKLY_FLEX',
      frequency_count: 3,
      days_of_week: null,
      due_time: null,
      start_date: '2025-01-01',
      end_date: null,
    })
    const h = parseHabitWithSchedule(row)
    expect(h.schedule?.id).toBe('s1')
    expect(h.schedule?.schedule_type).toBe('WEEKLY_FLEX')
    expect(h.schedule?.frequency_count).toBe(3)
  })

  it('parses days_of_week from JSON string', () => {
    const row = habitRow({
      sched_id: 's1',
      schedule_type: 'SPECIFIC_DAYS',
      frequency_count: null,
      days_of_week: '[1,3,5]',
      due_time: null,
      start_date: '2025-01-01',
      end_date: null,
    })
    const h = parseHabitWithSchedule(row)
    expect(h.schedule?.days_of_week).toEqual([1, 3, 5])
  })
})

// ─── parseHabitSchedule ───────────────────────────────────────────────────────

describe('parseHabitSchedule', () => {
  it('uses safeJsonParse for days_of_week (no throw on null or "null")', () => {
    const nullRow = {
      id: 's1', habit_id: 'h1', schedule_type: 'DAILY',
      frequency_count: null, days_of_week: null, due_time: null,
      start_date: '2025-01-01', end_date: null,
    }
    expect(() => parseHabitSchedule(nullRow)).not.toThrow()
    expect(parseHabitSchedule(nullRow).days_of_week).toBeNull()

    const jsonNullRow = { ...nullRow, days_of_week: 'null' }
    expect(parseHabitSchedule(jsonNullRow).days_of_week).toBeNull()
  })

  it('parses valid days_of_week JSON', () => {
    const row = {
      id: 's1', habit_id: 'h1', schedule_type: 'SPECIFIC_DAYS',
      frequency_count: null, days_of_week: '[0,6]', due_time: null,
      start_date: '2025-01-01', end_date: null,
    }
    expect(parseHabitSchedule(row).days_of_week).toEqual([0, 6])
  })
})

// ─── parseCheckinResponse ─────────────────────────────────────────────────────

describe('parseCheckinResponse', () => {
  it('passes through null numeric and text values', () => {
    const r = parseCheckinResponse({
      id: 'r1', question_id: 'q1', logged_date: '2025-01-01',
      value_numeric: null, value_text: null,
    })
    expect(r.value_numeric).toBeNull()
    expect(r.value_text).toBeNull()
  })

  it('passes through non-null values', () => {
    const r = parseCheckinResponse({
      id: 'r1', question_id: 'q1', logged_date: '2025-01-01',
      value_numeric: 7, value_text: 'good',
    })
    expect(r.value_numeric).toBe(7)
    expect(r.value_text).toBe('good')
  })
})

// ─── parseBoredActivity ───────────────────────────────────────────────────────

describe('parseBoredActivity', () => {
  it('handles null estimated_minutes', () => {
    const a = parseBoredActivity({
      id: 'a1', title: 'Walk', description: '', category_id: 'c1',
      estimated_minutes: null, tags: '[]', annotations: '{}',
      is_recurring: 0, recurrence_rule: null, is_done: 0,
      done_at: null, done_count: 0, last_done_at: null,
      archived_at: null, created_at: '2025-01-01T00:00:00Z',
    })
    expect(a.estimated_minutes).toBeNull()
  })

  it('casts is_done and is_recurring to boolean', () => {
    const a = parseBoredActivity({
      id: 'a1', title: 'Walk', description: '', category_id: 'c1',
      estimated_minutes: null, tags: '[]', annotations: '{}',
      is_recurring: 1, recurrence_rule: 'daily', is_done: 1,
      done_at: '2025-01-01T00:00:00Z', done_count: 3, last_done_at: null,
      archived_at: null, created_at: '2025-01-01T00:00:00Z',
    })
    expect(a.is_done).toBe(true)
    expect(a.is_recurring).toBe(true)
    expect(a.done_count).toBe(3)
  })
})

// ─── parseTodo ────────────────────────────────────────────────────────────────

describe('parseTodo', () => {
  it('defaults priority to medium when null', () => {
    const t = parseTodo({
      id: 't1', title: 'Task', description: '', due_date: null,
      priority: null, estimated_minutes: null, is_done: 0, done_at: null,
      done_count: 0, last_done_at: null, tags: '[]', annotations: '{}',
      is_recurring: 0, recurrence_rule: null, show_in_bored: 0,
      bored_category_id: null, archived_at: null,
      created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    })
    expect(t.priority).toBe('medium')
  })

  it('handles null tags (JSON-null string)', () => {
    const t = parseTodo({
      id: 't1', title: 'Task', description: '', due_date: null,
      priority: 'high', estimated_minutes: null, is_done: 0, done_at: null,
      done_count: 0, last_done_at: null, tags: 'null', annotations: '{}',
      is_recurring: 0, recurrence_rule: null, show_in_bored: 0,
      bored_category_id: null, archived_at: null,
      created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    })
    expect(t.tags).toEqual([])
  })
})

// ─── parseScribble ────────────────────────────────────────────────────────────

describe('parseScribble', () => {
  it('defaults empty title and content', () => {
    const s = parseScribble({
      id: 's1', title: null, content: null,
      tags: '[]', annotations: '{}',
      created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    })
    expect(s.title).toBe('')
    expect(s.content).toBe('')
  })
})

// ─── parseCompletion ─────────────────────────────────────────────────────────

describe('parseCompletion', () => {
  it('parses tags and annotations from JSON', () => {
    const c = parseCompletion({
      id: 'c1', habit_id: 'h1', date: '2025-01-01',
      completed_at: '2025-01-01T08:00:00Z', notes: '',
      tags: '["morning"]', annotations: '{"mood":"good"}',
    })
    expect(c.tags).toEqual(['morning'])
    expect(c.annotations).toEqual({ mood: 'good' })
  })
})
