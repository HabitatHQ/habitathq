/**
 * Regression tests for the Jots page crash caused by scribbles with null tags.
 *
 * Root cause: old DB rows could store JSON.stringify(null) → "null" as the
 * tags column value. JSON.parse("null") returns null (not []), so the template
 * would crash on `item.data.tags.length`.
 *
 * Fixes:
 *   1. safeJsonParse now falls back when the parsed result is null/undefined.
 *   2. Template uses optional chaining (`item.data.tags?.length`).
 */
import { describe, it, expect } from 'vitest'
import type { Scribble } from '~/types/database'
import { previewTitle, previewBody, gridBody } from '~/utils/scribble'
import { safeJsonParse } from '~/utils/safe-json'

describe('safeJsonParse (DB helper contract)', () => {
  it('returns fallback for SQL NULL (null input)', () => {
    expect(safeJsonParse(null, [])).toEqual([])
  })

  it('returns fallback for undefined', () => {
    expect(safeJsonParse(undefined, [])).toEqual([])
  })

  it('returns fallback for the JSON string "null" (stored null)', () => {
    // JSON.stringify(null) === "null"; old rows could have this value
    expect(safeJsonParse('null', [])).toEqual([])
  })

  it('parses a valid JSON array', () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(['a', 'b'])
  })

  it('parses a valid JSON object', () => {
    expect(safeJsonParse('{"k":"v"}', {})).toEqual({ k: 'v' })
  })

  it('returns fallback for malformed JSON', () => {
    expect(safeJsonParse('not-json', [])).toEqual([])
  })
})

// ─── Scribble helpers with null-like tags ────────────────────────────────────
// The helpers themselves don't access .tags, but these guard against future
// refactors that might add tag access.

function makeScribble(overrides: Partial<Scribble> = {}): Scribble {
  return {
    id: 's1',
    title: 'Title',
    content: 'Content',
    tags: [],
    annotations: {},
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('scribble utils — null/empty tags robustness', () => {
  it('previewTitle does not throw with null tags (cast)', () => {
    const s = makeScribble({ tags: null as unknown as string[] })
    expect(() => previewTitle(s)).not.toThrow()
  })

  it('previewBody does not throw with null tags (cast)', () => {
    const s = makeScribble({ tags: null as unknown as string[] })
    expect(() => previewBody(s)).not.toThrow()
  })

  it('gridBody does not throw with null tags (cast)', () => {
    const s = makeScribble({ tags: null as unknown as string[] })
    expect(() => gridBody(s)).not.toThrow()
  })
})

// ─── Template expressions — guard against null tags ──────────────────────────
// These replicate the exact expressions used in the jots/index.vue template.
// If tags is null, these must not throw.

describe('jots index template null-safety expressions', () => {
  it('tags?.length check does not throw when tags is null', () => {
    const tags = null as unknown as string[]
    expect(() => tags?.length).not.toThrow()
    expect(tags?.length).toBeUndefined()
  })

  it('(tags || []).slice(0, 5) does not throw when tags is null', () => {
    const tags = null as unknown as string[]
    expect(() => (tags || []).slice(0, 5)).not.toThrow()
    expect((tags || []).slice(0, 5)).toEqual([])
  })

  it('(tags?.length || 0) - 5 is safe when tags is null', () => {
    const tags = null as unknown as string[]
    expect((tags?.length || 0) - 5).toBe(-5)
  })

  it('tags.length (unsafe form) throws when tags is null — confirms why the fix was needed', () => {
    const tags = null as unknown as string[]
    expect(() => tags.length).toThrow()
  })
})
