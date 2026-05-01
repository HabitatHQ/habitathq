import { describe, expect, it } from 'vitest'
import { buildTagSeed, PREDEFINED_TAGS } from '~/lib/tags'

describe('PREDEFINED_TAGS', () => {
  it('has 12 predefined tags', () => {
    expect(PREDEFINED_TAGS).toHaveLength(12)
  })

  it('all tags have name, category, color', () => {
    for (const t of PREDEFINED_TAGS) {
      expect(t.name).toMatch(/^#/)
      expect(t.category).toMatch(/^(performance|feel|environment|custom)$/)
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('includes performance tags', () => {
    const perf = PREDEFINED_TAGS.filter((t) => t.category === 'performance')
    expect(perf.length).toBeGreaterThanOrEqual(4)
  })

  it('includes feel tags', () => {
    const feel = PREDEFINED_TAGS.filter((t) => t.category === 'feel')
    expect(feel.length).toBeGreaterThanOrEqual(2)
  })

  it('includes environment tags', () => {
    const env = PREDEFINED_TAGS.filter((t) => t.category === 'environment')
    expect(env.length).toBeGreaterThanOrEqual(4)
  })
})

describe('buildTagSeed', () => {
  it('returns 12 rows', () => {
    expect(buildTagSeed()).toHaveLength(12)
  })

  it('all rows have is_predefined = 1', () => {
    for (const row of buildTagSeed()) {
      expect(row.is_predefined).toBe(1)
    }
  })

  it('ids are deterministic', () => {
    const a = buildTagSeed('2026-01-01')
    const b = buildTagSeed('2026-01-01')
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
  })

  it('uses provided createdAt', () => {
    const rows = buildTagSeed('2026-03-10T12:00:00Z')
    for (const r of rows) {
      expect(r.created_at).toBe('2026-03-10T12:00:00Z')
    }
  })
})
