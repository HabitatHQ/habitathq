/**
 * Unit tests for the toBindVal() helper added to database.worker.ts.
 *
 * toBindVal coerces any JS value to one of the types SQLite WASM bind()
 * accepts: string | number | bigint | null.
 * Arrays and objects are JSON-serialised; booleans become 0/1;
 * undefined becomes null.
 *
 * Because toBindVal is defined inside the worker IIFE we re-implement the
 * identical logic here so it can be tested without loading WASM.
 */
import { describe, expect, it } from 'vitest'

// ── Implementation under test (mirrored from database.worker.ts) ──────────────

function toBindVal(v: unknown): string | number | bigint | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return v
  return JSON.stringify(v)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('toBindVal — pass-through primitives', () => {
  it('passes string through unchanged', () => {
    expect(toBindVal('hello')).toBe('hello')
    expect(toBindVal('')).toBe('')
  })

  it('passes integer number through', () => {
    expect(toBindVal(42)).toBe(42)
    expect(toBindVal(0)).toBe(0)
    expect(toBindVal(-7)).toBe(-7)
  })

  it('passes float number through', () => {
    expect(toBindVal(3.14)).toBe(3.14)
    expect(toBindVal(-0.5)).toBe(-0.5)
  })

  it('passes bigint through', () => {
    expect(toBindVal(9007199254740993n)).toBe(9007199254740993n)
  })

  it('converts null to null', () => {
    expect(toBindVal(null)).toBeNull()
  })

  it('converts undefined to null', () => {
    expect(toBindVal(undefined)).toBeNull()
  })
})

describe('toBindVal — boolean coercion', () => {
  it('converts true to 1', () => {
    expect(toBindVal(true)).toBe(1)
  })

  it('converts false to 0', () => {
    expect(toBindVal(false)).toBe(0)
  })
})

describe('toBindVal — object / array serialisation', () => {
  it('serialises a plain array to a JSON string', () => {
    expect(toBindVal(['cat1', 'cat2'])).toBe('["cat1","cat2"]')
  })

  it('serialises an empty array to "[]"', () => {
    expect(toBindVal([])).toBe('[]')
  })

  it('serialises a plain object to a JSON string', () => {
    expect(toBindVal({ a: 1 })).toBe('{"a":1}')
  })

  it('serialises nested objects', () => {
    expect(toBindVal({ x: [1, 2] })).toBe('{"x":[1,2]}')
  })

  it('returns a string (never an object) for array input', () => {
    expect(typeof toBindVal(['x'])).toBe('string')
  })

  it('returns a string (never an object) for plain object input', () => {
    expect(typeof toBindVal({ key: 'val' })).toBe('string')
  })
})

describe('toBindVal — SQLite bind-safe output contract', () => {
  const ALLOWED = new Set(['string', 'number', 'bigint'])

  function isSafe(v: unknown): boolean {
    if (v === null) return true
    return ALLOWED.has(typeof v)
  }

  it('every output type is accepted by SQLite WASM bind()', () => {
    const inputs = [
      'text',
      42,
      0,
      -1,
      3.14,
      BigInt(1),
      true,
      false,
      null,
      undefined,
      [],
      ['a', 'b'],
      [1, 2, 3],
      {},
      { name: 'Alex' },
      { ids: ['x', 'y'] },
    ]
    for (const input of inputs) {
      const out = toBindVal(input)
      expect(isSafe(out), `toBindVal(${String(input)}) = ${String(out)} (${typeof out})`).toBe(true)
    }
  })
})

// ── UPDATE operation bind-array helper ───────────────────────────────────────

/**
 * Simulates the UPDATE_* bind array construction in database.worker.ts:
 *   { bind: [...Object.values(fields).map(toBindVal), id] }
 */
function buildUpdateBind(
  fields: Record<string, unknown>,
  id: string,
): (string | number | bigint | null)[] {
  return [...Object.values(fields).map(toBindVal), id]
}

describe('UPDATE bind array — object values are serialised', () => {
  it('UPDATE_ENVELOPE with category_ids as array is serialised to JSON string', () => {
    const fields = {
      name: 'Groceries',
      budget_amount: 500,
      category_ids: ['cat1', 'cat2'], // array instead of string
    }
    const bind = buildUpdateBind(fields, 'env-1')
    expect(bind).toEqual(['Groceries', 500, '["cat1","cat2"]', 'env-1'])
  })

  it('UPDATE_ENVELOPE with category_ids as JSON string passes through unchanged', () => {
    const fields = { name: 'Rent', budget_amount: 1200, category_ids: '["cat3"]' }
    const bind = buildUpdateBind(fields, 'env-2')
    expect(bind).toEqual(['Rent', 1200, '["cat3"]', 'env-2'])
  })

  it('UPDATE_USER with all primitive fields produces correct bind array', () => {
    const fields = { name: 'Alex', avatar_emoji: '🧑', is_current: 1 }
    const bind = buildUpdateBind(fields, 'u-1')
    expect(bind).toEqual(['Alex', '🧑', 1, 'u-1'])
  })

  it('UPDATE_TRANSACTION with null nullable fields uses null', () => {
    const fields = {
      amount: -42.5,
      category_id: null,
      transfer_to_account_id: null,
      updated_at: '2026-03-10T00:00:00.000Z',
    }
    const bind = buildUpdateBind(fields, 'tx-1')
    expect(bind).toEqual([-42.5, null, null, '2026-03-10T00:00:00.000Z', 'tx-1'])
  })

  it('UPDATE_SAVINGS_GOAL with undefined field becomes null', () => {
    const fields = { name: 'Vacation', target_date: undefined }
    const bind = buildUpdateBind(fields, 'sg-1')
    expect(bind).toEqual(['Vacation', null, 'sg-1'])
  })

  it('boolean field is coerced to 0/1', () => {
    // rollover, is_current, is_active etc. can arrive as booleans from UI
    const fields = { rollover: true as unknown as number }
    const bind = buildUpdateBind(fields, 'env-3')
    expect(bind).toEqual([1, 'env-3'])
  })

  it('no output value is of type "object" (the root cause of the bug)', () => {
    const fields = {
      name: 'Bills',
      category_ids: ['c1', 'c2'] as unknown as string,
      metadata: { x: 1 } as unknown as string,
      tags: [] as unknown as string,
    }
    const bind = buildUpdateBind(fields, 'env-4')
    for (const v of bind) {
      if (v !== null) {
        expect(typeof v, `bind value ${String(v)} should not be object`).not.toBe('object')
      }
    }
  })
})

