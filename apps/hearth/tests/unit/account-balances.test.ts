// @vitest-environment node
import type { DbAdapter } from '@palladium/core'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SCHEMA_CONFIG, SCHEMA_DDL } from '~/lib/db-schema'
import { dispatch, exportJson } from '~/lib/db-shared'
import type { HearthExport } from '~/types/database'
function nodeAdapter(db: DatabaseSync): DbAdapter {
  return {
    queryAll: async <T,>(sql: string, bind?: unknown[]) =>
      db.prepare(sql).all(...((bind ?? []) as never[])) as T[],
    queryOne: async <T,>(sql: string, bind?: unknown[]) =>
      (db.prepare(sql).get(...((bind ?? []) as never[])) as T) ?? null,
    exec: async (sql: string, bind?: unknown[]) => {
      if (bind?.length) db.prepare(sql).run(...(bind as never[]))
      else db.exec(sql)
    },
  }
}

async function migrateV10(adapter: DbAdapter): Promise<void> {
  const migration = SCHEMA_CONFIG.migrations?.[10]
  if (!Array.isArray(migration)) throw new Error('migration 10 not found')
  const callback = migration[0]
  if (typeof callback !== 'function') throw new Error('migration 10 callback not found')
  await callback(async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
    if (/^\s*(SELECT|PRAGMA)\b/i.test(sql)) return adapter.queryAll<T>(sql, params)
    await adapter.exec(sql, params)
    return []
  })
}

async function seedLegacyAccount(adapter: DbAdapter): Promise<void> {
  await adapter.exec("INSERT INTO users (id,name,role,avatar_emoji,color,is_current,created_at) VALUES ('u','Me','owner','🏠','#000',1,'now')")
  await adapter.exec("INSERT INTO accounts (id,user_id,name,type,balance,currency,color,icon,is_active,created_at) VALUES ('checking','u','Checking','checking',900,'USD','#000','wallet',1,'now')")
  await adapter.exec("INSERT INTO accounts (id,user_id,name,type,balance,currency,color,icon,is_active,created_at) VALUES ('credit','u','Credit','credit',-300,'USD','#000','card',1,'now')")
  await adapter.exec(`INSERT INTO transactions
    (id,date,amount,currency,account_id,user_id,type,description,merchant,is_private,is_recurring,created_at,updated_at,source)
    VALUES ('expense','2026-01-01',-100,'USD','checking','u','expense','','',0,0,'now','now','manual'),
           ('income','2026-01-02',200,'USD','checking','u','income','','',0,0,'now','now','manual'),
           ('payment','2026-01-03',50,'USD','checking','u','transfer','','',0,0,'now','now','manual')`)
  await adapter.exec("UPDATE transactions SET transfer_to_account_id = 'credit' WHERE id = 'payment'")
}

