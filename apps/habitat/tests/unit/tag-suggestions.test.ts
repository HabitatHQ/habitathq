import { describe, it, expect } from 'vitest'
import { rankSuggestions } from '~/composables/useTagSuggestions'
import type { TagRow, TagSource } from '~/types/database'

function row(tag: string, source: TagSource, count: number): TagRow {
  return { tag, source, count }
}

describe('rankSuggestions', () => {
  const rows: TagRow[] = [
    row('work', 'todo', 5),
    row('work', 'habit', 2),
    row('exercise', 'habit', 10),
    row('exercise', 'todo', 1),
    row('reading', 'bored', 3),
    row('cooking', 'scribble', 1),
    row('habitat-health', 'habit', 8),
  ]

  it('filters by case-insensitive prefix', () => {
    const result = rankSuggestions(rows, 'todo', 'wo', [])
    expect(result.map((r) => r.tag)).toEqual(['work'])
  })

  it('excludes already-selected tags', () => {
    const result = rankSuggestions(rows, 'todo', 'wo', ['work'])
    expect(result).toEqual([])
  })

  it('excludes habitat-* tags', () => {
    const result = rankSuggestions(rows, 'habit', '', [])
    expect(result.map((r) => r.tag)).not.toContain('habitat-health')
  })

  it('ranks same-context tags higher', () => {
    const result = rankSuggestions(rows, 'todo', '', [])
    const workIdx = result.findIndex((r) => r.tag === 'work')
    const readingIdx = result.findIndex((r) => r.tag === 'reading')
    expect(workIdx).toBeLessThan(readingIdx)
  })

  it('ranks by score (sameContext*3 + other*1) descending', () => {
    const result = rankSuggestions(rows, 'todo', '', [])
    expect(result[0]!.tag).toBe('work')
    expect(result[1]!.tag).toBe('exercise')
  })

  it('returns at most maxResults items', () => {
    const manyRows = Array.from({ length: 20 }, (_, i) => row(`tag${i}`, 'todo', 1))
    const result = rankSuggestions(manyRows, 'todo', '', [], 5)
    expect(result.length).toBe(5)
  })

  it('includes DB tags and smart defaults when input is empty', () => {
    const result = rankSuggestions(rows, 'todo', '', [], 15)
    const tags = result.map((r) => r.tag)
    expect(tags).toContain('work')
    expect(tags).toContain('exercise')
    expect(tags).toContain('deep-work')
  })

  it('ranks DB tags above smart defaults', () => {
    const result = rankSuggestions(rows, 'todo', '', [], 15)
    const workIdx = result.findIndex((r) => r.tag === 'work')
    const deepWorkIdx = result.findIndex((r) => r.tag === 'deep-work')
    expect(workIdx).toBeLessThan(deepWorkIdx)
  })

  it('provides smart defaults even with zero DB rows', () => {
    const result = rankSuggestions([], 'todo', '', [])
    expect(result.length).toBeGreaterThan(0)
    expect(result.map((r) => r.tag)).toContain('deep-work')
    expect(result.map((r) => r.tag)).toContain('quick-win')
  })

  it('does not duplicate smart defaults already in DB rows', () => {
    const rowsWithDefault = [...rows, row('errand', 'todo', 2)]
    const result = rankSuggestions(rowsWithDefault, 'todo', '', [], 15)
    const errandCount = result.filter((r) => r.tag === 'errand').length
    expect(errandCount).toBe(1)
  })

  it('handles bonus suggestions array', () => {
    const result = rankSuggestions(rows, 'bored', '', [], 8, ['gardening', 'painting'])
    const tags = result.map((r) => r.tag)
    expect(tags).toContain('gardening')
    expect(tags).toContain('painting')
  })

  it('does not duplicate bonus suggestions already in DB rows', () => {
    const result = rankSuggestions(rows, 'bored', '', [], 8, ['reading'])
    const readingCount = result.filter((r) => r.tag === 'reading').length
    expect(readingCount).toBe(1)
  })

  it('provides context-specific defaults per source', () => {
    const todoResult = rankSuggestions([], 'todo', '', [])
    const habitResult = rankSuggestions([], 'habit', '', [])
    const todoTags = todoResult.map((r) => r.tag)
    const habitTags = habitResult.map((r) => r.tag)
    expect(todoTags).toContain('errand')
    expect(habitTags).toContain('morning-ritual')
    expect(habitTags).not.toContain('errand')
  })
})
