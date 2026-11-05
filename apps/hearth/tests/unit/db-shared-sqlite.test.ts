import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SCHEMA_DDL } from '~/lib/db-schema'
import {
  completeChore,
  createTransaction,
  deleteTransaction,
  dispatch,
  getAccounts,
  getDashboardSummary,
  exportJson,
  getEnvelopesWithSpending,
  getIouBalances,
  getMonthlyTotals,
  importJson,
  reconcileAccount,
} from '~/lib/db-shared'
import type { DbAdapter } from '~/types/database'
import type { HearthExport } from '~/types/database'

let sqlite: DatabaseSync
let db: DbAdapter

function makeAdapter(database: DatabaseSync, blobAsNumberArray = false): DbAdapter {
  const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
    const blob = row['image_data']
    return blobAsNumberArray && blob instanceof Uint8Array
      ? { ...row, image_data: Array.from(blob) }
      : row
  }
  return {
    async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
      return database.prepare(sql).all(...((bind ?? []) as never[])).map(normalize) as T[]
    },
    async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
      const row = database.prepare(sql).get(...((bind ?? []) as never[])) as
        | Record<string, unknown>
        | undefined
      return row ? (normalize(row) as T) : null
    },
    async exec(sql: string, bind?: unknown[]): Promise<void> {
      if (bind) database.prepare(sql).run(...(bind as never[]))
      else database.exec(sql)
    },
  }
}

