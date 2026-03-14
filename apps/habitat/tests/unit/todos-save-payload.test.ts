import { describe, it, expect } from 'vitest'
import {
  validateTodoForm,
  buildTodoPayload,
  type TodoFormState,
} from '~/utils/todos-helpers'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE: TodoFormState = {
  title: 'Buy milk',
  description: '',
  due_date: '',
  priority: 'medium',
  estimated_minutes: '',
  is_recurring: false,
  recurrence_rule: 'daily',
  show_in_bored: false,
  bored_category_id: '',
  tags: '',
}

// ─── validateTodoForm ────────────────────────────────────────────────────────

describe('validateTodoForm', () => {
  it('returns null when title has content', () => {
    expect(validateTodoForm({ title: 'Buy milk' })).toBeNull()
  })

  it('returns error when title is empty', () => {
    expect(validateTodoForm({ title: '' })).toBe('Title is required')
  })

  it('returns error when title is only whitespace', () => {
    expect(validateTodoForm({ title: '   ' })).toBe('Title is required')
  })
})

// ─── buildTodoPayload ────────────────────────────────────────────────────────

describe('buildTodoPayload', () => {
  it('trims whitespace from title', () => {
    const p = buildTodoPayload({ ...BASE, title: '  Buy milk  ' }, null)
    expect(p.title).toBe('Buy milk')
  })

  it('trims whitespace from description', () => {
    const p = buildTodoPayload({ ...BASE, description: '  details  ' }, null)
    expect(p.description).toBe('details')
  })

  it('converts empty due_date to null', () => {
    expect(buildTodoPayload({ ...BASE, due_date: '' }, null).due_date).toBeNull()
  })

  it('preserves non-empty due_date', () => {
    expect(buildTodoPayload({ ...BASE, due_date: '2024-12-01' }, null).due_date).toBe('2024-12-01')
  })

  it('converts empty estimated_minutes to null', () => {
    expect(buildTodoPayload({ ...BASE, estimated_minutes: '' }, null).estimated_minutes).toBeNull()
  })

  it('converts numeric string estimated_minutes to number', () => {
    expect(buildTodoPayload({ ...BASE, estimated_minutes: '30' }, null).estimated_minutes).toBe(30)
  })

  it('splits and trims comma-separated tags, drops empty entries', () => {
    const p = buildTodoPayload({ ...BASE, tags: 'work, health , ' }, null)
    expect(p.tags).toEqual(['work', 'health'])
  })

  it('returns empty tags array when tags is empty string', () => {
    expect(buildTodoPayload(BASE, null).tags).toEqual([])
  })

  it('sets recurrence_rule to null when is_recurring is false', () => {
    const p = buildTodoPayload({ ...BASE, is_recurring: false, recurrence_rule: 'weekly' }, null)
    expect(p.recurrence_rule).toBeNull()
  })

  it('preserves recurrence_rule when is_recurring is true', () => {
    const p = buildTodoPayload({ ...BASE, is_recurring: true, recurrence_rule: 'weekly' }, null)
    expect(p.recurrence_rule).toBe('weekly')
  })

  it('sets bored_category_id to null when show_in_bored is false', () => {
    const p = buildTodoPayload({ ...BASE, show_in_bored: false, bored_category_id: 'cat-1' }, null)
    expect(p.bored_category_id).toBeNull()
  })

  it('sets bored_category_id to null when show_in_bored is true but category is empty', () => {
    const p = buildTodoPayload({ ...BASE, show_in_bored: true, bored_category_id: '' }, null)
    expect(p.bored_category_id).toBeNull()
  })

  it('preserves bored_category_id when show_in_bored is true and category is set', () => {
    const p = buildTodoPayload({ ...BASE, show_in_bored: true, bored_category_id: 'cat-42' }, null)
    expect(p.bored_category_id).toBe('cat-42')
  })

  it('returns empty annotations when existingAnnotations is null (new todo)', () => {
    expect(buildTodoPayload(BASE, null).annotations).toEqual({})
  })

  it('copies existing annotations when editing', () => {
    const ann = { linked_jot_id: 'jot-1', linked_jot_kind: 'text' }
    const p = buildTodoPayload(BASE, ann)
    expect(p.annotations).toEqual(ann)
    // must be a shallow copy, not the same reference
    expect(p.annotations).not.toBe(ann)
  })
})
