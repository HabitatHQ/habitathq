// @vitest-environment node
import type { DbAdapter } from '@habitathq/db'
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

async function runSeedDefaults(adapter: DbAdapter): Promise<void> {
  const seeds = SCHEMA_CONFIG.seeds
  if (!seeds) return
  for (const seed of seeds) {
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
