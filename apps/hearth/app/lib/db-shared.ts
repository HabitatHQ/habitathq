import { differenceInCalendarDays, localCalendarDate, parseDateString } from '@habitathq/utils'
import { BlobHandle, BlobRegistry, SqliteBlobAdapter } from '@palladium/core'

/**
 * Shared database operations for both web (WorkerDbAdapter) and native
 * (NativeDbAdapter) paths. Every function is async and receives a DbAdapter
 * so it can work with either sqlite-wasm (sync, wrapped) or
 * Capacitor SQLite (natively async).
 */

import { parseHearthExport } from '~/lib/hearth-export'
import { detectRecurringPatterns } from '~/lib/recurring/detect'
import type { DetectableTransaction, RecurringPattern } from '~/lib/recurring/types'
import { homeCurrencyAmountSql } from '~/lib/reports/amounts'
import { aggregateIouBalances } from '~/lib/worker-helpers'
import type { DbAdapter, HearthExport, WorkerRequestBody } from '~/types/database'

// ─── Local helpers ────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()
const currentPeriod = () => localCalendarDate().slice(0, 7)

/**
 * Coerce a value to a type SQLite bind() accepts.
 * Arrays and plain objects are JSON-serialised; booleans become 0/1;
 * undefined becomes null. Strings/numbers/bigint/null pass through.
 */
function toBindVal(v: unknown): string | number | bigint | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return v
  return JSON.stringify(v) // arrays, plain objects → JSON string
}

/**
 * Emulate selectValue: run a query, return the first column of the first row.
 */
async function queryValue<T = unknown>(
  db: DbAdapter,
  sql: string,
  bind?: unknown[],
): Promise<T | null> {
  const rows = await db.queryAll<Record<string, T>>(sql, bind)
  if (!rows[0]) return null
  const first = rows[0]
  const keys = Object.keys(first)
  if (keys.length === 0) return null
  return first[keys[0]!] ?? null
}

/**
 * Generic UPDATE helper — updates the given fields on a table row,
 * then returns the updated row.
 */
async function genericUpdate(
  db: DbAdapter,
  table: string,
  payload: { id: string; [key: string]: unknown },
): Promise<unknown> {
  const { id, ...fields } = payload
  const sets = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(', ')
  await db.exec(`UPDATE ${table} SET ${sets} WHERE id = ?`, [
    ...Object.values(fields).map(toBindVal),
    id,
  ])
  return db.queryOne(`SELECT * FROM ${table} WHERE id = ?`, [id])
}

/**
 * Compute spending for a single envelope in a given date range.
 */
async function computeEnvelopeSpending(
  db: DbAdapter,
  env: { id: string; budget_amount: number; category_ids: string; rollover: number },
  start: string,
  end: string,
  period: string,
  homeCurrency: string,
  useRollover: boolean,
): Promise<{
  spent: number
  rolled_over: number
  remaining: number
  percent_used: number
  is_overspent: boolean
  missing_conversion_count: number
}> {
  const catIds = JSON.parse(env.category_ids) as string[]
  let spent = 0
  let missingConversionCount = 0
  if (catIds.length > 0) {
    const placeholders = catIds.map(() => '?').join(',')
    const amount = homeCurrencyAmountSql('t')
    const result = await db.queryOne<{ spent: number; missing_conversion_count: number }>(
      `WITH RECURSIVE envelope_categories(id) AS (
         SELECT id FROM categories WHERE id IN (${placeholders})
         UNION
         SELECT child.id FROM categories child
         JOIN envelope_categories parent ON child.parent_id = parent.id
       )
       SELECT ABS(COALESCE(SUM(${amount}), 0)) AS spent,
              COALESCE(SUM(CASE WHEN ${amount} IS NULL THEN 1 ELSE 0 END), 0)
                AS missing_conversion_count
       FROM transactions t
       WHERE t.type = 'expense'
         AND t.category_id IN (SELECT id FROM envelope_categories)
         AND t.date BETWEEN ? AND ?`,
      [
        ...catIds,
        homeCurrency,
        homeCurrency,
        homeCurrency,
        homeCurrency,
        homeCurrency,
        homeCurrency,
        start,
        end,
      ],
    )
    spent = result?.spent ?? 0
    missingConversionCount = result?.missing_conversion_count ?? 0
  }

  let rolledOver = 0
  if (useRollover && env.rollover) {
    const prevPeriod = await db.queryOne<{ rolled_over: number }>(
      'SELECT rolled_over FROM envelope_periods WHERE envelope_id = ? AND period = ?',
      [env.id, period],
    )
    rolledOver = prevPeriod?.rolled_over ?? 0
  }

  const effectiveBudget = env.budget_amount + rolledOver
  const remaining = effectiveBudget - spent
  const percentUsed = effectiveBudget > 0 ? Math.min((spent / effectiveBudget) * 100, 200) : 0

  return {
    spent,
    rolled_over: rolledOver,
    remaining,
    percent_used: percentUsed,
    is_overspent: remaining < 0,
    missing_conversion_count: missingConversionCount,
  }
}

/**
 * Mark a list of transactions as recurring.
 */
async function markTransactionsRecurring(db: DbAdapter, txIds: string[]): Promise<void> {
  for (const txId of txIds) {
    await db.exec('UPDATE transactions SET is_recurring = 1 WHERE id = ?', [txId])
  }
}

/**
 * Compute period key for a chore's frequency.
 */
