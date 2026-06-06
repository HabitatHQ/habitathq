import { describe, it, expect, beforeEach } from 'vitest'
import type { DbAdapter } from '~/types/database'
import { getRecentSharedScribbles, createScribble } from '~/lib/db-shared'
import { getShareTag, isShareTag } from '~/utils/share-helpers'

// ─── MockDbAdapter ────────────────────────────────────────────────────────────

class MockDbAdapter implements DbAdapter {
  calls: { method: string; sql: string; bind?: unknown[] }[] = []
  private rows: Map<string, unknown[]> = new Map()

  setRows(sqlSubstring: string, rows: unknown[]) {
    this.rows.set(sqlSubstring, rows)
  }

  private findRows(sql: string): unknown[] {
    for (const [key, rows] of this.rows) {
      if (sql.includes(key)) return rows
    }
    return []
  }

  async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
    this.calls.push({ method: 'queryAll', sql, bind })
    return this.findRows(sql) as T[]
  }

  async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
    this.calls.push({ method: 'queryOne', sql, bind })
    const rows = this.findRows(sql) as T[]
    return rows[0] ?? null
  }

  async exec(sql: string, bind?: unknown[]): Promise<void> {
    this.calls.push({ method: 'exec', sql, bind })
  }
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

describe('getShareTag', () => {
  it('returns shared/url for url type', () => {
    expect(getShareTag('url')).toBe('shared/url')
  })

  it('returns shared/clipping for text type', () => {
    expect(getShareTag('text')).toBe('shared/clipping')
  })

  it('returns shared/image for image type', () => {
    expect(getShareTag('image')).toBe('shared/image')
  })
})

describe('isShareTag', () => {
  it('returns true for shared/ prefixed tags', () => {
    expect(isShareTag('shared/url')).toBe(true)
    expect(isShareTag('shared/clipping')).toBe(true)
    expect(isShareTag('shared/image')).toBe(true)
  })

  it('returns false for non-shared tags', () => {
    expect(isShareTag('health/exercise')).toBe(false)
    expect(isShareTag('personal')).toBe(false)
    expect(isShareTag('')).toBe(false)
  })
})

// ─── getRecentSharedScribbles ─────────────────────────────────────────────────

describe('getRecentSharedScribbles', () => {
  let db: MockDbAdapter

  beforeEach(() => {
    db = new MockDbAdapter()
  })

  it('queries scribbles with shared/ tag within the time window', async () => {
    db.setRows('scribbles', [])
    await getRecentSharedScribbles(db, 7)

    expect(db.calls).toHaveLength(1)
    expect(db.calls[0]!.method).toBe('queryAll')
    expect(db.calls[0]!.sql).toContain('shared/')
    expect(db.calls[0]!.sql).toContain('created_at >= ?')
  })

  it('returns parsed scribbles from rows', async () => {
    const now = new Date().toISOString()
    db.setRows('scribbles', [
      {
        id: 's1',
        title: 'Test URL',
        content: 'https://example.com',
        tags: '["shared/url"]',
        annotations: '{"source_url":"https://example.com"}',
        created_at: now,
        updated_at: now,
      },
    ])

    const result = await getRecentSharedScribbles(db, 7)
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe('Test URL')
    expect(result[0]!.tags).toEqual(['shared/url'])
    expect(result[0]!.annotations['source_url']).toBe('https://example.com')
  })

  it('uses the correct cutoff date for days_back parameter', async () => {
    db.setRows('scribbles', [])
    await getRecentSharedScribbles(db, 3)

    const bindValue = db.calls[0]!.bind![0] as string
    const cutoffDate = new Date(bindValue)
    const expectedCutoff = new Date(Date.now() - 3 * 86_400_000)
    expect(Math.abs(cutoffDate.getTime() - expectedCutoff.getTime())).toBeLessThan(1000)
  })
})

// ─── createScribble with share tags ───────────────────────────────────────────

describe('createScribble with share tags', () => {
  let db: MockDbAdapter

  beforeEach(() => {
    db = new MockDbAdapter()
  })

  it('persists tags including shared/ prefix', async () => {
    const now = new Date().toISOString()
    db.setRows('SELECT * FROM scribbles WHERE id', [{
      id: 'test-id',
      title: 'Shared Link',
      content: 'https://example.com',
      tags: '["shared/url"]',
      annotations: '{"source_url":"https://example.com"}',
      created_at: now,
      updated_at: now,
    }])

    const result = await createScribble(db, {
      title: 'Shared Link',
      content: 'https://example.com',
      tags: ['shared/url'],
      annotations: { source_url: 'https://example.com' },
    })

    expect(result.tags).toEqual(['shared/url'])
    expect(result.annotations['source_url']).toBe('https://example.com')

    const insertCall = db.calls.find((c) => c.method === 'exec' && c.sql.includes('INSERT'))
    expect(insertCall).toBeDefined()
    expect(insertCall!.bind).toContain('["shared/url"]')
  })

  it('stores text clipping with shared/clipping tag', async () => {
    const now = new Date().toISOString()
    db.setRows('SELECT * FROM scribbles WHERE id', [{
      id: 'test-id-2',
      title: 'Some text clipping that was highlighted',
      content: 'The full text content of the clipping that was shared from another app.',
      tags: '["shared/clipping"]',
      annotations: '{}',
      created_at: now,
      updated_at: now,
    }])

    const result = await createScribble(db, {
      title: 'Some text clipping that was highlighted',
      content: 'The full text content of the clipping that was shared from another app.',
      tags: ['shared/clipping'],
      annotations: {},
    })

    expect(result.tags).toEqual(['shared/clipping'])
    expect(result.title).toBe('Some text clipping that was highlighted')
  })
})
