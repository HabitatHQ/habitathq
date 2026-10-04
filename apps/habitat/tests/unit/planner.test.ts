import { describe, expect, it } from 'vitest'
import { localDateString } from '@habitathq/utils'
import type { Todo } from '~/types/database'
import {
  calendarNotePrompt,
  calendarDateFromQuery,
  daysFrom,
  expandTodoOccurrences,
  startOfWeek,
} from '~/utils/planner'

const recurringTodo = (overrides: Partial<Todo> = {}): Todo => ({
  id: 'todo', title: 'Review', description: '', due_date: '2026-09-01', scheduled_time: null,
  priority: 'medium', estimated_minutes: null, is_done: false, done_at: null, done_count: 0,
  last_done_at: null, tags: [], annotations: {}, is_recurring: true, recurrence_rule: 'weekly',
  show_in_bored: false, bored_category_id: null, archived_at: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...overrides,
})

describe('planner dates', () => {
  it('uses local date parts and starts weeks on Sunday', () => {
    expect(localDateString(new Date(2026, 8, 28))).toBe('2026-09-28')
    expect(daysFrom(startOfWeek(new Date(2026, 8, 30)), 7)).toEqual([
      '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03',
    ])
  })

  it('expands recurring tasks only inside the visible range', () => {
    expect(expandTodoOccurrences(recurringTodo(), '2026-09-20', '2026-10-05')).toEqual([
      '2026-09-22', '2026-09-29',
    ])
  })

  it('keeps a monthly task anchored to its original day when months are shorter', () => {
    expect(
      expandTodoOccurrences(
        recurringTodo({ due_date: '2026-01-31', recurrence_rule: 'monthly' }),
        '2026-01-01',
        '2026-04-30',
      ),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
})

describe('calendarNotePrompt', () => {
  it('uses reflection language for past dates', () => {
    expect(calendarNotePrompt('2026-09-27', new Date(2026, 8, 28, 10))).toBe(
      'Add a note to remember what mattered',
    )
  })

  it('uses objective language for future dates', () => {
    expect(calendarNotePrompt('2026-09-29', new Date(2026, 8, 28, 10))).toBe(
      'Add a note to set an objective',
    )
  })

  it('keeps the neutral prompt for today at any time', () => {
    expect(calendarNotePrompt('2026-09-28', new Date(2026, 8, 28, 23))).toBe(
      'Add a note for this day',
    )
  })
})

describe('calendarDateFromQuery', () => {
  it('restores a valid date passed through Calendar navigation', () => {
    expect(calendarDateFromQuery('2026-09-28', '2026-09-29')).toBe('2026-09-28')
  })

  it('falls back safely for a missing or malformed route value', () => {
    expect(calendarDateFromQuery(undefined, '2026-09-29')).toBe('2026-09-29')
    expect(calendarDateFromQuery('2026-02-30', '2026-09-29')).toBe('2026-09-29')
  })
})