function chorePeriodKey(frequency: string, date: string): string {
  const d = parseDateString(date)
  if (frequency === 'daily') return date
  if (frequency === 'monthly') return date.slice(0, 7)
  // weekly: ISO week
  const jan4Key = `${d.getFullYear()}-01-04`
  const jan4 = parseDateString(jan4Key)
  const week = Math.ceil((differenceInCalendarDays(date, jan4Key) + jan4.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
}

const TRANSACTION_SELECT = `
  SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
         u.name as user_name, u.avatar_emoji as user_avatar, a.name as account_name
  FROM transactions t
  LEFT JOIN categories c ON t.category_id = c.id
  LEFT JOIN users u ON t.user_id = u.id
  LEFT JOIN accounts a ON t.account_id = a.id`

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUsers(db: DbAdapter) {
  return db.queryAll('SELECT * FROM users ORDER BY is_current DESC, created_at')
}

export async function getCurrentUser(db: DbAdapter) {
  return (await db.queryOne('SELECT * FROM users WHERE is_current = 1 LIMIT 1')) ?? null
}

export async function createUser(
  db: DbAdapter,
  p: {
    name: string
    email?: string | null
    role: string
    avatar_emoji: string
    color: string
    is_current: number
  },
) {
  const id = uuid()
  await db.exec('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)', [
    id,
    p.name,
    p.email ?? null,
    p.role,
    p.avatar_emoji,
    p.color,
    p.is_current,
    now(),
  ])
  return db.queryOne('SELECT * FROM users WHERE id = ?', [id])
}
export async function updateUser(db: DbAdapter, payload: { id: string; [key: string]: unknown }) {
  return genericUpdate(db, 'users', payload)
}

export async function deleteUser(db: DbAdapter, payload: { id: string }) {
  await db.exec('DELETE FROM users WHERE id = ?', [payload.id])
  return null
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

const ACCOUNT_TRANSACTION_AMOUNT = homeCurrencyAmountSql('t', 'a.currency')
const ACCOUNT_BALANCE_SELECT = `SELECT
  a.id, a.user_id, a.name, a.type,
  a.opening_balance
    + COALESCE((SELECT SUM(CASE WHEN t.type = 'transfer' THEN -ABS(${ACCOUNT_TRANSACTION_AMOUNT})
                                ELSE ${ACCOUNT_TRANSACTION_AMOUNT} END)
                FROM transactions t WHERE t.account_id = a.id), 0)
    + COALESCE((SELECT SUM(ABS(${ACCOUNT_TRANSACTION_AMOUNT})) FROM transactions t
                WHERE t.transfer_to_account_id = a.id AND t.type = 'transfer'), 0) AS balance,
  a.opening_balance, a.currency, a.color, a.icon, a.is_active, a.created_at,
  (SELECT COUNT(*) FROM transactions t
   WHERE (t.account_id = a.id OR (t.transfer_to_account_id = a.id AND t.type = 'transfer'))
     AND ${ACCOUNT_TRANSACTION_AMOUNT} IS NULL) AS missing_conversion_count
  FROM accounts a`

export async function getAccounts(db: DbAdapter) {
  return db.queryAll(`${ACCOUNT_BALANCE_SELECT} WHERE a.is_active = 1 ORDER BY a.created_at`)
}

export async function getAccountsForUser(db: DbAdapter, payload: { user_id: string }) {
  return db.queryAll(
    `${ACCOUNT_BALANCE_SELECT} WHERE a.user_id = ? AND a.is_active = 1 ORDER BY a.created_at`,
    [payload.user_id],
  )
}
function encodeBase64(input: Uint8Array | number[]): string {
  const bytes = Uint8Array.from(input)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export async function exportJson(db: DbAdapter): Promise<HearthExport> {
  const receipts = await db.queryAll<{
    id: string
    transaction_id: string
    image_data: Uint8Array | number[]
    mime_type: string
    file_size: number
    created_at: string
  }>('SELECT * FROM receipt_images')
  return {
    version: '2.0',
    exported_at: now(),
    users: await db.queryAll<HearthExport['users'][number]>('SELECT * FROM users'),
    accounts: await db.queryAll<HearthExport['accounts'][number]>(
      `${ACCOUNT_BALANCE_SELECT} ORDER BY a.created_at`,
    ),
    categories: await db.queryAll<HearthExport['categories'][number]>('SELECT * FROM categories'),
    transactions: await db.queryAll<HearthExport['transactions'][number]>(
      'SELECT * FROM transactions',
    ),
    envelopes: await db.queryAll<HearthExport['envelopes'][number]>('SELECT * FROM envelopes'),
    envelope_periods: await db.queryAll<HearthExport['envelope_periods'][number]>(
      'SELECT * FROM envelope_periods',
    ),
    iou_splits: await db.queryAll<HearthExport['iou_splits'][number]>(
      `SELECT s.*, t.currency FROM iou_splits s
       LEFT JOIN transactions t ON t.id = s.transaction_id`,
    ),
    savings_goals: await db.queryAll<HearthExport['savings_goals'][number]>(
      'SELECT * FROM savings_goals',
    ),
    chores: await db.queryAll<HearthExport['chores'][number]>('SELECT * FROM chores'),
    chore_completions: await db.queryAll<NonNullable<HearthExport['chore_completions']>[number]>(
      'SELECT * FROM chore_completions',
    ),
    merchant_mappings: await db.queryAll<NonNullable<HearthExport['merchant_mappings']>[number]>(
      'SELECT * FROM merchant_mappings',
    ),
    recurring_patterns: await db.queryAll<NonNullable<HearthExport['recurring_patterns']>[number]>(
      'SELECT * FROM recurring_patterns',
    ),
    exchange_rates: await db.queryAll<NonNullable<HearthExport['exchange_rates']>[number]>(
      'SELECT * FROM exchange_rates',
    ),
    receipt_images: receipts.map(({ image_data, ...metadata }) => ({
      ...metadata,
      image_data: encodeBase64(image_data),
    })),
  }
}

export async function reconcileAccount(
  db: DbAdapter,
  payload: { id: string; actual_balance: number },
) {
  if (!Number.isFinite(payload.actual_balance)) throw new Error('Actual balance must be finite')
  const result = await db.queryOne<{ balance: number; opening_balance: number }>(
    `${ACCOUNT_BALANCE_SELECT} WHERE a.id = ?`,
    [payload.id],
  )
  if (!result) throw new Error('Account not found')
  await db.exec('UPDATE accounts SET opening_balance = ? WHERE id = ?', [
    payload.actual_balance - (result.balance - result.opening_balance),
    payload.id,
  ])
  return db.queryOne(`${ACCOUNT_BALANCE_SELECT} WHERE a.id = ?`, [payload.id])
}

export async function createAccount(
  db: DbAdapter,
  p: {
    user_id: string
    name: string
    type: string
    balance: number
    opening_balance?: number
    currency: string
    color: string
    icon: string
  },
) {
  const id = uuid()
  await db.exec(
    `INSERT INTO accounts
      (id,user_id,name,type,balance,opening_balance,currency,color,icon,is_active,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      p.user_id,
      p.name,
      p.type,
      p.balance,
      p.opening_balance ?? p.balance,
      p.currency,
      p.color,
      p.icon,
      1,
      now(),
    ],
  )
  return db.queryOne(`${ACCOUNT_BALANCE_SELECT} WHERE a.id = ?`, [id])
}

export async function updateAccount(
  db: DbAdapter,
  payload: { id: string; [key: string]: unknown },
) {
  await genericUpdate(db, 'accounts', payload)
  return db.queryOne(`${ACCOUNT_BALANCE_SELECT} WHERE a.id = ?`, [payload.id])
}

export async function deleteAccount(db: DbAdapter, payload: { id: string }) {
  await db.exec('UPDATE accounts SET is_active = 0 WHERE id = ?', [payload.id])
  return null
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function getCategories(db: DbAdapter) {
  return db.queryAll('SELECT * FROM categories ORDER BY sort_order, name')
}

export async function getCategoryTree(db: DbAdapter) {
  const all = await db.queryAll<{
    id: string
    parent_id: string | null
    name: string
    icon: string
    color: string
    sort_order: number
  }>('SELECT * FROM categories ORDER BY sort_order, name')
  const parents = all.filter((c) => !c.parent_id)
  return parents.map((p) => ({
    ...p,
    children: all.filter((c) => c.parent_id === p.id),
  }))
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function getTransactions(db: DbAdapter, payload: { limit?: number; offset?: number }) {
  const limit = payload.limit ?? 50
  const offset = payload.offset ?? 0
  return db.queryAll(
    `${TRANSACTION_SELECT}
    ORDER BY t.date DESC, t.created_at DESC
    LIMIT ? OFFSET ?`,
    [limit, offset],
  )
}

export async function getTransactionsForPeriod(
  db: DbAdapter,
  payload: { period: string; user_id?: string; home_currency: string },
) {
  const { period, user_id, home_currency } = payload
  const start = `${period}-01`
  const end = `${period}-31`
  const amount = homeCurrencyAmountSql('t')
  const query = `${TRANSACTION_SELECT.replace(
    'SELECT t.*',
    `SELECT t.*, ${amount} AS report_amount`,
  )}
       WHERE t.date BETWEEN ? AND ?${user_id ? ' AND t.user_id = ?' : ''}
       ORDER BY t.date DESC, t.created_at DESC`
  return db.queryAll(query, [
    home_currency,
    home_currency,
    home_currency,
    start,
    end,
    ...(user_id ? [user_id] : []),
  ])
}

export async function getTransaction(db: DbAdapter, payload: { id: string }) {
  return (await db.queryOne(`${TRANSACTION_SELECT} WHERE t.id = ?`, [payload.id])) ?? null
}

export async function createTransaction(
  db: DbAdapter,
  p: {
    date: string
    amount: number
    currency?: string
    account_id?: string | null
    user_id?: string | null
    type: string
    category_id?: string | null
    description?: string
    merchant?: string
    is_private?: number
    is_recurring?: number
    transfer_to_account_id?: string | null
    split_id?: string | null
    source?: string
    home_amount?: number | null
    home_currency?: string | null
    exchange_rate?: number | null
    iou_split?: { to_user_id: string; amount: number }
  },
) {
  const currentUser = p.user_id
    ? null
    : await db.queryOne<{ id: string }>('SELECT id FROM users WHERE is_current = 1 LIMIT 1')
  const payerId = p.user_id ?? currentUser?.id
  if (p.iou_split) {
    if (p.type !== 'expense') throw new Error('IOU splits are only valid for expenses')
    if (
      !Number.isFinite(p.amount) ||
      !Number.isFinite(p.iou_split.amount) ||
      p.iou_split.amount <= 0 ||
      p.iou_split.amount > Math.abs(p.amount)
    ) {
      throw new Error('IOU share must be positive and no greater than the expense amount')
    }
    if (!payerId || !p.iou_split.to_user_id || p.iou_split.to_user_id === payerId) {
      throw new Error('IOU split requires a different valid household member')
    }
    if (!(await db.queryOne('SELECT id FROM users WHERE id = ?', [payerId]))) {
      throw new Error('IOU payer does not exist')
    }
    if (!(await db.queryOne('SELECT id FROM users WHERE id = ?', [p.iou_split.to_user_id]))) {
      throw new Error('IOU split member does not exist')
    }
  }

  const id = uuid()
  const ts = now()
  await db.exec('BEGIN')
  try {
    await db.exec(
      `INSERT INTO transactions
        (id, date, amount, currency, account_id, user_id, type, category_id,
         description, merchant, is_private, is_recurring, transfer_to_account_id,
         split_id, created_at, updated_at, source, home_amount, home_currency, exchange_rate)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        p.date,
        p.amount,
        p.currency ?? 'USD',
        p.account_id || null,
        payerId ?? null,
        p.type,
        p.category_id ?? null,
        p.description ?? '',
        p.merchant ?? '',
        p.is_private ?? 0,
        p.is_recurring ?? 0,
        p.transfer_to_account_id ?? null,
        p.split_id ?? null,
        ts,
        ts,
        p.source ?? 'manual',
        p.home_amount ?? null,
        p.home_currency ?? null,
        p.exchange_rate ?? null,
      ],
    )
    if (p.iou_split) {
      await createIouSplit(db, {
        transaction_id: id,
        from_user_id: payerId!,
        to_user_id: p.iou_split.to_user_id,
        amount: p.iou_split.amount,
      })
    }
    await db.exec('COMMIT')
    return db.queryOne('SELECT * FROM transactions WHERE id = ?', [id])
  } catch (error) {
    await db.exec('ROLLBACK')
    throw error
  }
}

export async function updateTransaction(
  db: DbAdapter,
  payload: { id: string; [key: string]: unknown },
) {
  return genericUpdate(db, 'transactions', { ...payload, updated_at: now() })
}

export async function deleteTransaction(db: DbAdapter, payload: { id: string }) {
  await db.exec('DELETE FROM transactions WHERE id = ?', [payload.id])
  return null
}

// ─── Envelopes ────────────────────────────────────────────────────────────────

export async function getEnvelopes(db: DbAdapter) {
  return db.queryAll('SELECT * FROM envelopes ORDER BY created_at')
}

export async function getEnvelopesWithSpending(
  db: DbAdapter,
  payload: { period: string; home_currency: string },
) {
  const { period, home_currency } = payload
  const start = `${period}-01`
  const end = `${period}-31`
  const envelopes = await db.queryAll<{
    id: string
    name: string
    icon: string
    color: string
    budget_amount: number
    period: string
    scope: string
    category_ids: string
    rollover: number
    created_at: string
  }>('SELECT * FROM envelopes ORDER BY created_at')
  const results = []
  for (const envelope of envelopes) {
    const spending = await computeEnvelopeSpending(
      db,
      envelope,
      start,
      end,
      period,
      home_currency,
      true,
    )
    results.push({ ...envelope, ...spending })
  }
  return results
}

export async function getEnvelopeWithSpending(
  db: DbAdapter,
  payload: { id: string; period: string; home_currency: string },
) {
  const { id, period, home_currency } = payload
  const env = await db.queryOne<{
    id: string
    budget_amount: number
    category_ids: string
    rollover: number
  }>('SELECT * FROM envelopes WHERE id = ?', [id])
  if (!env) return null
  const start = `${period}-01`
  const end = `${period}-31`
  return {
    ...env,
    ...(await computeEnvelopeSpending(db, env, start, end, period, home_currency, true)),
  }
}

export async function createEnvelope(
  db: DbAdapter,
  p: {
    name: string
    icon: string
    color: string
    budget_amount: number
    period?: string
    scope?: string
    category_ids?: string | string[]
    rollover?: number
  },
) {
  const id = uuid()
  await db.exec('INSERT INTO envelopes VALUES (?,?,?,?,?,?,?,?,?,?)', [
    id,
    p.name,
    p.icon,
    p.color,
    p.budget_amount,
    p.period ?? 'monthly',
    p.scope ?? 'personal',
    toBindVal(p.category_ids) ?? '[]',
    p.rollover ?? 1,
    now(),
  ])
  return db.queryOne('SELECT * FROM envelopes WHERE id = ?', [id])
}

export async function updateEnvelope(
  db: DbAdapter,
  payload: { id: string; [key: string]: unknown },
) {
  return genericUpdate(db, 'envelopes', payload)
}

export async function deleteEnvelope(db: DbAdapter, payload: { id: string }) {
  await db.exec('DELETE FROM envelopes WHERE id = ?', [payload.id])
  return null
}

// ─── Savings Goals ────────────────────────────────────────────────────────────

export async function getSavingsGoals(db: DbAdapter) {
  return db.queryAll('SELECT * FROM savings_goals ORDER BY created_at')
}

export async function createSavingsGoal(
  db: DbAdapter,
  p: {
    name: string
    icon: string
    color: string
    target_amount: number
    current_amount?: number
    target_date?: string | null
    scope?: string
  },
) {
  const id = uuid()
  await db.exec('INSERT INTO savings_goals VALUES (?,?,?,?,?,?,?,?,?)', [
    id,
    p.name,
    p.icon,
    p.color,
    p.target_amount,
    p.current_amount ?? 0,
    p.target_date ?? null,
    p.scope ?? 'personal',
    now(),
  ])
  return db.queryOne('SELECT * FROM savings_goals WHERE id = ?', [id])
}

export async function updateSavingsGoal(
  db: DbAdapter,
  payload: { id: string; [key: string]: unknown },
) {
  return genericUpdate(db, 'savings_goals', payload)
}

export async function deleteSavingsGoal(db: DbAdapter, payload: { id: string }) {
  await db.exec('DELETE FROM savings_goals WHERE id = ?', [payload.id])
  return null
}

// ─── IOU Splits ───────────────────────────────────────────────────────────────

export async function getIouSplits(db: DbAdapter) {
  return db.queryAll(
    `SELECT s.*, t.currency
     FROM iou_splits s LEFT JOIN transactions t ON t.id = s.transaction_id
     ORDER BY s.created_at DESC`,
  )
}

export async function getIouBalances(db: DbAdapter) {
  const splits = await db.queryAll<{
    from_user_id: string
    to_user_id: string
    amount: number
    currency: string | null
    from_name: string
    from_avatar: string
    to_name: string
    to_avatar: string
  }>(`
    SELECT s.from_user_id, s.to_user_id, s.amount, t.currency,
           uf.name as from_name, uf.avatar_emoji as from_avatar,
           ut.name as to_name, ut.avatar_emoji as to_avatar
    FROM iou_splits s
    LEFT JOIN transactions t ON s.transaction_id = t.id
    LEFT JOIN users uf ON s.from_user_id = uf.id
    LEFT JOIN users ut ON s.to_user_id = ut.id
    WHERE s.is_settled = 0
  `)

  return aggregateIouBalances(splits)
}

async function createIouSplit(
  db: DbAdapter,
  p: {
    transaction_id: string
    from_user_id: string
    to_user_id: string
    amount: number
  },
) {
  const id = uuid()
  await db.exec('INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)', [
    id,
    p.transaction_id,
    p.from_user_id,
    p.to_user_id,
    p.amount,
    0,
    null,
    now(),
  ])
  return db.queryOne('SELECT * FROM iou_splits WHERE id = ?', [id])
}

export async function settleIou(
  db: DbAdapter,
  payload: { from_user_id: string; to_user_id: string; currency: string },
) {
  const { from_user_id, to_user_id, currency } = payload
  await db.exec(
    `UPDATE iou_splits SET is_settled = 1, settled_at = ?
     WHERE is_settled = 0 AND transaction_id IN
       (SELECT id FROM transactions WHERE currency = ?) AND (
       (from_user_id = ? AND to_user_id = ?) OR
       (from_user_id = ? AND to_user_id = ?)
     )`,
    [now(), currency, from_user_id, to_user_id, to_user_id, from_user_id],
  )
  return null
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardSummary(
  db: DbAdapter,
  payload: { period: string; home_currency: string },
) {
  const period = payload.period || currentPeriod()
  const { home_currency } = payload
  const start = `${period}-01`
  const end = `${period}-31`
  const amount = homeCurrencyAmountSql('t')
  const totals = await db.queryOne<{
    spent: number
    income: number
    missing_conversion_count: number
  }>(
    `SELECT ABS(COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ${amount} ELSE 0 END), 0)) AS spent,
            COALESCE(SUM(CASE WHEN t.type = 'income' THEN ${amount} ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN ${amount} IS NULL THEN 1 ELSE 0 END), 0)
              AS missing_conversion_count
     FROM transactions t
     WHERE t.type IN ('expense', 'income') AND t.date BETWEEN ? AND ?`,
    [
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      start,
      end,
    ],
  )
  const spent = totals?.spent ?? 0
  const income = totals?.income ?? 0
  const envelopes = await db.queryAll<{
    id: string
    name: string
    icon: string
    color: string
    budget_amount: number
    period: string
    scope: string
    category_ids: string
    rollover: number
    created_at: string
  }>('SELECT * FROM envelopes ORDER BY created_at')
  const budgetTotal = envelopes.reduce((sum, envelope) => sum + envelope.budget_amount, 0)
  const envelopesWithSpending = []
  for (const envelope of envelopes) {
    const spending = await computeEnvelopeSpending(
      db,
      envelope,
      start,
      end,
      period,
      home_currency,
      true,
    )
    envelopesWithSpending.push({ ...envelope, ...spending })
  }
  const recentAmount = homeCurrencyAmountSql('t')
  const recentTxns = await db.queryAll(
    `${TRANSACTION_SELECT.replace('SELECT t.*', `SELECT t.*, ${recentAmount} AS report_amount`)}
     WHERE t.is_private = 0
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT 8`,
    [home_currency, home_currency, home_currency],
  )
  const goals = await db.queryAll('SELECT * FROM savings_goals ORDER BY created_at')
  const splits = await db.queryAll<{
    from_user_id: string
    to_user_id: string
    amount: number
    currency: string | null
    from_name: string
    from_avatar: string
    to_name: string
    to_avatar: string
  }>(`
    SELECT s.from_user_id, s.to_user_id, s.amount, t.currency,
           uf.name as from_name, uf.avatar_emoji as from_avatar,
           ut.name as to_name, ut.avatar_emoji as to_avatar
    FROM iou_splits s
    LEFT JOIN transactions t ON s.transaction_id = t.id
    LEFT JOIN users uf ON s.from_user_id = uf.id
    LEFT JOIN users ut ON s.to_user_id = ut.id
    WHERE s.is_settled = 0
  `)
  return {
    spent_this_month: spent,
    income_this_month: income,
    budget_total: budgetTotal,
    budget_remaining: budgetTotal - spent,
    missing_conversion_count: totals?.missing_conversion_count ?? 0,
    unresolved_iou_count: splits.filter((split) => split.currency === null).length,
    envelopes: envelopesWithSpending,
    recent_transactions: recentTxns,
    savings_goals: goals,
    iou_balances: aggregateIouBalances(splits),
  }
}

// ─── Chores ───────────────────────────────────────────────────────────────────

export async function getChoresWithStatus(db: DbAdapter, payload: { date: string }) {
  const { date } = payload
  const chores = await db.queryAll<{ id: string; frequency: string }>(
    'SELECT * FROM chores ORDER BY created_at',
  )
  const results = []
  for (const c of chores) {
    const pk = chorePeriodKey(c.frequency, date)
    const row = await db.queryOne<{
      completed_at: string | null
      is_done: number | null
      completed_by_name: string | null
      completed_by_avatar: string | null
      assigned_to_name: string | null
      assigned_to_avatar: string | null
    }>(
      `SELECT cc.completed_at, cc.id IS NOT NULL AS is_done,
              u_done.name AS completed_by_name, u_done.avatar_emoji AS completed_by_avatar,
              u_assigned.name AS assigned_to_name, u_assigned.avatar_emoji AS assigned_to_avatar
       FROM chores ch
       LEFT JOIN chore_completions cc ON cc.chore_id = ch.id AND cc.period_key = ?
       LEFT JOIN users u_done ON u_done.id = cc.user_id
       LEFT JOIN users u_assigned ON u_assigned.id = ch.assigned_to
       WHERE ch.id = ?`,
      [pk, c.id],
    )
    results.push({
      ...c,
      is_done: Boolean(row?.is_done),
      completed_at: row?.completed_at ?? null,
      completed_by_name: row?.completed_by_name ?? null,
      completed_by_avatar: row?.completed_by_avatar ?? null,
      assigned_to_name: row?.assigned_to_name ?? null,
      assigned_to_avatar: row?.assigned_to_avatar ?? null,
      period_key: pk,
    })
  }
  return results
}

export async function createChore(
  db: DbAdapter,
  p: {
    name: string
    icon: string
    color: string
    frequency: string
    scope: string
    assigned_to?: string | null
  },
) {
  const id = uuid()
  await db.exec('INSERT INTO chores VALUES (?,?,?,?,?,?,?,?)', [
    id,
    p.name,
    p.icon,
    p.color,
    p.frequency,
    p.scope,
    p.assigned_to ?? null,
    now(),
  ])
  return db.queryOne('SELECT * FROM chores WHERE id = ?', [id])
}

export async function updateChore(db: DbAdapter, payload: { id: string; [key: string]: unknown }) {
  return genericUpdate(db, 'chores', payload)
}

export async function deleteChore(db: DbAdapter, payload: { id: string }) {
  await db.exec('DELETE FROM chores WHERE id = ?', [payload.id])
  return null
}

export async function completeChore(
  db: DbAdapter,
  payload: { chore_id: string; user_id: string; date: string },
) {
  const { chore_id, user_id, date } = payload
  const chore = await db.queryOne<{ frequency: string }>(
    'SELECT frequency FROM chores WHERE id = ?',
    [chore_id],
  )
  if (!chore) throw new Error('Chore not found')
  const pk = chorePeriodKey(chore.frequency, date)
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO chore_completions (id,chore_id,user_id,completed_at,period_key,created_at)
     SELECT ?,?,?,?,?,?
     WHERE NOT EXISTS (
       SELECT 1 FROM chore_completions WHERE chore_id = ? AND period_key = ?
     )`,
    [id, chore_id, user_id, ts, pk, ts, chore_id, pk],
  )
  return null
}

export async function uncompleteChore(db: DbAdapter, payload: { chore_id: string; date: string }) {
  const { chore_id, date } = payload
  const chore = await db.queryOne<{ frequency: string }>(
    'SELECT frequency FROM chores WHERE id = ?',
    [chore_id],
  )
  if (!chore) throw new Error('Chore not found')
  const pk = chorePeriodKey(chore.frequency, date)
  await db.exec('DELETE FROM chore_completions WHERE chore_id = ? AND period_key = ?', [
    chore_id,
    pk,
  ])
  return null
}

// ─── Merchant Mappings ────────────────────────────────────────────────────────

export async function getMerchantMappings(db: DbAdapter) {
  return db.queryAll('SELECT * FROM merchant_mappings ORDER BY use_count DESC')
}

export async function getMerchantMapping(db: DbAdapter, payload: { merchant: string }) {
  const m = payload.merchant.toLowerCase().trim()
  return (await db.queryOne('SELECT * FROM merchant_mappings WHERE merchant = ?', [m])) ?? null
}

export async function upsertMerchantMapping(
  db: DbAdapter,
  payload: { merchant: string; category_id: string; account_id?: string | null },
) {
  const { merchant, category_id, account_id } = payload
  const normalized = merchant.toLowerCase().trim()
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO merchant_mappings (id, merchant, category_id, account_id, use_count, last_used_at, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(merchant) DO UPDATE SET
       category_id  = excluded.category_id,
       account_id   = excluded.account_id,
       use_count    = use_count + 1,
       last_used_at = excluded.last_used_at`,
    [id, normalized, category_id, account_id ?? null, ts, ts],
  )
  return db.queryOne('SELECT * FROM merchant_mappings WHERE merchant = ?', [normalized])
}

export async function getRecentAccountByType(db: DbAdapter, payload: { type: string }) {
  const { type } = payload
  return (
    (await db.queryOne(
      `SELECT account_id, COUNT(*) as cnt
       FROM transactions WHERE type = ?
       GROUP BY account_id ORDER BY cnt DESC LIMIT 1`,
      [type],
    )) ?? null
  )
}

// ─── Monthly Totals ───────────────────────────────────────────────────────────

export async function getMonthlyTotals(
  db: DbAdapter,
  payload: { months: number; home_currency: string },
) {
  const { months, home_currency } = payload
  const amount = homeCurrencyAmountSql('t')
  return db.queryAll(
    `SELECT strftime('%Y-%m', t.date) AS period,
            SUM(CASE WHEN t.type = 'expense' THEN ABS(${amount}) ELSE 0 END) AS expenses,
            SUM(CASE WHEN t.type = 'income' THEN ${amount} ELSE 0 END) AS income,
            SUM(CASE WHEN t.type IN ('expense', 'income') AND ${amount} IS NULL
                     THEN 1 ELSE 0 END) AS missing_conversion_count
     FROM transactions t
     WHERE t.date >= date('now', '-' || ? || ' months', 'start of month')
       AND t.type != 'transfer'
     GROUP BY period
     ORDER BY period`,
    [
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      home_currency,
      months,
    ],
  )
}

// ─── Recurring Patterns ───────────────────────────────────────────────────────

export async function detectRecurring(db: DbAdapter) {
  const allTxns = await db.queryAll<DetectableTransaction>(
    'SELECT id, date, amount, currency, type, merchant, category_id, account_id FROM transactions ORDER BY date',
  )

  const existingRows = await db.queryAll<{
    id: string
    merchant: string
    type: string
    interval: string
    average_amount: number
    currency: string | null
    last_occurrence: string
    next_expected: string
    confidence: number
    status: string
    category_id: string | null
    account_id: string | null
    transaction_ids: string
  }>('SELECT * FROM recurring_patterns')
  const existing: RecurringPattern[] = existingRows.map((row) => ({
    id: row.id,
    merchant: row.merchant,
    type: row.type as RecurringPattern['type'],
    interval: row.interval as RecurringPattern['interval'],
    averageAmount: row.average_amount,
    currency: row.currency,
    lastOccurrence: row.last_occurrence,
    nextExpected: row.next_expected,
    confidence: row.confidence,
    status: row.status as RecurringPattern['status'],
    categoryId: row.category_id,
    accountId: row.account_id,
    transactionIds: JSON.parse(row.transaction_ids),
  }))

  const detected = detectRecurringPatterns(allTxns, existing)
  const ts = now()
  for (const pattern of detected) {
    await db.exec(
      `INSERT INTO recurring_patterns (id, merchant, type, "interval", average_amount,currency,
        last_occurrence, next_expected, confidence, status, category_id, account_id, transaction_ids,
        created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        pattern.id,
        pattern.merchant,
        pattern.type,
        pattern.interval,
        pattern.averageAmount,
        pattern.currency,
        pattern.lastOccurrence,
        pattern.nextExpected,
        pattern.confidence,
        pattern.status,
        pattern.categoryId,
        pattern.accountId,
        JSON.stringify(pattern.transactionIds),
        ts,
        ts,
      ],
    )
  }
  return detected
}

export async function getRecurringPatterns(
  db: DbAdapter,
  payload: { status?: string; includeDismissed?: boolean },
) {
  const { status, includeDismissed } = payload
  let sql = 'SELECT * FROM recurring_patterns'
  const params: unknown[] = []
  if (status) {
    sql += ' WHERE status = ?'
    params.push(status)
  } else if (!includeDismissed) {
    sql += " WHERE status != 'dismissed'"
  }
  sql += ' ORDER BY next_expected ASC'
  return db.queryAll(sql, params.length ? params : undefined)
}

export async function updateRecurringPattern(
  db: DbAdapter,
  payload: { id: string; status: string },
) {
  const { id, status } = payload
  await db.exec('UPDATE recurring_patterns SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    now(),
    id,
  ])
  if (status === 'confirmed') {
    const row = await db.queryOne<{ transaction_ids: string }>(
      'SELECT transaction_ids FROM recurring_patterns WHERE id = ?',
      [id],
    )
    if (row) await markTransactionsRecurring(db, JSON.parse(row.transaction_ids) as string[])
  }
  return db.queryOne('SELECT * FROM recurring_patterns WHERE id = ?', [id])
}

export async function confirmAllRecurring(db: DbAdapter, payload: { minConfidence: number }) {
  const { minConfidence } = payload
  const rows = await db.queryAll<{ id: string; transaction_ids: string }>(
    "SELECT id, transaction_ids FROM recurring_patterns WHERE status = 'detected' AND confidence >= ?",
    [minConfidence],
  )
  const ts = now()
  for (const row of rows) {
    await db.exec(
      `UPDATE recurring_patterns SET status = 'confirmed', updated_at = ? WHERE id = ?`,
      [ts, row.id],
    )
    await markTransactionsRecurring(db, JSON.parse(row.transaction_ids) as string[])
  }
  return { updated: rows.length }
}

// ─── Receipt Images ───────────────────────────────────────────────────────────

export async function saveReceiptImage(
  db: DbAdapter,
  payload: { transaction_id: string; image_data: string; mime_type?: string },
) {
  const { transaction_id, image_data, mime_type } = payload
  const id = uuid()
  const blob = Uint8Array.from(atob(image_data), (c) => c.charCodeAt(0))
  const media = new BlobHandle(
    new SqliteBlobAdapter(db, {
      table: 'receipt_images',
      columns: { id: 'id', data: 'image_data' },
    }),
    new BlobRegistry(),
  )
  await db.exec('BEGIN')
  try {
    await db.exec(
      'INSERT INTO receipt_images (id, transaction_id, image_data, mime_type, file_size, created_at) VALUES (?,?,zeroblob(0),?,?,?)',
      [id, transaction_id, mime_type ?? 'image/jpeg', blob.length, now()],
    )
    await media.put(id, blob, { transaction: db })
    await db.exec('COMMIT')
  } catch (error) {
    await db.exec('ROLLBACK')
    throw error
  } finally {
    await media.dispose()
  }
  return { id, file_size: blob.length }
}

export async function getReceiptImage(db: DbAdapter, payload: { transaction_id: string }) {
  const { transaction_id } = payload
  return (
    (await db.queryOne(
      'SELECT id, transaction_id, mime_type, file_size, created_at FROM receipt_images WHERE transaction_id = ?',
      [transaction_id],
    )) ?? null
  )
}

export async function deleteReceiptImage(db: DbAdapter, payload: { transaction_id: string }) {
  const { transaction_id } = payload
  await db.exec('DELETE FROM receipt_images WHERE transaction_id = ?', [transaction_id])
  return null
}

// ─── Import Transactions ──────────────────────────────────────────────────────

export async function importTransactions(
  db: DbAdapter,
  payload: {
    transactions: Array<{
      date: string
      amount: number
      currency?: string
      account_id?: string | null
      user_id?: string | null
      type: string
      category_id?: string | null
      description?: string
      merchant?: string
      is_private?: number
      is_recurring?: number
      transfer_to_account_id?: string | null
      split_id?: string | null
      source?: string
      home_amount?: number | null
      home_currency?: string | null
      exchange_rate?: number | null
    }>
  },
) {
  const { transactions: txList } = payload
  const ts = now()
  let imported = 0
  await db.exec('BEGIN')
  try {
    for (const p of txList) {
      const id = uuid()
      await db.exec(
        `INSERT INTO transactions
          (id, date, amount, currency, account_id, user_id, type, category_id,
           description, merchant, is_private, is_recurring, transfer_to_account_id,
           split_id, created_at, updated_at, source, home_amount, home_currency, exchange_rate)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          p.date,
          p.amount,
          p.currency ?? 'USD',
          p.account_id ?? null,
          p.user_id ?? null,
          p.type,
          p.category_id ?? null,
          p.description ?? '',
          p.merchant ?? '',
          p.is_private ?? 0,
          p.is_recurring ?? 0,
          p.transfer_to_account_id ?? null,
          p.split_id ?? null,
          ts,
          ts,
          p.source ?? 'import',
          p.home_amount ?? null,
          p.home_currency ?? null,
          p.exchange_rate ?? null,
        ],
      )
      imported++
    }
    await db.exec('COMMIT')
  } catch (e) {
    await db.exec('ROLLBACK')
    throw e
  }
  return { imported }
}

