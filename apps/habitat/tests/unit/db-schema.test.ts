// @vitest-environment node
import type {
  DbAdapter,
  MigrationExec,
  MigrationStep,
  StorageAdapter,
  TransactableStorageAdapter,
} from '@palladium/core'
import { applySchema } from '@palladium/core'
import { SCHEMA_CONFIG, SCHEMA_DDL } from '~/lib/db-schema'
import { normalizeNameKey } from '~/lib/unique-names'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

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

function schemaStorage(db: DatabaseSync): TransactableStorageAdapter {
  return {
    open: async () => {},
    close: async () => {},
    exec: async <T,>(sql: string, bind?: readonly unknown[]) => {
      const head = sql.trim().toUpperCase()
      if (head.startsWith('SELECT') || head.startsWith('PRAGMA')) {
        return db.prepare(sql).all(...((bind ?? []) as never[])) as T[]
      }
      if (bind?.length) {
        db.prepare(sql).run(...(bind as never[]))
      } else {
        db.exec(sql)
      }
      return []
    },
    put: async () => {
      throw new Error('not used by schema tests')
    },
    patch: async () => {
      throw new Error('not used by schema tests')
    },
    remove: async () => {
      throw new Error('not used by schema tests')
    },
    runMigrations: async (migrations) => {
      for (const migration of migrations) db.exec(migration)
    },
    transaction: async <T,>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T> => {
      db.exec('BEGIN')
      try {
        const result = await fn(schemaStorage(db))
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

function freshDb(): { db: DatabaseSync; adapter: DbAdapter; storage: StorageAdapter } {
  const db = new DatabaseSync(':memory:')
  return { db, adapter: nodeAdapter(db), storage: schemaStorage(db) }
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

/** Full column metadata for one table: name, declared type, NOT NULL, default. */
async function columnMeta(adapter: DbAdapter, table: string) {
  const cols = await adapter.queryAll<{
    name: string
    type: string
    notnull: number
    dflt_value: string | null
  }>(`PRAGMA table_info('${table}')`)
  return cols
    .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, dflt_value: c.dflt_value }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** MigrationExec that routes reads to queryAll and runs writes as-is (no error suppression). */
function plainExec(adapter: DbAdapter): MigrationExec {
  return async <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
    const head = sql.trim().toUpperCase()
    if (head.startsWith('SELECT') || head.startsWith('PRAGMA')) {
      return adapter.queryAll<T>(sql, params as unknown[]) as Promise<T[]>
    }
    await adapter.exec(sql, params as unknown[])
    return [] as T[]
  }
}

/**
 * MigrationExec for the fresh-DDL replay. Legacy UNGUARDED `ALTER TABLE … ADD
 * COLUMN` migrations (12/16/17) re-run against a fresh SCHEMA_DDL database that
 * already mirrors the column, raising "duplicate column name". That single,
 * expected collision — and ONLY for an ADD COLUMN statement — is tolerated; it
 * is what confirms the column is present in DDL. Every other failure (including
 * a duplicate-column error from any other statement kind) is real drift or a
 * malformed migration and is rethrown so it fails the test.
 */
function replayExec(adapter: DbAdapter): MigrationExec {
  return async <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
    const head = sql.trim().toUpperCase()
    if (head.startsWith('SELECT') || head.startsWith('PRAGMA')) {
      return adapter.queryAll<T>(sql, params as unknown[]) as Promise<T[]>
    }
    const isAddColumn = /^ALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\b/.test(head)
    try {
      await adapter.exec(sql, params as unknown[])
    } catch (e) {
      if (!(isAddColumn && /duplicate column name/i.test(String(e)))) throw e
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

  it('enforces normalized unique habit names and check-in titles', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await runSeeds(adapter)

    await adapter.exec(
      "INSERT INTO habits (id,name,created_at) VALUES ('habit-one','Run','2026-01-01')",
    )
    await expect(
      adapter.exec(
        "INSERT INTO habits (id,name,created_at) VALUES ('habit-two','  run  ','2026-01-02')",
      ),
    ).rejects.toThrow()

    await adapter.exec(
      "INSERT INTO checkin_templates (id,title) VALUES ('checkin-one','Morning')",
    )
    await expect(
      adapter.exec(
        "INSERT INTO checkin_templates (id,title) VALUES ('checkin-two','morning')",
      ),
    ).rejects.toThrow()
  })

  it('enforces Unicode case-insensitive unique habit names and check-in titles', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await runSeeds(adapter)

    await adapter.exec(
      "INSERT INTO habits (id,name,name_key,created_at) VALUES ('habit-one','École',?,'2026-01-01')",
      [normalizeNameKey('École')],
    )
    await expect(
      adapter.exec(
        "INSERT INTO habits (id,name,name_key,created_at) VALUES ('habit-two','école',?,'2026-01-02')",
        [normalizeNameKey('école')],
      ),
    ).rejects.toThrow()

    await adapter.exec(
      "INSERT INTO checkin_templates (id,title,title_key) VALUES ('checkin-one','École',?)",
      [normalizeNameKey('École')],
    )
    await expect(
      adapter.exec(
        "INSERT INTO checkin_templates (id,title,title_key) VALUES ('checkin-two','école',?)",
        [normalizeNameKey('école')],
      ),
    ).rejects.toThrow()
  })

  it('renames legacy duplicate habit names and check-in titles before enforcing uniqueness', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await adapter.exec('ALTER TABLE habits DROP COLUMN name_key')
    await adapter.exec('ALTER TABLE checkin_templates DROP COLUMN title_key')
    await adapter.exec(
      "INSERT INTO habits (id,name,created_at) VALUES ('habit-one','Run','2026-01-01')",
    )
    await adapter.exec(
      "INSERT INTO habits (id,name,created_at) VALUES ('habit-two','run','2026-01-02')",
    )
    await adapter.exec(
      "INSERT INTO checkin_templates (id,title) VALUES ('checkin-one','Morning')",
    )
    await adapter.exec(
      "INSERT INTO checkin_templates (id,title) VALUES ('checkin-two','morning')",
    )

    await runSeeds(adapter)

    const habits = await adapter.queryAll<{ name: string; name_key: string }>(
      'SELECT name, name_key FROM habits ORDER BY created_at',
    )
    const templates = await adapter.queryAll<{ title: string; title_key: string }>(
      'SELECT title, title_key FROM checkin_templates WHERE id LIKE \'checkin-%\' ORDER BY id',
    )
    expect(habits).toEqual([
      { name: 'Run', name_key: 'run' },
      { name: 'run (2)', name_key: 'run (2)' },
    ])
    expect(templates).toEqual([
      { title: 'Morning', title_key: 'morning' },
      { title: 'morning (2)', title_key: 'morning (2)' },
    ])
  })

  it('restores positive legacy logs as completions for habits that are now Boolean', async () => {
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await adapter.exec(
      "INSERT INTO habits (id,name,type,created_at) VALUES ('habit-one','Read','BOOLEAN','2026-01-01')",
    )
    await adapter.exec(
      "INSERT INTO habit_logs (id,habit_id,date,logged_at,value) VALUES ('log-one','habit-one','2026-01-02','2026-01-02T08:00:00Z',10)",
    )
    await adapter.exec(
      "INSERT INTO habit_logs (id,habit_id,date,logged_at,value) VALUES ('log-zero','habit-one','2026-01-03','2026-01-03T08:00:00Z',0)",
    )

    await runSeeds(adapter)

    const completions = await adapter.queryAll<{ date: string; completed_at: string }>(
      "SELECT date, completed_at FROM completions WHERE habit_id = 'habit-one'",
    )
    expect(completions).toEqual([{ date: '2026-01-02', completed_at: '2026-01-02T08:00:00Z' }])
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
  it('has version 26', () => {
    expect(SCHEMA_CONFIG.version).toBe(26)
  })

  it('defines migrations for versions 11-26', () => {
    const keys = Object.keys(SCHEMA_CONFIG.migrations ?? {}).map(Number).sort((a, b) => a - b)
    expect(keys).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26])
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
      `INSERT INTO scribbles (id, title, content, tags, entry_date, created_at, updated_at) VALUES ('s1', 'S', '', ?, '2026-01-01', '2026-01-01', '2026-01-01')`,
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

  it('upgrading a pre-title (v21) database reproduces the fresh SCHEMA_DDL columns exactly', async () => {
    // The fresh-DDL replay above only proves migrations 22/23 are idempotent
    // no-ops (they take their guarded branch). Here we exercise the REAL upgrade
    // path: simulate a client stamped at v21 by dropping the two `title` columns,
    // run migrations 22 & 23 through a non-swallowing exec, then assert the
    // resulting columns match a fresh SCHEMA_DDL install down to type, nullability
    // and default — catching metadata drift the name-only parity check misses.
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await adapter.exec('ALTER TABLE voice_notes DROP COLUMN title')
    await adapter.exec('ALTER TABLE image_notes DROP COLUMN title')

    const exec = plainExec(adapter)
    for (const v of [22, 23]) {
      for (const step of SCHEMA_CONFIG.migrations?.[v] as MigrationStep[]) {
        if (typeof step === 'function') await step(exec)
        else await exec(step)
      }
    }

    const { adapter: ref } = freshDb()
    await applyDdl(ref)

    for (const table of ['voice_notes', 'image_notes']) {
      expect(await columnMeta(adapter, table), table).toEqual(await columnMeta(ref, table))
    }
  })

  it('upgrading a pre-icon (v23) database reproduces the fresh checkin_templates columns exactly', async () => {
    // Simulate a client stamped at v23 by dropping the icon/color columns, then
    // run migration 24 through a non-swallowing exec and assert the resulting
    // columns match a fresh SCHEMA_DDL install.
    const { adapter } = freshDb()
    await applyDdl(adapter)
    await adapter.exec('ALTER TABLE checkin_templates DROP COLUMN icon')
    await adapter.exec('ALTER TABLE checkin_templates DROP COLUMN color')

    const exec = plainExec(adapter)
    for (const step of SCHEMA_CONFIG.migrations?.[24] as MigrationStep[]) {
      if (typeof step === 'function') await step(exec)
      else await exec(step)
    }

    const { adapter: ref } = freshDb()
    await applyDdl(ref)

    expect(await columnMeta(adapter, 'checkin_templates')).toEqual(
      await columnMeta(ref, 'checkin_templates'),
    )
  })

  it('upgrades a persisted v24 database through production schema application', async () => {
    const { adapter, storage } = freshDb()
    await applyDdl(adapter)
    await adapter.exec('ALTER TABLE scribbles DROP COLUMN entry_date')
    await adapter.exec('ALTER TABLE todos DROP COLUMN scheduled_time')
    await adapter.exec('DROP TABLE focus_sessions')
    await adapter.exec(
      "INSERT INTO scribbles (id,title,content,tags,annotations,created_at,updated_at) VALUES ('legacy-note','Legacy note', 'Keep me', '[]', '{}', '2026-05-14T09:30:00.000Z', '2026-05-14T09:30:00.000Z')",
    )
    await adapter.exec(
      "INSERT INTO todos (id,title,created_at,updated_at) VALUES ('legacy-todo','Legacy task','2026-05-14T09:30:00.000Z','2026-05-14T09:30:00.000Z')",
    )
    await adapter.exec('PRAGMA user_version = 24')

    await applySchema(storage, SCHEMA_CONFIG)
    await applySchema(storage, SCHEMA_CONFIG)

    const note = await adapter.queryOne<{ content: string; entry_date: string }>(
      "SELECT content, entry_date FROM scribbles WHERE id = 'legacy-note'",
    )
    const todo = await adapter.queryOne<{ scheduled_time: string | null }>(
      "SELECT scheduled_time FROM todos WHERE id = 'legacy-todo'",
    )
    const sessions = await adapter.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'focus_sessions'",
    )
    const indices = await adapter.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_scribbles_entry_date'",
    )
    const version = await adapter.queryOne<{ user_version: number }>('PRAGMA user_version')

    expect(note).toEqual({ content: 'Keep me', entry_date: '2026-05-14' })
    expect(todo?.scheduled_time).toBeNull()
    expect(sessions).toHaveLength(1)
    expect(indices).toHaveLength(1)
    expect(version?.user_version).toBe(26)
  })

  it('finishes a retried v25 upgrade after entry_date was added before interruption', async () => {
    const { adapter, storage } = freshDb()
    await applyDdl(adapter)
    await adapter.exec('ALTER TABLE scribbles DROP COLUMN entry_date')
    await adapter.exec('ALTER TABLE scribbles ADD COLUMN entry_date TEXT')
    await adapter.exec(
      "INSERT INTO scribbles (id,title,content,tags,annotations,created_at,updated_at) VALUES ('interrupted-note','Interrupted note', 'Preserve me', '[]', '{}', '2026-05-14T09:30:00.000Z', '2026-05-14T09:30:00.000Z')",
    )
    await adapter.exec('PRAGMA user_version = 25')

    await applySchema(storage, SCHEMA_CONFIG)

    const note = await adapter.queryOne<{ content: string; entry_date: string }>(
      "SELECT content, entry_date FROM scribbles WHERE id = 'interrupted-note'",
    )
    const version = await adapter.queryOne<{ user_version: number }>('PRAGMA user_version')

    expect(note).toEqual({ content: 'Preserve me', entry_date: '2026-05-14' })
    expect(version?.user_version).toBe(26)
  })

  it('upgrades a v24 database before creating the entry-date index', async () => {
    const { storage } = freshDb()
    const adapter = storage
    await adapter.runMigrations([SCHEMA_DDL])
    await adapter.exec('ALTER TABLE scribbles DROP COLUMN entry_date')
    await adapter.exec('PRAGMA user_version = 24')

    await applySchema(adapter, SCHEMA_CONFIG)

    const columns = await adapter.exec<{ name: string }>("PRAGMA table_info('scribbles')")
    const indexes = await adapter.exec<{ name: string }>("PRAGMA index_list('scribbles')")
    expect(columns.some((column) => column.name === 'entry_date')).toBe(true)
    expect(indexes.some((index) => index.name === 'idx_scribbles_entry_date')).toBe(true)
  })

  it('backfills NULL entry dates when retrying an incomplete v25 migration', async () => {
    const { storage } = freshDb()
    const adapter = storage
    await adapter.runMigrations([SCHEMA_DDL])
    await adapter.exec('ALTER TABLE scribbles DROP COLUMN entry_date')
    await adapter.exec('ALTER TABLE scribbles ADD COLUMN entry_date TEXT')
    await adapter.exec(
      "INSERT INTO scribbles (id,title,content,tags,annotations,created_at,updated_at) VALUES ('partial-note','', '', '[]', '{}', '2026-05-14T09:30:00.000Z', '2026-05-14T09:30:00.000Z')",
    )
    await adapter.exec('PRAGMA user_version = 25')

    await applySchema(adapter, SCHEMA_CONFIG)

    const note = await adapter.exec<{ entry_date: string }>(
      "SELECT entry_date FROM scribbles WHERE id = 'partial-note'",
    )
    expect(note[0]?.entry_date).toBe('2026-05-14')
  })
})
