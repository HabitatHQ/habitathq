import { describe, it, expect } from 'vitest'
import type { Scribble } from '~/types/database'
import { splitTag, previewTitle, previewBody, gridBody } from '~/utils/scribble'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeScribble(overrides: Partial<Scribble> = {}): Scribble {
  return {
    id: 's1',
    title: '',
    content: '',
    tags: [],
    annotations: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── splitTag ────────────────────────────────────────────────────────────────

describe('splitTag', () => {
  it('returns parent null and leaf for a plain tag', () => {
    expect(splitTag('health')).toEqual({ parent: null, leaf: 'health' })
  })

  it('splits at the last slash', () => {
    expect(splitTag('health/exercise')).toEqual({ parent: 'health', leaf: 'exercise' })
  })

  it('handles nested tags (two slashes)', () => {
    expect(splitTag('goals/fitness/run')).toEqual({ parent: 'goals/fitness', leaf: 'run' })
  })

  it('handles a tag that is just a slash', () => {
    const result = splitTag('/')
    expect(result.parent).toBe('')
    expect(result.leaf).toBe('')
  })
})

// ─── previewTitle ─────────────────────────────────────────────────────────────

describe('previewTitle', () => {
  it('returns the title when set', () => {
    const s = makeScribble({ title: 'My Note', content: 'body text' })
    expect(previewTitle(s)).toBe('My Note')
  })

  it('falls back to the first line of content when no title', () => {
    const s = makeScribble({ content: 'First line\nSecond line' })
    expect(previewTitle(s)).toBe('First line')
  })

  it('trims whitespace from the first content line', () => {
    const s = makeScribble({ content: '  trimmed  \nother' })
    expect(previewTitle(s)).toBe('trimmed')
  })

  it('returns "Untitled" when title and content are both empty', () => {
    const s = makeScribble({ content: '' })
    expect(previewTitle(s)).toBe('Untitled')
  })

  it('truncates a long first line at 72 characters', () => {
    const s = makeScribble({ content: 'a'.repeat(100) })
    expect(previewTitle(s).length).toBeLessThanOrEqual(72)
  })
})

// ─── previewBody ─────────────────────────────────────────────────────────────

describe('previewBody', () => {
  it('returns empty string when there is no title', () => {
    const s = makeScribble({ title: '', content: 'some content' })
    expect(previewBody(s)).toBe('')
  })

  it('returns content preview when title is set', () => {
    const s = makeScribble({ title: 'Title', content: 'Body text here' })
    expect(previewBody(s)).toBe('Body text here')
  })

  it('joins only the first two content lines', () => {
    const s = makeScribble({ title: 'T', content: 'line1\nline2\nline3' })
    const result = previewBody(s)
    expect(result).toContain('line1')
    expect(result).toContain('line2')
    expect(result).not.toContain('line3')
  })

  it('truncates at 120 characters', () => {
    const s = makeScribble({ title: 'T', content: 'a'.repeat(200) })
    expect(previewBody(s).length).toBeLessThanOrEqual(120)
  })
})

// ─── gridBody ────────────────────────────────────────────────────────────────

describe('gridBody', () => {
  it('returns first 4 lines of content when title is set', () => {
    const s = makeScribble({
      title: 'T',
      content: 'L1\nL2\nL3\nL4\nL5',
    })
    const result = gridBody(s)
    expect(result).toContain('L1')
    expect(result).toContain('L4')
    expect(result).not.toContain('L5')
  })

  it('skips the first line when no title (it is the implicit title)', () => {
    const s = makeScribble({ content: 'First line\nActual body\nMore' })
    const result = gridBody(s)
    expect(result).not.toContain('First line')
    expect(result).toContain('Actual body')
  })

  it('truncates at 200 characters when title is present', () => {
    const s = makeScribble({ title: 'T', content: 'a'.repeat(300) })
    expect(gridBody(s).length).toBeLessThanOrEqual(200)
  })
})