function seedUsers() {
  sqlite.prepare(
    'INSERT INTO users (id,name,role,avatar_emoji,color,is_current,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run('u1', 'Alex', 'owner', 'A', '#000', 1, '2026-11-01')
  sqlite.prepare(
    'INSERT INTO users (id,name,role,avatar_emoji,color,is_current,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run('u2', 'Sam', 'partner', 'S', '#fff', 0, '2026-11-01')
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec(SCHEMA_DDL)
  db = makeAdapter(sqlite)
  seedUsers()
})

afterEach(() => sqlite.close())

describe('real SQLite database operations', () => {
  it('atomically rolls back a transaction when split insertion fails', async () => {
    sqlite.exec(`CREATE TRIGGER reject_iou BEFORE INSERT ON iou_splits
      BEGIN SELECT RAISE(ABORT, 'injected split insert failure'); END`)
    await expect(
      createTransaction(db, {
        date: '2026-11-05', amount: -80, currency: 'USD', user_id: 'u1', type: 'expense',
        iou_split: { to_user_id: 'u2', amount: 40 },
      }),
    ).rejects.toThrow(/injected split insert failure/)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toMatchObject({ count: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM iou_splits').get()).toMatchObject({ count: 0 })
  })

  it('rejects invalid shares and users before inserting the expense', async () => {
    for (const iou_split of [
      { to_user_id: 'u2', amount: 0 },
      { to_user_id: 'u2', amount: 81 },
      { to_user_id: 'u2', amount: Number.POSITIVE_INFINITY },
      { to_user_id: 'missing', amount: 10 },
      { to_user_id: 'u1', amount: 10 },
    ]) {
      await expect(
        createTransaction(db, {
          date: '2026-11-05', amount: -80, currency: 'USD', user_id: 'u1', type: 'expense',
          iou_split,
        }),
      ).rejects.toThrow()
    }
    await expect(
      createTransaction(db, {
        date: '2026-11-05', amount: Number.NaN, currency: 'USD', user_id: 'u1', type: 'expense',
        iou_split: { to_user_id: 'u2', amount: 10 },
      }),
    ).rejects.toThrow()
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toMatchObject({ count: 0 })
  })

  it('nets IOUs by household pair and denomination with canonical debt metadata', async () => {
    sqlite.prepare(
      `INSERT INTO transactions (id,date,amount,currency,user_id,type,description,merchant,
       is_private,is_recurring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('usd-tx', '2026-11-01', -10, 'USD', 'u2', 'expense', '', '', 0, 0, 'x', 'x')
    sqlite.prepare(
      `INSERT INTO transactions (id,date,amount,currency,user_id,type,description,merchant,
       is_private,is_recurring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('eur-tx', '2026-11-01', -10, 'EUR', 'u1', 'expense', '', '', 0, 0, 'x', 'x')
    sqlite.prepare('INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)').run('s1', 'usd-tx', 'u2', 'u1', 10, 0, null, 'x')
    sqlite.prepare('INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)').run('s2', 'eur-tx', 'u1', 'u2', 4, 0, null, 'x')
    sqlite.prepare('INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)').run('s3', 'eur-tx', 'u2', 'u1', 1, 0, null, 'x')
    sqlite.prepare('INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)').run('s4', null, 'u1', 'u2', 80, 0, null, 'x')

    expect(await getIouBalances(db)).toEqual([
      expect.objectContaining({ from_user_id: 'u2', to_user_id: 'u1', from_user_name: 'Sam', to_user_name: 'Alex', net_amount: 10, currency: 'USD' }),
      expect.objectContaining({ from_user_id: 'u1', to_user_id: 'u2', from_user_name: 'Alex', to_user_name: 'Sam', net_amount: 3, currency: 'EUR' }),
    ])
  })

  it('counts unresolved IOUs without loading settled or currency-resolved history', async () => {
    expect(await dispatch(db, { type: 'GET_UNRESOLVED_IOU_COUNT' })).toBe(0)
    sqlite.prepare(
      `INSERT INTO transactions (id,date,amount,currency,user_id,type,description,merchant,
       is_private,is_recurring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('usd-count', '2026-11-01', -10, 'USD', 'u2', 'expense', '', '', 0, 0, 'x', 'x')
    sqlite.prepare(
      `INSERT INTO transactions (id,date,amount,currency,user_id,type,description,merchant,
       is_private,is_recurring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('eur-count', '2026-11-01', -10, 'EUR', 'u2', 'expense', '', '', 0, 0, 'x', 'x')
    sqlite.prepare(
      `INSERT INTO transactions (id,date,amount,currency,user_id,type,description,merchant,
       is_private,is_recurring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('empty-count', '2026-11-01', -10, '', 'u2', 'expense', '', '', 0, 0, 'x', 'x')
    const insertSplit = sqlite.prepare('INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)')
    insertSplit.run('attached-usd', 'usd-count', 'u1', 'u2', 5, 0, null, 'x')
    insertSplit.run('attached-eur', 'eur-count', 'u1', 'u2', 5, 0, null, 'x')
    insertSplit.run('detached', null, 'u1', 'u2', 5, 0, null, 'x')
    insertSplit.run('settled-detached', null, 'u1', 'u2', 5, 1, 'x', 'x')
    insertSplit.run('settled-attached', 'usd-count', 'u1', 'u2', 5, 1, 'x', 'x')
    insertSplit.run('attached-empty', 'empty-count', 'u1', 'u2', 5, 0, null, 'x')
    insertSplit.run('settled-empty', 'empty-count', 'u1', 'u2', 5, 1, 'x', 'x')

    expect(await dispatch(db, { type: 'GET_UNRESOLVED_IOU_COUNT' })).toBe(2)
  })

  it('restores categories from backups whose child entries precede parents', async () => {
    const categoryRows = [
      { id: 'deep-child', parent_id: 'child', name: 'Deep Child', icon: 'leaf', color: '#333', sort_order: 3 },
      { id: 'custom', parent_id: null, name: 'Custom', icon: 'star', color: '#111', sort_order: 4 },
      { id: 'child', parent_id: 'parent', name: 'Child', icon: 'basket', color: '#222', sort_order: 2 },
      { id: 'parent', parent_id: null, name: 'Parent', icon: 'folder', color: '#000', sort_order: 1 },
    ]
    const backup = await exportJson(db)
    await importJson(db, { ...backup, categories: categoryRows })
    expect((await exportJson(db)).categories).toEqual(expect.arrayContaining(categoryRows))
  })

  it('inserts the same chore completion only once for its frequency period', async () => {
    sqlite.prepare('INSERT INTO chores (id,name,frequency,created_at) VALUES (?,?,?,?)').run(
      'chore',
      'Dishes',
      'weekly',
      'x',
    )
    await completeChore(db, { chore_id: 'chore', user_id: 'u1', date: '2026-11-05' })
    await completeChore(db, { chore_id: 'chore', user_id: 'u1', date: '2026-11-06' })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM chore_completions').get()).toMatchObject({
      count: 1,
    })
  })

  it('counts linked descendant categories once for a parent envelope', async () => {
    sqlite.prepare('INSERT INTO categories (id,parent_id,name,sort_order) VALUES (?,?,?,?)').run('parent', null, 'Food', 1)
    sqlite.prepare('INSERT INTO categories (id,parent_id,name,sort_order) VALUES (?,?,?,?)').run('child', 'parent', 'Groceries', 1)
    sqlite.prepare(
      `INSERT INTO transactions (id,date,amount,currency,user_id,type,category_id,description,merchant,
       is_private,is_recurring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('tx1', '2026-11-05', -12, 'USD', 'u1', 'expense', 'child', '', '', 0, 0, 'x', 'x')
    sqlite.prepare(
      `INSERT INTO envelopes (id,name,budget_amount,period,scope,category_ids,rollover,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run('env', 'Food', 100, 'monthly', 'household', '["parent","child"]', 0, 'x')

    const [envelope] = await getEnvelopesWithSpending(db, { period: '2026-11', home_currency: 'USD' })
    expect(envelope?.spent).toBe(12)
  })

  it('converts only known targets and reports unresolved home-currency totals', async () => {
    const insertTransaction = sqlite.prepare(
      `INSERT INTO transactions
       (id,date,amount,currency,user_id,type,category_id,description,merchant,is_private,is_recurring,
        home_amount,home_currency,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    insertTransaction.run('native', '2026-11-05', -10, 'EUR', 'u1', 'expense', null, '', '', 0, 0, null, null, 'x', 'x')
    insertTransaction.run('saved', '2026-11-05', -8, 'USD', 'u1', 'expense', null, '', '', 0, 0, -7, 'EUR', 'x', 'x')
    insertTransaction.run('cached', '2026-11-05', -5, 'GBP', 'u1', 'expense', null, '', '', 0, 0, null, null, 'x', 'x')
    insertTransaction.run('missing', '2026-11-05', -3, 'CAD', 'u1', 'expense', null, '', '', 0, 0, null, null, 'x', 'x')
    sqlite.prepare('INSERT INTO exchange_rates VALUES (?,?,?,?)').run('GBP', 'EUR', 2, '2026-11-05')
    const summary = await getDashboardSummary(db, { period: '2026-11', home_currency: 'EUR' })
    expect(summary.spent_this_month).toBe(27)
    expect(summary.missing_conversion_count).toBe(1)
    sqlite.prepare('INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)').run('legacy-iou', null, 'u1', 'u2', 4, 0, null, 'x')
    const withUnresolvedIou = await getDashboardSummary(db, { period: '2026-11', home_currency: 'EUR' })
    expect(withUnresolvedIou.unresolved_iou_count).toBe(1)
  })

  it.each(['expense', 'income'] as const)(
    'returns zero monthly totals with missing counts when every %s is unresolved',
    async (type) => {
      const insertTransaction = sqlite.prepare(
        `INSERT INTO transactions
         (id,date,amount,currency,user_id,type,description,merchant,is_private,is_recurring,
          created_at,updated_at)
         VALUES (?,date('now', 'start of month'),?,?,?,?,?,?,?,?,?,?)`,
      )
      const amount = type === 'expense' ? -12 : 12
      insertTransaction.run('missing-cad', amount, 'CAD', 'u1', type, '', '', 0, 0, 'x', 'x')
      insertTransaction.run('missing-eur', amount, 'EUR', 'u1', type, '', '', 0, 0, 'x', 'x')
      const month = sqlite.prepare("SELECT strftime('%Y-%m', 'now') AS period").get()

      expect(await getMonthlyTotals(db, { months: 1, home_currency: 'USD' })).toEqual([
        { period: month?.['period'], expenses: 0, income: 0, missing_conversion_count: 2 },
      ])
    },
  )

  it('keeps account balances in account currency and flags unresolved legs', async () => {
    const insertAccount = sqlite.prepare(
      `INSERT INTO accounts
       (id,user_id,name,type,balance,opening_balance,currency,color,icon,is_active,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    insertAccount.run('eur-account', 'u1', 'Euro', 'checking', 100, 100, 'EUR', '#000', 'wallet', 1, 'x')
    insertAccount.run('usd-account', 'u1', 'Dollar', 'checking', 50, 50, 'USD', '#000', 'wallet', 1, 'x')
    sqlite.prepare(
      `INSERT INTO transactions
       (id,date,amount,currency,account_id,user_id,type,description,merchant,is_private,is_recurring,
        home_amount,home_currency,transfer_to_account_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('known', '2026-11-05', -10, 'GBP', 'eur-account', 'u1', 'expense', '', '', 0, 0, -5, 'EUR', null, 'x', 'x')
    sqlite.prepare('INSERT INTO exchange_rates VALUES (?,?,?,?)').run('GBP', 'EUR', 1.5, '2026-11-05')
    sqlite.prepare('INSERT INTO exchange_rates VALUES (?,?,?,?)').run('GBP', 'USD', 2, '2026-11-05')
    sqlite.prepare(
      `INSERT INTO transactions
       (id,date,amount,currency,account_id,user_id,type,description,merchant,is_private,is_recurring,
        transfer_to_account_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('transfer', '2026-11-05', -10, 'GBP', 'eur-account', 'u1', 'transfer', '', '', 0, 0, 'usd-account', 'x', 'x')
    sqlite.prepare(
      `INSERT INTO transactions
       (id,date,amount,currency,account_id,user_id,type,description,merchant,is_private,is_recurring,
        transfer_to_account_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('unresolved', '2026-11-05', -3, 'CAD', 'eur-account', 'u1', 'transfer', '', '', 0, 0, 'usd-account', 'x', 'x')

    const accounts = await getAccounts(db) as Array<{ id: string; balance: number; missing_conversion_count: number }>
    expect(accounts.find(({ id }) => id === 'eur-account')).toMatchObject({
      balance: 80,
      missing_conversion_count: 1,
    })
    expect(accounts.find(({ id }) => id === 'usd-account')).toMatchObject({
      balance: 70,
      missing_conversion_count: 1,
    })
    for (const id of ['eur-account', 'usd-account']) {
      await expect(reconcileAccount(db, { id, actual_balance: 95 })).rejects.toThrow()
    }
    expect(await getAccounts(db)).toEqual(accounts)
    expect(sqlite.prepare('SELECT id, opening_balance FROM accounts ORDER BY id').all()).toEqual([
      expect.objectContaining({ id: 'eur-account', opening_balance: 100 }),
      expect.objectContaining({ id: 'usd-account', opening_balance: 50 }),
    ])

    sqlite.prepare('INSERT INTO exchange_rates VALUES (?,?,?,?)').run('CAD', 'EUR', 2, '2026-11-05')
    sqlite.prepare('INSERT INTO exchange_rates VALUES (?,?,?,?)').run('CAD', 'USD', 3, '2026-11-05')
    expect(await getAccounts(db)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'eur-account', balance: 74, missing_conversion_count: 0 }),
      expect.objectContaining({ id: 'usd-account', balance: 79, missing_conversion_count: 0 }),
    ]))
    await reconcileAccount(db, { id: 'eur-account', actual_balance: 95 })
    await reconcileAccount(db, { id: 'usd-account', actual_balance: 80 })
    const reconciled = await getAccounts(db)
    expect(reconciled).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'eur-account', balance: 95, opening_balance: 121, missing_conversion_count: 0 }),
      expect.objectContaining({ id: 'usd-account', balance: 80, opening_balance: 51, missing_conversion_count: 0 }),
    ]))
  })

  it('round-trips complete snapshots, receipt bytes, replacement conflicts, and v1 backups', async () => {
    const tx = await createTransaction(db, {
      date: '2026-11-05', amount: -12, currency: 'USD', user_id: 'u1', type: 'expense',
    }) as { id: string }
    sqlite.prepare('INSERT INTO chores (id,name,created_at) VALUES (?,?,?)').run('chore', 'Dishes', 'x')
    sqlite.prepare('INSERT INTO chore_completions VALUES (?,?,?,?,?,?)').run('done', 'chore', 'u1', 'x', '2026-11-05', 'x')
    sqlite.prepare('INSERT INTO exchange_rates VALUES (?,?,?,?)').run('EUR', 'USD', 1.1, '2026-11-05')
    sqlite.prepare(`INSERT INTO merchant_mappings VALUES (?,?,?,?,?,?,?)`).run('mapping', 'shop', null, null, 1, 'x', 'x')
    sqlite.prepare(`INSERT INTO recurring_patterns (id,merchant,type,"interval",average_amount,currency,last_occurrence,next_expected,confidence,status,category_id,account_id,transaction_ids,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('pattern', 'shop', 'expense', 'monthly', 12, 'USD', '2026-10-05', '2026-12-05', 1, 'detected', null, null, `["${tx.id}"]`, 'x', 'x')
    const imageData = Uint8Array.from({ length: 131_073 }, (_, index) => index % 256)
    sqlite.prepare(`INSERT INTO receipt_images (id,transaction_id,image_data,mime_type,file_size,created_at)
      VALUES (?,?,?, ?, ?, ?)`)
      .run('receipt', tx.id, imageData, 'image/jpeg', imageData.length, 'x')
    const backup = await exportJson(makeAdapter(sqlite, true))
    const second = new DatabaseSync(':memory:')
    second.exec('PRAGMA foreign_keys = ON')
    second.exec(SCHEMA_DDL)
    const other = makeAdapter(second)
    second.exec(`CREATE TABLE _palladium_seeds (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`)
    second.prepare('INSERT INTO _palladium_seeds VALUES (?,?)').run('sentinel', 'x')
    second.prepare('INSERT INTO applied_defaults VALUES (?)').run('sentinel')
    second.prepare(
      'INSERT INTO users (id,name,role,avatar_emoji,color,is_current,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run('u1', 'Conflicting local user', 'owner', 'X', '#000', 1, 'old')
    second.prepare(
      `INSERT INTO transactions (id,date,amount,currency,user_id,type,description,merchant,is_private,is_recurring,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(tx.id, '2020-01-01', -999, 'USD', 'u1', 'expense', 'conflict', '', 0, 0, 'old', 'old')
    await importJson(other, backup)
    const restored = await exportJson(other)
    expect(restored.users.find((user: { id: string; name: string }) => user.id === 'u1')?.name).toBe('Alex')
    expect(restored.transactions).toEqual(backup.transactions)
    expect(restored.chore_completions).toEqual(backup.chore_completions)
    expect(restored.exchange_rates).toEqual(backup.exchange_rates)
    expect(restored.receipt_images).toEqual(backup.receipt_images)
    expect(second.prepare('SELECT COUNT(*) AS count FROM users WHERE is_current = 1').get()).toMatchObject({ count: 1 })
    expect(second.prepare('SELECT key FROM _palladium_seeds').get()).toMatchObject({ key: 'sentinel' })
    expect(second.prepare('SELECT key FROM applied_defaults').get()).toMatchObject({ key: 'sentinel' })

    const priorTransactions = restored.transactions
    await expect(
      importJson(other, { ...backup, version: '1.0', receipt_images: [{}] } as HearthExport),
    ).rejects.toThrow()
    expect((await exportJson(other)).transactions).toEqual(priorTransactions)
    second.exec(`CREATE TRIGGER reject_restore BEFORE INSERT ON transactions
      BEGIN SELECT RAISE(ABORT, 'restore failed'); END`)
    await expect(importJson(other, backup)).rejects.toThrow(/restore failed/)
    second.exec('DROP TRIGGER reject_restore')
    expect((await exportJson(other)).transactions).toEqual(priorTransactions)
    await expect(importJson(other, { ...backup, users: [] })).rejects.toThrow(/current user/)
    expect((await exportJson(other)).transactions).toEqual(priorTransactions)
    await expect(
      importJson(other, {
        ...backup,
        transactions: backup.transactions.map((transaction) => ({
          ...transaction,
          account_id: 'missing-account',
        })),
      }),
    ).rejects.toThrow(/transaction account/)
    expect((await exportJson(other)).transactions).toEqual(priorTransactions)

    const legacy = { ...backup, version: '1.0' as const }
    delete (legacy as Partial<typeof legacy>).chore_completions
    delete (legacy as Partial<typeof legacy>).merchant_mappings
    delete (legacy as Partial<typeof legacy>).recurring_patterns
    delete (legacy as Partial<typeof legacy>).exchange_rates
    delete (legacy as Partial<typeof legacy>).receipt_images
    await importJson(other, legacy)
    expect(await other.queryAll('SELECT id FROM receipt_images')).toEqual([])
    expect(await other.queryAll('SELECT id FROM chore_completions')).toEqual([])
    second.close()
  })

  it('restores recurring decisions whose historical transactions were deleted', async () => {
    const transaction = await createTransaction(db, {
      date: '2026-11-05', amount: -12, currency: 'USD', user_id: 'u1', type: 'expense',
    }) as { id: string }
    const historicalIds = JSON.stringify([transaction.id])
    sqlite.prepare(`INSERT INTO recurring_patterns
      (id,merchant,type,"interval",average_amount,currency,last_occurrence,next_expected,
       confidence,status,category_id,account_id,transaction_ids,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'historical-pattern', 'shop', 'expense', 'monthly', 12, 'USD',
      '2026-11-05', '2026-12-05', 0.9, 'confirmed', null, null, historicalIds, 'x', 'x',
    )
    await deleteTransaction(db, { id: transaction.id })
    const snapshot = await exportJson(db)
    await importJson(db, snapshot)
    const restored = await exportJson(db)
    expect(restored.transactions).toEqual([])
    expect(restored.recurring_patterns).toEqual([
      expect.objectContaining({
        id: 'historical-pattern', status: 'confirmed', transaction_ids: historicalIds,
      }),
    ])
  })
})