describe('computed account balances', () => {
  it('backfills v9 balances without changing existing displayed balances', async () => {
    const db = new DatabaseSync(':memory:')
    const adapter = nodeAdapter(db)
    await adapter.exec(SCHEMA_DDL.replace('opening_balance REAL NOT NULL DEFAULT 0,', ''))
    await seedLegacyAccount(adapter)
    await migrateV10(adapter)

    const accounts = await dispatch(adapter, { type: 'GET_ACCOUNTS' }) as Array<{ id: string; balance: number; opening_balance: number }>
    expect(accounts.find((account) => account.id === 'checking')).toMatchObject({ balance: 900, opening_balance: 850 })
    expect(accounts.find((account) => account.id === 'credit')).toMatchObject({ balance: -300, opening_balance: -350 })
  })

  it('computes signed row and incoming-transfer effects, then reconciles only opening balance', async () => {
    const db = new DatabaseSync(':memory:')
    const adapter = nodeAdapter(db)
    await adapter.exec(SCHEMA_DDL)
    await seedLegacyAccount(adapter)
    await adapter.exec('UPDATE accounts SET opening_balance = 1000 WHERE id = ?', ['checking'])
    const transactionCountBefore = await adapter.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM transactions')
    const before = await adapter.queryAll<{ amount: number }>('SELECT amount FROM transactions ORDER BY id')
    const accounts = await dispatch(adapter, { type: 'GET_ACCOUNTS_WITH_BALANCES' }) as Array<{ id: string; balance: number }>
    expect(accounts.find((account) => account.id === 'checking')?.balance).toBe(1050)
    expect(accounts.find((account) => account.id === 'credit')?.balance).toBe(50)

    await dispatch(adapter, { type: 'RECONCILE_ACCOUNT', payload: { id: 'checking', actual_balance: 1250 } })
    const reconciled = await dispatch(adapter, { type: 'GET_ACCOUNTS' }) as Array<{ id: string; balance: number; opening_balance: number }>
    expect(reconciled.find((account) => account.id === 'checking')).toMatchObject({ balance: 1250, opening_balance: 1200 })
    expect(await adapter.queryAll('SELECT amount FROM transactions ORDER BY id')).toEqual(before)
    expect(await adapter.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM transactions')).toEqual(transactionCountBefore)
  })
  it('exports computed balances while retaining opening balances', async () => {
    const db = new DatabaseSync(':memory:')
    const adapter = nodeAdapter(db)
    await adapter.exec(SCHEMA_DDL)
    await seedLegacyAccount(adapter)
    await adapter.exec("UPDATE accounts SET opening_balance = 1000 WHERE id = 'checking'")

    const backup = await exportJson(adapter)
    expect(backup.accounts.find((account) => account.id === 'checking')).toMatchObject({
      balance: 1050,
      opening_balance: 1000,
    })
    expect(backup.accounts.find((account) => account.id === 'credit')).toMatchObject({
      balance: 50,
      opening_balance: 0,
    })
  })

  it('imports an older JSON backup by deriving opening balance from its current balance', async () => {
    const db = new DatabaseSync(':memory:')
    const adapter = nodeAdapter(db)
    await adapter.exec(SCHEMA_DDL)
    const backup: HearthExport = {
      version: '1.0',
      exported_at: '2026-01-01',
      users: [{ id: 'u', name: 'Me', email: null, role: 'owner', avatar_emoji: '🏠', color: '#000', is_current: 1, created_at: 'now' }],
      accounts: [
        { id: 'checking', user_id: 'u', name: 'Checking', type: 'checking', balance: 500, currency: 'USD', color: '#000', icon: 'wallet', is_active: 1, created_at: 'now' },
        { id: 'savings', user_id: 'u', name: 'Savings', type: 'savings', balance: 400, opening_balance: 400, currency: 'USD', color: '#000', icon: 'wallet', is_active: 1, created_at: 'now' },
      ],
      categories: [],
      transactions: [{
        id: 'expense', date: '2026-01-01', amount: -25, currency: 'USD', account_id: 'checking', user_id: 'u',
        type: 'expense', category_id: null, description: '', merchant: '', is_private: 0, is_recurring: 0,
        transfer_to_account_id: null, split_id: null, source: 'manual', home_amount: null, exchange_rate: null,
        created_at: 'now', updated_at: 'now',
      }],
      envelopes: [],
      envelope_periods: [],
      iou_splits: [],
      savings_goals: [],
      chores: [],
    }
    await dispatch(adapter, { type: 'IMPORT_JSON', payload: backup })
    const accounts = await dispatch(adapter, { type: 'GET_ACCOUNTS' }) as Array<{ id: string; balance: number; opening_balance: number }>
    expect(accounts.find((account) => account.id === 'checking')).toMatchObject({ balance: 500, opening_balance: 525 })
    expect(accounts.find((account) => account.id === 'savings')).toMatchObject({ balance: 400, opening_balance: 400 })
  })

})
