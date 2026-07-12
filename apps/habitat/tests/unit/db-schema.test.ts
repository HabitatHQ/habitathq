// @vitest-environment node
import type { DbAdapter, MigrationExec, MigrationStep } from '@palladium/core'
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

/** Map of table name → sorted column names, ignoring bookkeeping tables. */
async function introspect(adapter: DbAdapter): Promise<Record<string, string[]>> {
  const tables = await adapter.queryAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_palladium_seeds' ORDER BY name",
  )
  const out: Record<string, string[]> = {}
  for (const { name } of tables) {
    const cols = await adapter.queryAll<{ name: string }>(`PRAGMA table_info('${name}')`)
    out[name] = cols.map((c) => c.name).sort()
  }
  return out
}

/**
 * MigrationExec that routes reads to queryAll and swallows "duplicate column
 * name" — the expected outcome when an unguarded `ADD COLUMN` migration re-runs
 * against a schema that ALREADY has the column (i.e. correctly mirrored in DDL).
 */
function replayExec(adapter: DbAdapter): MigrationExec {
  return async <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
    const head = sql.trim().toUpperCase()
    if (head.startsWith('SELECT') || head.startsWith('PRAGMA')) {
      return adapter.queryAll<T>(sql, params as unknown[]) as Promise<T[]>
    }
    try {
      await adapter.exec(sql, params as unknown[])
    } catch (e) {
      if (!/duplicate column name/i.test(String(e))) throw e
    }
    return [] as T[]
  }
}

/** Replay every configured migration (ascending) against the given DB. */
async function replayMigrations(adapter: DbAdapter): Promise<void> {
  await ensureSeedsTable(adapter)
  const exec = replayExec(adapter)
  const migrations = SCHEMA_CONFIG.migrations ?? {}
  const versions = Object.keys(migrations)
    .map(Number)
    .sort((a, b) => a - b)
  for (const v of versions) {
    for (const step of migrations[v] as MigrationStep[]) {
      if (typeof step === 'function') await step(exec)
      else await exec(step)
    }
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
  it('has version 22', () => {
    expect(SCHEMA_CONFIG.version).toBe(22)
  })

  it('defines migrations for versions 11-22', () => {
    const keys = Object.keys(SCHEMA_CONFIG.migrations ?? {}).map(Number).sort((a, b) => a - b)
    expect(keys).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])
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

describe('migration 21 (tag normalization)', () => {
  function execFor(adapter: DbAdapter): MigrationExec {
    return async <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
      const head = sql.trim().toUpperCase()
      if (head.startsWith('SELECT') || head.startsWith('PRAGMA')) {
        return adapter.queryAll<T>(sql, params as unknown[]) as Promise<T[]>
      }
      await adapter.exec(sql, params as unknown[])
      return [] as T[]
    }
  }

  async function runMigration21(adapter: DbAdapter): Promise<void> {
    const step = (SCHEMA_CONFIG.migrations?.[21] as MigrationStep[])[0]
    if (typeof step !== 'function') throw new Error('migration 21 step is not a callback')
    await step(execFor(adapter))
  }

  it('lower-cases and de-dupes stored tags across all tagged tables', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)

    await adapter.exec(
      `INSERT INTO habits (id, name, created_at, tags) VALUES ('h1', 'H', '2026-01-01', ?)`,
      [JSON.stringify(['Work', 'work', 'FOCUS'])],
    )
    await adapter.exec(
      `INSERT INTO todos (id, title, tags, created_at, updated_at) VALUES ('t1', 'T', ?, '2026-01-01', '2026-01-01')`,
      [JSON.stringify([' Reading ', 'reading'])],
    )

    await runMigration21(adapter)

    const h = await adapter.queryOne<{ tags: string }>('SELECT tags FROM habits WHERE id = ?', [
      'h1',
    ])
    const t = await adapter.queryOne<{ tags: string }>('SELECT tags FROM todos WHERE id = ?', ['t1'])
    expect(JSON.parse(h!.tags)).toEqual(['work', 'focus'])
    expect(JSON.parse(t!.tags)).toEqual(['reading'])
  })

  it('leaves already-normalized tags untouched', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await adapter.exec(
      `INSERT INTO scribbles (id, title, content, tags, created_at, updated_at) VALUES ('s1', 'S', '', ?, '2026-01-01', '2026-01-01')`,
      [JSON.stringify(['spark', 'dream'])],
    )

    await runMigration21(adapter)

    const s = await adapter.queryOne<{ tags: string }>('SELECT tags FROM scribbles WHERE id = ?', [
      's1',
    ])
    expect(JSON.parse(s!.tags)).toEqual(['spark', 'dream'])
  })
})

// ─── DDL / migration parity ────────────────────────────────────────────────────
// Guards against the two-sources-of-truth drift that caused bug-041: fresh
// installs only ever run SCHEMA_DDL (migrations are skipped), so any column or
// table a migration adds MUST also live in SCHEMA_DDL. If it doesn't, replaying
// the migrations on a fresh DDL database mutates the schema — which this fails on.

describe('SCHEMA_DDL / migration parity', () => {
  it('replaying every migration on a fresh SCHEMA_DDL database does not change the schema', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await ensureSeedsTable(adapter)

    const before = await introspect(adapter)
    await replayMigrations(adapter)
    const after = await introspect(adapter)

    // Any added table/column here means SCHEMA_DDL is missing something a
    // migration adds — fresh installs would ship without it.
    expect(after).toEqual(before)
  })
})
