import { describe, it, expect } from 'vitest'
import type { Todo } from '~/types/database'
import { priorityColor, formatDueDate, isOverdue } from '~/utils/todos-helpers'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: 'Test todo',
    description: '',
    due_date: null,
    priority: 'medium',
    estimated_minutes: null,
    is_done: false,
    done_at: null,
    done_count: 0,
    last_done_at: null,
    tags: [],
    annotations: {},
    is_recurring: false,
    recurrence_rule: null,
    show_in_bored: false,
    bored_category_id: null,
    archived_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── priorityColor ───────────────────────────────────────────────────────────

describe('priorityColor', () => {
  it('returns red for high priority', () => {
    expect(priorityColor('high')).toBe('bg-red-500')
  })

  it('returns slate for low priority', () => {
    expect(priorityColor('low')).toBe('bg-slate-600')
  })

  it('returns amber for medium priority', () => {
    expect(priorityColor('medium')).toBe('bg-amber-500')
  })

  it('returns amber as default for unknown values', () => {
    expect(priorityColor('unknown')).toBe('bg-amber-500')
  })
})

// ─── formatDueDate ───────────────────────────────────────────────────────────

describe('formatDueDate', () => {
  const today = '2024-03-15'

  it('returns "Today" when due date equals today', () => {
    expect(formatDueDate('2024-03-15', today)).toBe('Today')
  })

  it('returns "Tomorrow" for 1 day in the future', () => {
    expect(formatDueDate('2024-03-16', today)).toBe('Tomorrow')
  })

  it('returns "Yesterday" for 1 day in the past', () => {
    expect(formatDueDate('2024-03-14', today)).toBe('Yesterday')
  })

  it('returns "in Nd" for dates within the next week', () => {
    expect(formatDueDate('2024-03-18', today)).toBe('in 3d')
  })

  it('returns "Nd ago" for past dates within 7 days', () => {
    expect(formatDueDate('2024-03-12', today)).toBe('3d ago')
  })

  it('returns a locale date string for dates more than a week away', () => {
    const result = formatDueDate('2024-04-01', today)
    expect(result).toMatch(/Apr/)
    expect(result).toMatch(/1/)
  })
})

// ─── isOverdue ────────────────────────────────────────────────────────────────

describe('isOverdue', () => {
  const today = '2024-03-15'

  it('returns true for an undone todo with a past due date', () => {
    const t = makeTodo({ due_date: '2024-03-10', is_done: false })
    expect(isOverdue(t, today)).toBe(true)
  })

  it('returns false for a done todo even with a past due date', () => {
    const t = makeTodo({ due_date: '2024-03-10', is_done: true })
    expect(isOverdue(t, today)).toBe(false)
  })

  it('returns false when due date equals today', () => {
    const t = makeTodo({ due_date: '2024-03-15', is_done: false })
    expect(isOverdue(t, today)).toBe(false)
  })

  it('returns false for a future due date', () => {
    const t = makeTodo({ due_date: '2024-03-20', is_done: false })
    expect(isOverdue(t, today)).toBe(false)
  })

  it('returns false when due_date is null', () => {
    const t = makeTodo({ due_date: null, is_done: false })
    expect(isOverdue(t, today)).toBe(false)
  })
})
