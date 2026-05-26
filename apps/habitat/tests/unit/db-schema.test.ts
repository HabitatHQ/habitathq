// @vitest-environment node
import type { DbAdapter } from '@palladium/core'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SCHEMA_CONFIG, SCHEMA_DDL } from '~/lib/db-schema'

function nodeAdapter(db: DatabaseSync): DbAdapter {
  return {
    queryAll: async <T,>(sql: string, bind?: unknown[]) =>
      db.prepare(sql).all(...((bind ?? []) as never[])) as T[],
    queryOne: async <T,>(sql: string, bind?: unknown[]) =>
      (db.prepare(sql).get(...((bind ?? []) as never[])) as T) ?? null,
    exec: async (sql: string, bind?: unknown[]) => {
      if (bind?.length) {
        db.prepare(sql).run(...(bind as never[]))
      } else {
        db.exec(sql)
      }
    },
  }
}

function freshDb(): { db: DatabaseSync; adapter: DbAdapter } {
  const db = new DatabaseSync(':memory:')
  const adapter = nodeAdapter(db)
  return { db, adapter }
}

async function applyDdl(adapter: DbAdapter): Promise<void> {
  await adapter.exec(SCHEMA_DDL)
}

async function ensureSeedsTable(adapter: DbAdapter): Promise<void> {
  await adapter.exec(
    'CREATE TABLE IF NOT EXISTS _palladium_seeds (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
}

async function runSeeds(adapter: DbAdapter): Promise<void> {
  await ensureSeedsTable(adapter)
  const seeds = SCHEMA_CONFIG.seeds
  if (!seeds) return
  for (const seed of seeds) {
    const already = await adapter.queryOne<{ key: string }>(
      'SELECT key FROM _palladium_seeds WHERE key = ?',
      [seed.key],
    )
    if (already) continue

    const exec = async <T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<T[]> => {
      if (
        sql.trim().toUpperCase().startsWith('SELECT') ||
        sql.trim().toUpperCase().startsWith('PRAGMA')
      ) {
        return adapter.queryAll<T>(sql, params)
      }
      await adapter.exec(sql, params)
      return []
    }
    await seed.apply(exec)

    await adapter.exec(
      'INSERT OR IGNORE INTO _palladium_seeds (key, applied_at) VALUES (?, ?)',
      [seed.key, new Date().toISOString()],
    )
  }
}

// ─── DDL ─────────────────────────────────────────────────────────────────────

describe('SCHEMA_DDL', () => {
  const expectedTables = [
    'habits',
    'completions',
    'habit_schedules',
    'habit_logs',
    'scribbles',
    'checkin_templates',
    'checkin_questions',
    'checkin_responses',
    'checkin_completions',
    'applied_defaults',
    'bored_categories',
    'bored_activities',
    'todos',
    'voice_notes',
    'image_notes',
  ]

  it('creates all expected tables', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)

    const tables = await adapter.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    const names = tables.map((t) => t.name).sort()
    for (const t of expectedTables) {
      expect(names, `missing table: ${t}`).toContain(t)
    }
  })

  it('creates indices on completions', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)

    const indices = await adapter.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'completions'",
    )
    const names = indices.map((i) => i.name)
    expect(names).toContain('idx_completions_date')
    expect(names).toContain('idx_completions_habit_id')
  })
})

// ─── Seeds ───────────────────────────────────────────────────────────────────

describe('SCHEMA_CONFIG seeds', () => {
  it('seeds check-in templates on fresh DB', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await runSeeds(adapter)

    const templates = await adapter.queryAll<{ title: string }>(
      'SELECT title FROM checkin_templates',
    )
    expect(templates.length).toBeGreaterThanOrEqual(2)
    const titles = templates.map((t) => t.title)
    expect(titles).toContain('Morning Check-in')
    expect(titles).toContain('Evening Reflection')
    expect(titles).toContain('Weekly Review')
  })

  it('seeds bored categories with activities', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await runSeeds(adapter)

    const cats = await adapter.queryAll<{ name: string }>('SELECT name FROM bored_categories')
    expect(cats.length).toBeGreaterThanOrEqual(5)
    const catNames = cats.map((c) => c.name)
    expect(catNames).toContain('Things to Read')
    expect(catNames).toContain('Chores')
    expect(catNames).toContain('Idle Quests')

    const activities = await adapter.queryAll<{ id: string }>('SELECT id FROM bored_activities')
    expect(activities.length).toBeGreaterThan(0)
  })

  it('is idempotent — running twice does not duplicate', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await runSeeds(adapter)
    const first = await adapter.queryAll<{ id: string }>('SELECT id FROM checkin_templates')
    const firstCats = await adapter.queryAll<{ id: string }>('SELECT id FROM bored_categories')
    await runSeeds(adapter)
    const second = await adapter.queryAll<{ id: string }>('SELECT id FROM checkin_templates')
    const secondCats = await adapter.queryAll<{ id: string }>('SELECT id FROM bored_categories')
    expect(second.length).toBe(first.length)
    expect(secondCats.length).toBe(firstCats.length)
  })
})

// ─── Schema config structure ─────────────────────────────────────────────────

describe('SCHEMA_CONFIG', () => {
  it('has version 19', () => {
    expect(SCHEMA_CONFIG.version).toBe(19)
  })

  it('defines migrations for versions 11-19', () => {
    const keys = Object.keys(SCHEMA_CONFIG.migrations ?? {}).map(Number).sort((a, b) => a - b)
    expect(keys).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it('has seeds array', () => {
    expect(SCHEMA_CONFIG.seeds).toBeDefined()
    expect(SCHEMA_CONFIG.seeds!.length).toBeGreaterThan(0)
  })

  it('migration 15 (icon remap) uses callback, not raw SQL', () => {
    const m15 = SCHEMA_CONFIG.migrations?.[15]
    expect(Array.isArray(m15)).toBe(true)
    expect(typeof (m15 as unknown[])[0]).toBe('function')
  })

  it('migration 18 (palladium seeds backfill) uses callback', () => {
    const m18 = SCHEMA_CONFIG.migrations?.[18]
    expect(Array.isArray(m18)).toBe(true)
    expect(typeof (m18 as unknown[])[0]).toBe('function')
  })
})
