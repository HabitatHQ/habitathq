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

// ─── Schema config structure ─────────────────────────────────────────────────

describe('SCHEMA_CONFIG structure', () => {
  it('has version 9', () => {
    expect(SCHEMA_CONFIG.version).toBe(9)
  })

  it('defines migrations for versions 7, 8, and 9', () => {
    const keys = Object.keys(SCHEMA_CONFIG.migrations ?? {}).map(Number).sort((a, b) => a - b)
    expect(keys).toEqual([7, 8, 9])
  })

  it('migration 9 (palladium seeds backfill) is a callback', () => {
    const m9 = SCHEMA_CONFIG.migrations?.[9]
    expect(Array.isArray(m9)).toBe(true)
    expect(typeof (m9 as unknown[])[0]).toBe('function')
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