// ─── Exchange Rates ───────────────────────────────────────────────────────────

export async function getExchangeRate(
  db: DbAdapter,
  payload: { base: string; target: string; date: string },
) {
  const { base, target, date } = payload
  return (
    (await db.queryOne('SELECT * FROM exchange_rates WHERE base = ? AND target = ? AND date = ?', [
      base,
      target,
      date,
    ])) ?? null
  )
}

export async function upsertExchangeRate(
  db: DbAdapter,
  payload: { base: string; target: string; rate: number; date: string },
) {
  const { base, target, rate, date } = payload
  await db.exec(
    `INSERT INTO exchange_rates (base, target, rate, date)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(base, target, date) DO UPDATE SET rate = excluded.rate`,
    [base, target, rate, date],
  )
  return { base, target, rate, date }
}

export async function importJson(db: DbAdapter, rawData: HearthExport): Promise<null> {
  const data = parseHearthExport(rawData)
  const users = data.users
  const accounts = data.accounts
  const categories = data.categories
  const transactions = data.transactions
  const envelopes = data.envelopes
  const periods = data.envelope_periods
  const splits = data.iou_splits
  const goals = data.savings_goals
  const chores = data.chores
  const completions = data.chore_completions ?? []
  const mappings = data.merchant_mappings ?? []
  const recurring = data.recurring_patterns ?? []
  const rates = data.exchange_rates ?? []
  const receipts = data.receipt_images ?? []

  const unique = (values: string[], name: string) => {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${name} in backup`)
  }
  unique(
    users.map((row) => row.id),
    'user id',
  )
  unique(
    accounts.map((row) => row.id),
    'account id',
  )
  unique(
    categories.map((row) => row.id),
    'category id',
  )
  unique(
    transactions.map((row) => row.id),
    'transaction id',
  )
  unique(
    envelopes.map((row) => row.id),
    'envelope id',
  )
  unique(
    periods.map((row) => row.id),
    'envelope period id',
  )
  unique(
    splits.map((row) => row.id),
    'IOU split id',
  )
  unique(
    goals.map((row) => row.id),
    'savings goal id',
  )
  unique(
    chores.map((row) => row.id),
    'chore id',
  )
  unique(
    completions.map((row) => row.id),
    'chore completion id',
  )
  unique(
    mappings.map((row) => row.id),
    'merchant mapping id',
  )
  unique(
    recurring.map((row) => row.id),
    'recurring pattern id',
  )
  unique(
    receipts.map((row) => row.id),
    'receipt id',
  )
  if (users.length === 0 || users.filter((row) => row.is_current === 1).length !== 1) {
    throw new Error('Backup must contain exactly one current user')
  }
  const userIds = new Set(users.map((row) => row.id))
  const accountIds = new Set(accounts.map((row) => row.id))
  const categoryIds = new Set(categories.map((row) => row.id))
  const transactionIds = new Set(transactions.map((row) => row.id))
  const envelopeIds = new Set(envelopes.map((row) => row.id))
  const choreIds = new Set(chores.map((row) => row.id))
  const references = (valid: boolean, description: string) => {
    if (!valid) throw new Error(`Backup has an invalid ${description} reference`)
  }
  for (const category of categories) {
    references(
      category.parent_id === null || categoryIds.has(category.parent_id),
      'category parent',
    )
    const seen = new Set([category.id])
    let parentId = category.parent_id
    while (parentId !== null) {
      references(!seen.has(parentId), 'category parent cycle')
      seen.add(parentId)
      parentId = categories.find((candidate) => candidate.id === parentId)?.parent_id ?? null
    }
  }
  for (const transaction of transactions) {
    references(transaction.user_id === null || userIds.has(transaction.user_id), 'transaction user')
    references(
      transaction.account_id === null || accountIds.has(transaction.account_id),
      'transaction account',
    )
    references(
      transaction.transfer_to_account_id === null ||
        accountIds.has(transaction.transfer_to_account_id),
      'transfer account',
    )
    references(
      transaction.category_id === null || categoryIds.has(transaction.category_id),
      'transaction category',
    )
  }
  const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]))
  for (const split of splits) {
    references(
      split.transaction_id === null || transactionIds.has(split.transaction_id),
      'IOU transaction',
    )
    references(userIds.has(split.from_user_id) && userIds.has(split.to_user_id), 'IOU user')
    references(split.from_user_id !== split.to_user_id && split.amount > 0, 'IOU split')
    if (split.transaction_id !== null) {
      const transaction = transactionsById.get(split.transaction_id)
      references(
        transaction?.type === 'expense' && split.amount <= Math.abs(transaction.amount),
        'IOU expense share',
      )
    }
  }
  for (const envelope of envelopes) {
    for (const categoryId of JSON.parse(envelope.category_ids) as string[]) {
      references(categoryIds.has(categoryId), 'envelope category')
    }
  }
  for (const period of periods) references(envelopeIds.has(period.envelope_id), 'envelope period')
  for (const chore of chores) {
    references(chore.assigned_to === null || userIds.has(chore.assigned_to), 'chore assignee')
  }
  for (const completion of completions) {
    references(
      choreIds.has(completion.chore_id) && userIds.has(completion.user_id),
      'chore completion',
    )
  }
  for (const mapping of mappings) {
    references(
      mapping.category_id === null || categoryIds.has(mapping.category_id),
      'merchant category',
    )
    references(
      mapping.account_id === null || accountIds.has(mapping.account_id),
      'merchant account',
    )
  }
  for (const pattern of recurring) {
    references(
      pattern.category_id === null || categoryIds.has(pattern.category_id),
      'recurring category',
    )
    references(
      pattern.account_id === null || accountIds.has(pattern.account_id),
      'recurring account',
    )
    // Detection evidence is historical and may reference transactions deleted since detection.
  }
  for (const receipt of receipts)
    references(transactionIds.has(receipt.transaction_id), 'receipt transaction')

  const receiptBytes = receipts.map((receipt) => {
    const bytes = Uint8Array.from(atob(receipt.image_data), (character) => character.charCodeAt(0))
    if (bytes.byteLength !== receipt.file_size)
      throw new Error(`Receipt ${receipt.id} size does not match`)
    return { receipt, bytes }
  })
  const media = new BlobHandle(
    new SqliteBlobAdapter(db, {
      table: 'receipt_images',
      columns: { id: 'id', data: 'image_data' },
    }),
    new BlobRegistry(),
  )
  await db.exec('BEGIN')
  try {
    await db.exec('DELETE FROM receipt_images')
    await db.exec('DELETE FROM chore_completions')
    await db.exec('DELETE FROM iou_splits')
    await db.exec('DELETE FROM envelope_periods')
    await db.exec('DELETE FROM recurring_patterns')
    await db.exec('DELETE FROM merchant_mappings')
    await db.exec('DELETE FROM transactions')
    await db.exec('DELETE FROM envelopes')
    await db.exec('DELETE FROM savings_goals')
    await db.exec('DELETE FROM chores')
    await db.exec('DELETE FROM accounts')
    await db.exec('DELETE FROM categories')
    await db.exec('DELETE FROM users')
    await db.exec('DELETE FROM exchange_rates')

    for (const user of users) {
      await db.exec(
        `INSERT INTO users (id,name,email,role,avatar_emoji,color,is_current,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          user.id,
          user.name,
          user.email,
          user.role,
          user.avatar_emoji,
          user.color,
          user.is_current,
          user.created_at,
        ],
      )
    }
    for (const category of categories) {
      await db.exec(
        'INSERT INTO categories (id,parent_id,name,icon,color,sort_order) VALUES (?,?,?,?,?,?)',
        [
          category.id,
          category.parent_id,
          category.name,
          category.icon,
          category.color,
          category.sort_order,
        ],
      )
    }
    const legacyAccountIds: string[] = []
    for (const account of accounts) {
      await db.exec(
        `INSERT INTO accounts
         (id,user_id,name,type,balance,opening_balance,currency,color,icon,is_active,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          account.id,
          account.user_id,
          account.name,
          account.type,
          account.balance,
          account.opening_balance ?? account.balance,
          account.currency,
          account.color,
          account.icon,
          account.is_active,
          account.created_at,
        ],
      )
      if (account.opening_balance === undefined) legacyAccountIds.push(account.id)
    }
    for (const transaction of transactions) {
      await db.exec(
        `INSERT INTO transactions
         (id,date,amount,currency,account_id,user_id,type,category_id,description,merchant,
          is_private,is_recurring,transfer_to_account_id,split_id,created_at,updated_at,source,
          home_amount,home_currency,exchange_rate)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          transaction.id,
          transaction.date,
          transaction.amount,
          transaction.currency,
          transaction.account_id,
          transaction.user_id,
          transaction.type,
          transaction.category_id,
          transaction.description,
          transaction.merchant,
          transaction.is_private,
          transaction.is_recurring,
          transaction.transfer_to_account_id,
          transaction.split_id,
          transaction.created_at,
          transaction.updated_at,
          transaction.source ?? 'manual',
          transaction.home_amount ?? null,
          transaction.home_currency ?? null,
          transaction.exchange_rate ?? null,
        ],
      )
    }
    for (const envelope of envelopes) {
      await db.exec(
        `INSERT INTO envelopes (id,name,icon,color,budget_amount,period,scope,category_ids,rollover,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          envelope.id,
          envelope.name,
          envelope.icon,
          envelope.color,
          envelope.budget_amount,
          envelope.period,
          envelope.scope,
          envelope.category_ids,
          envelope.rollover,
          envelope.created_at,
        ],
      )
    }
    for (const period of periods) {
      await db.exec(
        'INSERT INTO envelope_periods (id,envelope_id,period,spent,rolled_over) VALUES (?,?,?,?,?)',
        [period.id, period.envelope_id, period.period, period.spent, period.rolled_over],
      )
    }
    for (const split of splits) {
      await db.exec(
        `INSERT INTO iou_splits (id,transaction_id,from_user_id,to_user_id,amount,is_settled,settled_at,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          split.id,
          split.transaction_id,
          split.from_user_id,
          split.to_user_id,
          split.amount,
          split.is_settled,
          split.settled_at,
          split.created_at,
        ],
      )
    }
    for (const goal of goals) {
      await db.exec(
        `INSERT INTO savings_goals (id,name,icon,color,target_amount,current_amount,target_date,scope,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          goal.id,
          goal.name,
          goal.icon,
          goal.color,
          goal.target_amount,
          goal.current_amount,
          goal.target_date,
          goal.scope,
          goal.created_at,
        ],
      )
    }
    for (const chore of chores) {
      await db.exec(
        'INSERT INTO chores (id,name,icon,color,frequency,scope,assigned_to,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [
          chore.id,
          chore.name,
          chore.icon,
          chore.color,
          chore.frequency,
          chore.scope,
          chore.assigned_to,
          chore.created_at,
        ],
      )
    }
    for (const completion of completions) {
      await db.exec(
        `INSERT INTO chore_completions (id,chore_id,user_id,completed_at,period_key,created_at)
         VALUES (?,?,?,?,?,?)`,
        [
          completion.id,
          completion.chore_id,
          completion.user_id,
          completion.completed_at,
          completion.period_key,
          completion.created_at,
        ],
      )
    }
    for (const mapping of mappings) {
      await db.exec(
        `INSERT INTO merchant_mappings (id,merchant,category_id,account_id,use_count,last_used_at,created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [
          mapping.id,
          mapping.merchant,
          mapping.category_id,
          mapping.account_id,
          mapping.use_count,
          mapping.last_used_at,
          mapping.created_at,
        ],
      )
    }
    for (const pattern of recurring) {
      await db.exec(
        `INSERT INTO recurring_patterns
         (id,merchant,type,"interval",average_amount,currency,last_occurrence,next_expected,confidence,
          status,category_id,account_id,transaction_ids,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          pattern.id,
          pattern.merchant,
          pattern.type,
          pattern.interval,
          pattern.average_amount,
          pattern.currency ?? null,
          pattern.last_occurrence,
          pattern.next_expected,
          pattern.confidence,
          pattern.status,
          pattern.category_id,
          pattern.account_id,
          pattern.transaction_ids,
          pattern.created_at,
          pattern.updated_at,
        ],
      )
    }
    for (const rate of rates) {
      await db.exec('INSERT INTO exchange_rates (base,target,rate,date) VALUES (?,?,?,?)', [
        rate.base,
        rate.target,
        rate.rate,
        rate.date,
      ])
    }
    for (const { receipt, bytes } of receiptBytes) {
      await db.exec(
        `INSERT INTO receipt_images (id,transaction_id,image_data,mime_type,file_size,created_at)
         VALUES (?,?,zeroblob(0),?,?,?)`,
        [
          receipt.id,
          receipt.transaction_id,
          receipt.mime_type,
          receipt.file_size,
          receipt.created_at,
        ],
      )
      await media.put(receipt.id, bytes, { transaction: db })
    }
    for (const accountId of legacyAccountIds) {
      const amount = homeCurrencyAmountSql('t', 'a.currency')
      const impact = await db.queryOne<{ amount: number }>(
        `SELECT COALESCE((SELECT SUM(CASE WHEN t.type = 'transfer' THEN -ABS(${amount})
                                         ELSE ${amount} END)
                          FROM transactions t WHERE t.account_id = a.id), 0)
           + COALESCE((SELECT SUM(ABS(${amount})) FROM transactions t
                       WHERE t.transfer_to_account_id = a.id AND t.type = 'transfer'), 0) AS amount
         FROM accounts a WHERE a.id = ?`,
        [accountId],
      )
      const account = accounts.find(({ id }) => id === accountId)
      if (account) {
        await db.exec('UPDATE accounts SET opening_balance = ? WHERE id = ?', [
          account.balance - (impact?.amount ?? 0),
          accountId,
        ])
      }
    }
    await db.exec('COMMIT')
    return null
  } catch (error) {
    await db.exec('ROLLBACK')
    throw error
  } finally {
    await media.dispose()
  }
}

export async function getCurrencyBreakdown(db: DbAdapter, payload: { period: string }) {
  const start = `${payload.period}-01`
  const end = `${payload.period}-31`
  return db.queryAll(
    `SELECT currency,
            SUM(CASE WHEN type = 'expense' THEN ABS(amount) ELSE 0 END) AS expenses,
            SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
            COUNT(*) AS tx_count
     FROM transactions
     WHERE date BETWEEN ? AND ? AND type != 'transfer'
     GROUP BY currency
     ORDER BY expenses DESC`,
    [start, end],
  )
}

export async function getDbInfo(db: DbAdapter) {
  const txCount = (await queryValue<number>(db, 'SELECT COUNT(*) FROM transactions')) ?? 0
  const userCount = (await queryValue<number>(db, 'SELECT COUNT(*) FROM users')) ?? 0
  const accountCount = (await queryValue<number>(db, 'SELECT COUNT(*) FROM accounts')) ?? 0
  const envCount = (await queryValue<number>(db, 'SELECT COUNT(*) FROM envelopes')) ?? 0
  return {
    size_bytes: 0,
    transaction_count: txCount,
    user_count: userCount,
    account_count: accountCount,
    envelope_count: envCount,
  }
}

// ─── Dispatch router ──────────────────────────────────────────────────────────

export async function dispatch(db: DbAdapter, req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    // Users
    case 'GET_USERS':
      return getUsers(db)
    case 'GET_CURRENT_USER':
      return getCurrentUser(db)
    case 'CREATE_USER':
      return createUser(db, req.payload)
    case 'UPDATE_USER':
      return updateUser(db, req.payload)
    case 'DELETE_USER':
      return deleteUser(db, req.payload)

    // Accounts
    case 'GET_ACCOUNTS':
    case 'GET_ACCOUNTS_WITH_BALANCES':
      return getAccounts(db)
    case 'GET_ACCOUNTS_FOR_USER':
      return getAccountsForUser(db, req.payload)
    case 'CREATE_ACCOUNT':
      return createAccount(db, req.payload)
    case 'UPDATE_ACCOUNT':
      return updateAccount(db, req.payload)
    case 'RECONCILE_ACCOUNT':
      return reconcileAccount(db, req.payload)
    case 'DELETE_ACCOUNT':
      return deleteAccount(db, req.payload)

    // Categories
    case 'GET_CATEGORIES':
      return getCategories(db)
    case 'GET_CATEGORY_TREE':
      return getCategoryTree(db)

    // Transactions
    case 'GET_TRANSACTIONS':
      return getTransactions(db, req.payload)
    case 'GET_TRANSACTIONS_FOR_PERIOD':
      return getTransactionsForPeriod(db, req.payload)
    case 'GET_TRANSACTION':
      return getTransaction(db, req.payload)
    case 'CREATE_TRANSACTION':
      return createTransaction(db, req.payload)
    case 'UPDATE_TRANSACTION':
      return updateTransaction(db, req.payload)
    case 'DELETE_TRANSACTION':
      return deleteTransaction(db, req.payload)

    // Envelopes
    case 'GET_ENVELOPES':
      return getEnvelopes(db)
    case 'GET_ENVELOPES_WITH_SPENDING':
      return getEnvelopesWithSpending(db, req.payload)
    case 'GET_ENVELOPE_WITH_SPENDING':
      return getEnvelopeWithSpending(db, req.payload)
    case 'CREATE_ENVELOPE':
      return createEnvelope(db, req.payload)
    case 'UPDATE_ENVELOPE':
      return updateEnvelope(db, req.payload)
    case 'DELETE_ENVELOPE':
      return deleteEnvelope(db, req.payload)

    // Savings Goals
    case 'GET_SAVINGS_GOALS':
      return getSavingsGoals(db)
    case 'CREATE_SAVINGS_GOAL':
      return createSavingsGoal(db, req.payload)
    case 'UPDATE_SAVINGS_GOAL':
      return updateSavingsGoal(db, req.payload)
    case 'DELETE_SAVINGS_GOAL':
      return deleteSavingsGoal(db, req.payload)

    // IOU Splits
    case 'GET_IOU_SPLITS':
      return getIouSplits(db)
    case 'GET_IOU_BALANCES':
      return getIouBalances(db)
    case 'SETTLE_IOU':
      return settleIou(db, req.payload)

    // Dashboard
    case 'GET_DASHBOARD_SUMMARY':
      return getDashboardSummary(db, req.payload)

    // Chores
    case 'GET_CHORES_WITH_STATUS':
      return getChoresWithStatus(db, req.payload)
    case 'CREATE_CHORE':
      return createChore(db, req.payload)
    case 'UPDATE_CHORE':
      return updateChore(db, req.payload)
    case 'DELETE_CHORE':
      return deleteChore(db, req.payload)
    case 'COMPLETE_CHORE':
      return completeChore(db, req.payload)
    case 'UNCOMPLETE_CHORE':
      return uncompleteChore(db, req.payload)

    // Merchant Mappings
    case 'GET_MERCHANT_MAPPINGS':
      return getMerchantMappings(db)
    case 'GET_MERCHANT_MAPPING':
      return getMerchantMapping(db, req.payload)
    case 'UPSERT_MERCHANT_MAPPING':
      return upsertMerchantMapping(db, req.payload)
    case 'GET_RECENT_ACCOUNT_BY_TYPE':
      return getRecentAccountByType(db, req.payload)

    // Monthly Totals
    case 'GET_MONTHLY_TOTALS':
      return getMonthlyTotals(db, req.payload)

    // Recurring
    case 'DETECT_RECURRING':
      return detectRecurring(db)
    case 'GET_RECURRING_PATTERNS':
      return getRecurringPatterns(db, req.payload)
    case 'UPDATE_RECURRING_PATTERN':
      return updateRecurringPattern(db, req.payload)
    case 'CONFIRM_ALL_RECURRING':
      return confirmAllRecurring(db, req.payload)

    // Receipt Images
    case 'SAVE_RECEIPT_IMAGE':
      return saveReceiptImage(db, req.payload)
    case 'GET_RECEIPT_IMAGE':
      return getReceiptImage(db, req.payload)
    case 'DELETE_RECEIPT_IMAGE':
      return deleteReceiptImage(db, req.payload)

    // Import
    case 'IMPORT_TRANSACTIONS':
      return importTransactions(db, req.payload)
    case 'IMPORT_JSON':
      return importJson(db, req.payload)

    // Exchange Rates
    case 'GET_EXCHANGE_RATE':
      return getExchangeRate(db, req.payload)
    case 'UPSERT_EXCHANGE_RATE':
      return upsertExchangeRate(db, req.payload)
    case 'GET_CURRENCY_BREAKDOWN':
      return getCurrencyBreakdown(db, req.payload)

    // Utilities
    case 'GET_DB_INFO':
      return getDbInfo(db)

    // These are handled directly by the worker/native layer:
    // EXPORT_DB, EXPORT_JSON, RESET_DATABASE
    default:
      throw new Error(`Unknown request type: ${(req as WorkerRequestBody).type}`)
  }
}
