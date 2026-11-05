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

async function freshDb(): Promise<DbAdapter> {
  const db = new DatabaseSync(':memory:')
  const adapter = nodeAdapter(db)
  await adapter.exec(SCHEMA_DDL)
  return adapter
}

async function ensureSeedsTable(adapter: DbAdapter): Promise<void> {
  await adapter.exec(
    'CREATE TABLE IF NOT EXISTS _palladium_seeds (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
}

async function runSeedDefaults(adapter: DbAdapter): Promise<void> {
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

describe('SCHEMA_CONFIG seeds — fresh install', () => {
  it('seeds at least one user', async () => {
    const adapter = await freshDb()
    await runSeedDefaults(adapter)
    const users = await adapter.queryAll<{ id: string }>('SELECT id FROM users')
    expect(users.length).toBeGreaterThan(0)
  })

  it('seeds at least one account', async () => {
    const adapter = await freshDb()
    await runSeedDefaults(adapter)
    const accounts = await adapter.queryAll<{ id: string }>('SELECT id FROM accounts')
    expect(accounts.length).toBeGreaterThan(0)
  })

  it('seeded user is marked is_current = 1', async () => {
    const adapter = await freshDb()
    await runSeedDefaults(adapter)
    const current = await adapter.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE is_current = 1',
    )
    expect(current).not.toBeNull()
  })

  it('is idempotent — running twice does not duplicate seed rows', async () => {
    const adapter = await freshDb()
    await runSeedDefaults(adapter)
    await runSeedDefaults(adapter)
    const users = await adapter.queryAll<{ id: string }>('SELECT id FROM users')
    const accounts = await adapter.queryAll<{ id: string }>('SELECT id FROM accounts')
    expect(users.length).toBe(1)
    expect(accounts.length).toBe(1)
  })

  it('does not overwrite existing user/account on an already-populated DB', async () => {
    const adapter = await freshDb()
    await runSeedDefaults(adapter)
    const seededUser = await adapter.queryOne<{ id: string }>('SELECT id FROM users LIMIT 1')
    await adapter.exec(
      'INSERT INTO accounts (id, user_id, name, type, balance, currency, color, icon, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        'acct-2',
        seededUser!.id,
        'Savings',
        'savings',
        0,
        'USD',
        '#888',
        'i-lucide-piggy-bank',
        1,
        new Date().toISOString(),
      ],
    )
    await runSeedDefaults(adapter)
    const accounts = await adapter.queryAll<{ id: string }>('SELECT id FROM accounts')
    expect(accounts.length).toBe(2)
  })
})


describe('category seeds', () => {
  it('seeds defaults into an initialized but empty catalog', async () => {
    const adapter = await freshDb()
    await ensureSeedsTable(adapter)
    await adapter.exec(
      "INSERT INTO _palladium_seeds (key, applied_at) VALUES ('default-user-account', 'legacy')",
    )
    await runSeedDefaults(adapter)
    const rows = await adapter.queryAll<{ id: string }>('SELECT id FROM categories')
    expect(rows.map((row) => row.id)).toContain('c1a')
    expect(rows.map((row) => row.id)).toContain('c7')
    expect(rows.length).toBe(26)
  })
  it('preserves partial default rows and custom categories while filling missing IDs', async () => {
    const adapter = await freshDb()
    await ensureSeedsTable(adapter)
    await adapter.exec(
      "INSERT INTO _palladium_seeds (key, applied_at) VALUES ('default-user-account', 'legacy')",
    )
    await adapter.exec(
      "INSERT INTO categories (id, name, icon, color, sort_order) VALUES ('c1a','My Groceries','star','#123456',77)",
    )
    await adapter.exec(
      "INSERT INTO categories (id, name, icon, color, sort_order) VALUES ('custom','Custom','tag','#abcdef',90)",
    )
    await runSeedDefaults(adapter)
    await runSeedDefaults(adapter)
    const rows = await adapter.queryAll<{ id: string; name: string; color: string; sort_order: number }>(
      'SELECT id, name, color, sort_order FROM categories ORDER BY id',
    )
    expect(rows.find((row) => row.id === 'c1a')).toEqual({
      id: 'c1a',
      name: 'My Groceries',
      color: '#123456',
      sort_order: 77,
    })
    expect(rows.find((row) => row.id === 'custom')).toEqual({
      id: 'custom',
      name: 'Custom',
      color: '#abcdef',
      sort_order: 90,
    })
    expect(rows.some((row) => row.id === 'c7')).toBe(true)
    expect(rows.some((row) => row.id === 'c7a')).toBe(true)
    expect(rows.length).toBeGreaterThan(2)
  })
})

