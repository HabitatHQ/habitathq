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
import { safeJsonParse } from '@habitathq/utils'

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