// ── CREATE_ENVELOPE category_ids guard ───────────────────────────────────────

describe('CREATE_ENVELOPE category_ids serialisation', () => {
  it('array category_ids is serialised to JSON string', () => {
    const category_ids = ['cat1', 'cat2'] as unknown as string
    // mirrors: toBindVal(p.category_ids) ?? '[]'
    const bound = toBindVal(category_ids) ?? '[]'
    expect(bound).toBe('["cat1","cat2"]')
    expect(typeof bound).toBe('string')
  })

  it('undefined category_ids falls back to "[]"', () => {
    const bound = toBindVal(undefined) ?? '[]'
    expect(bound).toBe('[]')
  })

  it('null category_ids falls back to "[]"', () => {
    const bound = toBindVal(null) ?? '[]'
    expect(bound).toBe('[]')
  })

  it('valid JSON-string category_ids passes through unchanged', () => {
    const bound = toBindVal('["cat3","cat4"]') ?? '[]'
    expect(bound).toBe('["cat3","cat4"]')
  })
})

// ── catIds spread bind — GET_ENVELOPES_WITH_SPENDING / GET_DASHBOARD_SUMMARY ──
//
// These cases spread parsed JSON category IDs into SQLite bind arrays.
// If the stored JSON contains non-string elements (nested arrays, numbers,
// booleans, objects) the raw spread would fail with
// "Unsupported bind() argument type: object".
// The fix: catIds.map(toBindVal) before spreading.

/**
 * Mirrors the bind construction in GET_ENVELOPES_WITH_SPENDING /
 * GET_DASHBOARD_SUMMARY:
 *   { bind: [...catIds.map(toBindVal), start, end] }
 */
function buildCatIdsBind(
  catIds: unknown[],
  start: string,
  end: string,
): (string | number | bigint | null)[] {
  return [...catIds.map(toBindVal), start, end]
}

describe('catIds.map(toBindVal) spread — GET_*_WITH_SPENDING / GET_DASHBOARD_SUMMARY', () => {
  const start = '2026-03-01'
  const end = '2026-03-31'

  it('flat string array (seed data) passes through unchanged', () => {
    const catIds = ['c1', 'c1a', 'c1b', 'c1c']
    const bind = buildCatIdsBind(catIds, start, end)
    expect(bind).toEqual(['c1', 'c1a', 'c1b', 'c1c', start, end])
  })

  it('nested array element is JSON-serialised, not passed as object', () => {
    // Would happen if category_ids stored as '[["c1","c2"],["c3"]]'
    const catIds = [['c1', 'c2'], ['c3']] as unknown as string[]
    const bind = buildCatIdsBind(catIds, start, end)
    expect(bind).toEqual(['["c1","c2"]', '["c3"]', start, end])
    for (const v of bind) {
      if (v !== null) expect(typeof v).not.toBe('object')
    }
  })

  it('number element (e.g. legacy integer id) passes through as number', () => {
    const catIds = [1, 2, 3] as unknown as string[]
    const bind = buildCatIdsBind(catIds, start, end)
    expect(bind).toEqual([1, 2, 3, start, end])
  })

  it('null element becomes null (SQL NULL)', () => {
    const catIds = ['c1', null, 'c2'] as unknown as string[]
    const bind = buildCatIdsBind(catIds, start, end)
    expect(bind).toEqual(['c1', null, 'c2', start, end])
  })

  it('boolean element is coerced to 0/1', () => {
    const catIds = [true, false] as unknown as string[]
    const bind = buildCatIdsBind(catIds, start, end)
    expect(bind).toEqual([1, 0, start, end])
  })

  it('plain object element is JSON-serialised', () => {
    const catIds = [{ id: 'c1' }] as unknown as string[]
    const bind = buildCatIdsBind(catIds, start, end)
    expect(bind[0]).toBe('{"id":"c1"}')
    expect(typeof bind[0]).toBe('string')
  })

  it('no output value ever has typeof === "object" regardless of catIds content', () => {
    const catIds = [
      'c1',
      42,
      null,
      true,
      false,
      ['nested'],
      { key: 'val' },
      undefined,
    ] as unknown as string[]
    const bind = buildCatIdsBind(catIds, start, end)
    for (const v of bind) {
      if (v !== null) {
        expect(typeof v, `typeof ${String(v)} should not be object`).not.toBe('object')
      }
    }
  })

  it('empty catIds array produces only [start, end]', () => {
    expect(buildCatIdsBind([], start, end)).toEqual([start, end])
  })
})