describe('transactions home-currency migration', () => {
  it('adds nullable home_currency without rewriting persisted conversions', async () => {
    const db = new DatabaseSync(':memory:')
    const adapter = nodeAdapter(db)
    await adapter.exec(SCHEMA_DDL.replace('    home_currency            TEXT,\n', ''))
    await adapter.exec(`INSERT INTO transactions
      (id,date,amount,currency,description,created_at,updated_at,source,home_amount,exchange_rate)
      VALUES ('legacy','2024-02-03',12.5,'EUR','old conversion','2024-02-03','2024-02-03','import',13.75,1.1)`)
    const migration = SCHEMA_CONFIG.migrations?.[11]
    expect(migration).toBeDefined()
    for (const step of migration as Array<(exec: typeof adapter.exec) => Promise<void>>) {
      await step(adapter.exec.bind(adapter))
    }
    const tx = await adapter.queryOne<{ amount: number; home_amount: number; home_currency: string | null }>(
      "SELECT amount, home_amount, home_currency FROM transactions WHERE id = 'legacy'",
    )
    expect(tx).toEqual({ amount: 12.5, home_amount: 13.75, home_currency: null })
  })
})

describe('recurring currency migration', () => {
  it('preserves legacy patterns with an unknown denomination as null', async () => {
    const db = new DatabaseSync(':memory:')
    const adapter = nodeAdapter(db)
    await adapter.exec(SCHEMA_DDL.replace('    currency        TEXT,\n    type', '    type'))
    await adapter.exec(`INSERT INTO recurring_patterns
      (id,merchant,type,"interval",average_amount,last_occurrence,next_expected,confidence,status,transaction_ids)
      VALUES ('legacy-pattern','Cafe','expense','monthly',20,'2024-01-01','2024-02-01',0.8,'confirmed','[]')`)
    const migration = SCHEMA_CONFIG.migrations?.[12]
    expect(migration).toBeDefined()
    for (const step of migration as Array<(exec: typeof adapter.exec) => Promise<void>>) {
      await step(adapter.exec.bind(adapter))
    }
    const row = await adapter.queryOne<{ merchant: string; average_amount: number; currency: string | null }>(
      "SELECT merchant, average_amount, currency FROM recurring_patterns WHERE id = 'legacy-pattern'",
    )
    expect(row).toEqual({ merchant: 'Cafe', average_amount: 20, currency: null })
  })
})

// ─── Migration v9 integration ────────────────────────────────────────────────

describe('migration v9 — applied_defaults → _palladium_seeds', () => {
  async function dbWithAppliedDefaults(): Promise<DbAdapter> {
    const adapter = await freshDb()
    await adapter.exec(
      "INSERT INTO applied_defaults (key) VALUES ('default-user-account')",
    )
    return adapter
  }

  async function runMigration9(adapter: DbAdapter): Promise<void> {
    const m9 = SCHEMA_CONFIG.migrations?.[9]
    if (!m9) throw new Error('migration 9 not found')
    const callback = (m9 as unknown[])[0] as (
      exec: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
    ) => Promise<void>

    const exec = async <T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<T[]> => {
      if (
        sql.trim().toUpperCase().startsWith('SELECT') ||
        sql.trim().toUpperCase().startsWith('PRAGMA') ||
        sql.trim().toUpperCase().startsWith('CREATE')
      ) {
        if (
          sql.trim().toUpperCase().startsWith('SELECT') ||
          sql.trim().toUpperCase().startsWith('PRAGMA')
        ) {
          return adapter.queryAll<T>(sql, params)
        }
        await adapter.exec(sql, params)
        return []
      }
      await adapter.exec(sql, params)
      return []
    }
    await callback(exec)
  }

  it('creates _palladium_seeds table', async () => {
    const adapter = await dbWithAppliedDefaults()
    await runMigration9(adapter)
    const tables = await adapter.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_palladium_seeds'",
    )
    expect(tables.length).toBe(1)
  })

  it('copies applied_defaults keys into _palladium_seeds', async () => {
    const adapter = await dbWithAppliedDefaults()
    await runMigration9(adapter)
    const seeds = await adapter.queryAll<{ key: string; applied_at: string }>(
      'SELECT key, applied_at FROM _palladium_seeds',
    )
    expect(seeds.length).toBe(1)
    expect(seeds[0]!.key).toBe('default-user-account')
    expect(seeds[0]!.applied_at).toBeTruthy()
  })

  it('is idempotent — running twice does not duplicate', async () => {
    const adapter = await dbWithAppliedDefaults()
    await runMigration9(adapter)
    await runMigration9(adapter)
    const seeds = await adapter.queryAll<{ key: string }>(
      'SELECT key FROM _palladium_seeds',
    )
    expect(seeds.length).toBe(1)
  })
})
