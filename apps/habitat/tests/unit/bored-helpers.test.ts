import { describe, it, expect } from 'vitest'
import {
  validateActivityTitle,
  buildActivityPayload,
  buildCategoryPayload,
  type ActivityFormState,
  type CategoryFormState,
} from '~/utils/bored-helpers'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_ACT: ActivityFormState = {
  title: 'Go for a walk',
  description: '',
  estimated_minutes: '',
  is_recurring: false,
  recurrence_rule: 'daily',
  tags: [],
}

const BASE_CAT: CategoryFormState = {
  name: 'Sports',
  icon: 'bolt',
  color: '#ff0000',
}

// ─── validateActivityTitle ────────────────────────────────────────────────────

describe('validateActivityTitle', () => {
  it('returns null when title has content', () => {
    expect(validateActivityTitle('Walk')).toBeNull()
  })

  it('returns error when title is empty', () => {
    expect(validateActivityTitle('')).toBe('Title is required')
  })

  it('returns error when title is only whitespace', () => {
    expect(validateActivityTitle('   ')).toBe('Title is required')
  })
})

// ─── buildActivityPayload ─────────────────────────────────────────────────────

describe('buildActivityPayload', () => {
  it('trims whitespace from title', () => {
    const p = buildActivityPayload({ ...BASE_ACT, title: '  Walk  ' }, 'cat-1')
    expect(p.title).toBe('Walk')
  })

  it('trims whitespace from description', () => {
    const p = buildActivityPayload({ ...BASE_ACT, description: '  outside  ' }, 'cat-1')
    expect(p.description).toBe('outside')
  })

  it('converts empty estimated_minutes to null', () => {
    expect(buildActivityPayload({ ...BASE_ACT, estimated_minutes: '' }, 'cat-1').estimated_minutes).toBeNull()
  })

  it('converts numeric string to number for estimated_minutes', () => {
    expect(buildActivityPayload({ ...BASE_ACT, estimated_minutes: '30' }, 'cat-1').estimated_minutes).toBe(30)
  })

  it('trims tags and drops empty entries', () => {
    const p = buildActivityPayload({ ...BASE_ACT, tags: ['health', ' outside ', '', ' '] }, 'cat-1')
    expect(p.tags).toEqual(['health', 'outside'])
  })

  it('returns empty tags array when tags is empty', () => {
    expect(buildActivityPayload(BASE_ACT, 'cat-1').tags).toEqual([])
  })

  it('sets recurrence_rule to null when is_recurring is false', () => {
    const p = buildActivityPayload({ ...BASE_ACT, is_recurring: false, recurrence_rule: 'weekly' }, 'cat-1')
    expect(p.recurrence_rule).toBeNull()
  })

  it('preserves recurrence_rule when is_recurring is true', () => {
    const p = buildActivityPayload({ ...BASE_ACT, is_recurring: true, recurrence_rule: 'weekly' }, 'cat-1')
    expect(p.recurrence_rule).toBe('weekly')
  })

  it('includes category_id from argument', () => {
    expect(buildActivityPayload(BASE_ACT, 'cat-42').category_id).toBe('cat-42')
  })

  it('always sets annotations to empty object', () => {
    expect(buildActivityPayload(BASE_ACT, 'cat-1').annotations).toEqual({})
  })
})

// ─── buildCategoryPayload ─────────────────────────────────────────────────────

describe('buildCategoryPayload', () => {
  it('trims whitespace from name', () => {
    expect(buildCategoryPayload({ ...BASE_CAT, name: '  Sports  ' }).name).toBe('Sports')
  })

  it('passes icon through unchanged', () => {
    expect(buildCategoryPayload(BASE_CAT).icon).toBe('bolt')
  })

  it('passes color through unchanged', () => {
    expect(buildCategoryPayload(BASE_CAT).color).toBe('#ff0000')
  })
})
