import { describe, expect, it } from 'vitest'
import { filterTemplates, sortTemplates } from '~/lib/template-sort'
import type { TemplateRow } from '~/types/database'

const NOW = '2026-03-10T12:00:00Z'

function makeTemplate(overrides: Partial<TemplateRow> & { id: string; name: string }): TemplateRow {
  return {
    description: null,
    created_at: NOW,
    archived_at: null,
    sort_order: 0,
    pinned_at: null,
    last_used_at: null,
    use_count: 0,
    cover_emoji: null,
    ...overrides,
  }
}

const tA = makeTemplate({
  id: 'a',
  name: 'Alpha',
  created_at: '2026-01-01T00:00:00Z',
  use_count: 10,
  last_used_at: '2026-03-01T00:00:00Z',
  sort_order: 2,
})
const tB = makeTemplate({
  id: 'b',
  name: 'Beta',
  created_at: '2026-02-01T00:00:00Z',
  use_count: 5,
  last_used_at: '2026-03-05T00:00:00Z',
  sort_order: 1,
})
const tC = makeTemplate({
  id: 'c',
  name: 'Gamma',
  created_at: '2026-03-01T00:00:00Z',
  use_count: 1,
  last_used_at: null,
  sort_order: 3,
})
const tPinned = makeTemplate({
  id: 'd',
  name: 'Delta',
  pinned_at: '2026-03-10T00:00:00Z',
  created_at: '2026-02-15T00:00:00Z',
  use_count: 3,
  sort_order: 0,
})

describe('sortTemplates', () => {
  it('sorts by name A–Z', () => {
    const result = sortTemplates([tC, tA, tB], 'name')
    expect(result.map((t) => t.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('sorts by most_used descending', () => {
    const result = sortTemplates([tC, tA, tB], 'most_used')
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by last_used descending, nulls last', () => {
    const result = sortTemplates([tC, tA, tB], 'last_used')
    expect(result.map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })

  it('sorts by recent (created_at) descending', () => {
    const result = sortTemplates([tA, tB, tC], 'recent')
    expect(result.map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts pinned_first: pinned templates come before unpinned', () => {
    const result = sortTemplates([tA, tB, tPinned, tC], 'pinned_first')
    expect(result[0]?.id).toBe('d')
  })

  it('pinned_first: among unpinned, sorts by sort_order', () => {
    const result = sortTemplates([tA, tB, tC, tPinned], 'pinned_first')
    const unpinned = result.slice(1)
    expect(unpinned.map((t) => t.sort_order)).toEqual([1, 2, 3])
  })

  it('does not mutate the input array', () => {
    const input = [tC, tA, tB]
    sortTemplates(input, 'name')
    expect(input[0]?.id).toBe('c')
  })

  it('handles empty array', () => {
    expect(sortTemplates([], 'name')).toEqual([])
  })
})

describe('filterTemplates', () => {
  it('returns all templates when query is empty', () => {
    expect(filterTemplates([tA, tB, tC], '')).toHaveLength(3)
  })

  it('filters by name (case-insensitive)', () => {
    const result = filterTemplates([tA, tB, tC], 'alp')
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('a')
  })

  it('filters by description', () => {
    const tWithDesc = makeTemplate({ id: 'e', name: 'Legs', description: 'quad dominant' })
    const result = filterTemplates([tA, tWithDesc], 'quad')
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('e')
  })

  it('returns empty array when no match', () => {
    expect(filterTemplates([tA, tB, tC], 'zzz')).toHaveLength(0)
  })
})
