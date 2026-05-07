/**
 * Shared database operations for both web (WorkerDbAdapter) and native
 * (NativeDbAdapter) paths. Every function is async and receives a DbAdapter
 * so it can work with either sqlite-wasm (sync, wrapped) or
 * Capacitor SQLite (natively async).
 */

import { detectRecurringPatterns } from '~/lib/recurring/detect'
import type { DetectableTransaction, RecurringPattern } from '~/lib/recurring/types'
import { aggregateIouBalances } from '~/lib/worker-helpers'
import type { DbAdapter, HearthExport, WorkerRequestBody } from '~/types/database'

// ─── Local helpers ────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()
const currentPeriod = () => new Date().toISOString().slice(0, 7)

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
  useRollover: boolean,
): Promise<{
  spent: number
  rolled_over: number
  remaining: number
  percent_used: number
  is_overspent: boolean
}> {
  const catIds = JSON.parse(env.category_ids) as string[]
  if (catIds.length === 0) {
    return {
      spent: 0,
      rolled_over: 0,
      remaining: env.budget_amount,
      percent_used: 0,
      is_overspent: false,
    }
  }
  const placeholders = catIds.map(() => '?').join(',')
  const spent =
    (await queryValue<number>(
      db,
      `SELECT ABS(COALESCE(SUM(COALESCE(home_amount, amount)), 0)) FROM transactions
       WHERE type = 'expense' AND category_id IN (${placeholders})
       AND date BETWEEN ? AND ?`,
      [...catIds.map(toBindVal), start, end],
    )) ?? 0

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
  const d = new Date(date)
  if (frequency === 'daily') return date.slice(0, 10)
  if (frequency === 'monthly') return date.slice(0, 7)
  // weekly: ISO week
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7)
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

export async function getAccounts(db: DbAdapter) {
  return db.queryAll('SELECT * FROM accounts WHERE is_active = 1 ORDER BY created_at')
}

export async function getAccountsForUser(db: DbAdapter, payload: { user_id: string }) {
  return db.queryAll(
    'SELECT * FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at',
    [payload.user_id],
  )
}

export async function createAccount(
  db: DbAdapter,
  p: {
    user_id: string
    name: string
    type: string
    balance: number
    currency: string
    color: string
    icon: string
  },
) {
  const id = uuid()
  await db.exec('INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?,?)', [
    id,
    p.user_id,
    p.name,
    p.type,
    p.balance,
    p.currency,
    p.color,
    p.icon,
    1,
    now(),
  ])
  return db.queryOne('SELECT * FROM accounts WHERE id = ?', [id])
}

export async function updateAccount(
  db: DbAdapter,
  payload: { id: string; [key: string]: unknown },
) {
  return genericUpdate(db, 'accounts', payload)
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
  payload: { period: string; user_id?: string },
) {
  const { period, user_id } = payload
  const start = `${period}-01`
  const end = `${period}-31`
  if (user_id) {
    return db.queryAll(
      `${TRANSACTION_SELECT}
       WHERE t.date BETWEEN ? AND ? AND t.user_id = ?
       ORDER BY t.date DESC, t.created_at DESC`,
      [start, end, user_id],
    )
  }
  return db.queryAll(
    `${TRANSACTION_SELECT}
     WHERE t.date BETWEEN ? AND ?
     ORDER BY t.date DESC, t.created_at DESC`,
    [start, end],
  )
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
    exchange_rate?: number | null
  },
) {
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO transactions
      (id, date, amount, currency, account_id, user_id, type, category_id,
       description, merchant, is_private, is_recurring, transfer_to_account_id,
       split_id, created_at, updated_at, source, home_amount, exchange_rate)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      p.date,
      p.amount,
      p.currency ?? 'USD',
      p.account_id || null,
      p.user_id || null,
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
      p.exchange_rate ?? null,
    ],
  )
  return db.queryOne('SELECT * FROM transactions WHERE id = ?', [id])
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

export async function getEnvelopesWithSpending(db: DbAdapter, payload: { period: string }) {
  const period = payload.period
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
  for (const env of envelopes) {
    const spending = await computeEnvelopeSpending(db, env, start, end, period, true)
    results.push({ ...env, ...spending })
  }
  return results
}

export async function getEnvelopeWithSpending(
  db: DbAdapter,
  payload: { id: string; period: string },
) {
  const { id, period } = payload
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
    ...(await computeEnvelopeSpending(db, env, start, end, period, true)),
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
  return db.queryAll('SELECT * FROM iou_splits ORDER BY created_at DESC')
}

export async function getIouBalances(db: DbAdapter) {
  const splits = await db.queryAll<{
    from_user_id: string
    to_user_id: string
    amount: number
    from_name: string
    from_avatar: string
    to_name: string
    to_avatar: string
  }>(`
    SELECT s.*, uf.name as from_name, uf.avatar_emoji as from_avatar,
           ut.name as to_name, ut.avatar_emoji as to_avatar
    FROM iou_splits s
    LEFT JOIN users uf ON s.from_user_id = uf.id
    LEFT JOIN users ut ON s.to_user_id = ut.id
    WHERE s.is_settled = 0
  `)

  return aggregateIouBalances(splits)
}

export async function createIouSplit(
  db: DbAdapter,
  p: {
    transaction_id?: string | null
    from_user_id: string
    to_user_id: string
    amount: number
  },
) {
  const id = uuid()
  await db.exec('INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)', [
    id,
    p.transaction_id ?? null,
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
  payload: { from_user_id: string; to_user_id: string },
) {
  const { from_user_id, to_user_id } = payload
  await db.exec(
    `UPDATE iou_splits SET is_settled = 1, settled_at = ?
     WHERE is_settled = 0 AND (
       (from_user_id = ? AND to_user_id = ?) OR
       (from_user_id = ? AND to_user_id = ?)
     )`,
    [now(), from_user_id, to_user_id, to_user_id, from_user_id],
  )
  return null
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardSummary(db: DbAdapter, payload: { period: string }) {
  const period = payload.period || currentPeriod()
  const start = `${period}-01`
  const end = `${period}-31`

  const spent =
    (await queryValue<number>(
      db,
      `SELECT ABS(COALESCE(SUM(COALESCE(home_amount, amount)), 0)) FROM transactions
     WHERE type = 'expense' AND date BETWEEN ? AND ?`,
      [start, end],
    )) ?? 0

  const income =
    (await queryValue<number>(
      db,
      `SELECT COALESCE(SUM(COALESCE(home_amount, amount)), 0) FROM transactions
     WHERE type = 'income' AND date BETWEEN ? AND ?`,
      [start, end],
    )) ?? 0

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

  const budgetTotal = envelopes.reduce((sum, e) => sum + e.budget_amount, 0)

  const envelopesWithSpending = []
  for (const env of envelopes) {
    const spending = await computeEnvelopeSpending(db, env, start, end, period, true)
    envelopesWithSpending.push({ ...env, ...spending })
  }

  const budgetRemaining = budgetTotal - spent

  const recentTxns = await db.queryAll(
    `${TRANSACTION_SELECT}
    WHERE t.is_private = 0
    ORDER BY t.date DESC, t.created_at DESC
    LIMIT 8`,
  )

  const goals = await db.queryAll('SELECT * FROM savings_goals ORDER BY created_at')

  const splits = await db.queryAll<{
    from_user_id: string
    to_user_id: string
    amount: number
    from_name: string
    from_avatar: string
    to_name: string
    to_avatar: string
  }>(`
    SELECT s.*, uf.name as from_name, uf.avatar_emoji as from_avatar,
           ut.name as to_name, ut.avatar_emoji as to_avatar
    FROM iou_splits s
    LEFT JOIN users uf ON s.from_user_id = uf.id
    LEFT JOIN users ut ON s.to_user_id = ut.id
    WHERE s.is_settled = 0
  `)

  return {
    spent_this_month: spent,
    income_this_month: income,
    budget_total: budgetTotal,
    budget_remaining: budgetRemaining,
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
  await db.exec('INSERT OR IGNORE INTO chore_completions VALUES (?,?,?,?,?,?)', [
    id,
    chore_id,
    user_id,
    ts,
    pk,
    ts,
  ])
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

export async function getMonthlyTotals(db: DbAdapter, payload: { months: number }) {
  const { months } = payload
  return db.queryAll(
    `SELECT
       strftime('%Y-%m', date) AS period,
       SUM(CASE WHEN type = 'expense' THEN ABS(COALESCE(home_amount, amount)) ELSE 0 END) AS expenses,
       SUM(CASE WHEN type = 'income' THEN COALESCE(home_amount, amount) ELSE 0 END) AS income
     FROM transactions
     WHERE date >= date('now', '-' || ? || ' months', 'start of month')
       AND type != 'transfer'
     GROUP BY period
     ORDER BY period`,
    [months],
  )
}

// ─── Recurring Patterns ───────────────────────────────────────────────────────

export async function detectRecurring(db: DbAdapter) {
  const allTxns = (await db.queryAll(
    'SELECT id, date, amount, type, merchant, category_id, account_id FROM transactions ORDER BY date',
  )) as unknown as DetectableTransaction[]

  const existingRows = await db.queryAll<{
    id: string
    merchant: string
    type: string
    interval: string
    average_amount: number
    last_occurrence: string
    next_expected: string
    confidence: number
    status: string
    category_id: string | null
    account_id: string | null
    transaction_ids: string
  }>('SELECT * FROM recurring_patterns')

  const existing: RecurringPattern[] = existingRows.map((r) => ({
    id: r.id,
    merchant: r.merchant,
    type: r.type as RecurringPattern['type'],
    interval: r.interval as RecurringPattern['interval'],
    averageAmount: r.average_amount,
    lastOccurrence: r.last_occurrence,
    nextExpected: r.next_expected,
    confidence: r.confidence,
    status: r.status as RecurringPattern['status'],
    categoryId: r.category_id,
    accountId: r.account_id,
    transactionIds: JSON.parse(r.transaction_ids),
  }))

  const detected = detectRecurringPatterns(allTxns, existing)
  const ts = now()

  for (const p of detected) {
    await db.exec(
      `INSERT INTO recurring_patterns (id, merchant, type, "interval", average_amount,
        last_occurrence, next_expected, confidence, status, category_id, account_id,
        transaction_ids, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        p.id,
        p.merchant,
        p.type,
        p.interval,
        p.averageAmount,
        p.lastOccurrence,
        p.nextExpected,
        p.confidence,
        p.status,
        p.categoryId,
        p.accountId,
        JSON.stringify(p.transactionIds),
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
  await db.exec(
    'INSERT INTO receipt_images (id, transaction_id, image_data, mime_type, file_size, created_at) VALUES (?,?,?,?,?,?)',
    [id, transaction_id, blob, mime_type ?? 'image/jpeg', blob.length, now()],
  )
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
           split_id, created_at, updated_at, source, home_amount, exchange_rate)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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

export async function getCurrencyBreakdown(db: DbAdapter, payload: { period: string }) {
  const period = payload.period
  const start = `${period}-01`
  const end = `${period}-31`
  return db.queryAll(
    `SELECT currency,
            SUM(CASE WHEN type = 'expense' THEN ABS(COALESCE(home_amount, amount)) ELSE 0 END) AS expenses,
            SUM(CASE WHEN type = 'income' THEN COALESCE(home_amount, amount) ELSE 0 END) AS income,
            COUNT(*) AS tx_count
     FROM transactions
     WHERE date BETWEEN ? AND ? AND type != 'transfer'
     GROUP BY currency
     ORDER BY expenses DESC`,
    [start, end],
  )
}

// ─── Utilities ────────────────────────────────────────────────────────────────

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

// ─── Import / restore from JSON ──────────────────────────────────────────────

/**
 * Restore a previously exported JSON snapshot into the local database.
 *
 * Tables are populated in FK-safe order (parent rows before children).
 * Every insert is `INSERT OR IGNORE`, so re-importing the same snapshot is a
 * no-op. Wrapped in a transaction; on error everything rolls back.
 */
export async function importJson(db: DbAdapter, data: HearthExport): Promise<null> {
  if (data.version !== '1.0')
    throw new Error(`Unsupported export version: ${String((data as { version: unknown }).version)}`)

  await db.exec('BEGIN')
  try {
    for (const u of data.users ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO users
         (id,name,email,role,avatar_emoji,color,is_current,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          u.id,
          u.name,
          u.email ?? null,
          u.role,
          u.avatar_emoji,
          u.color,
          u.is_current,
          u.created_at,
        ],
      )
    }
    for (const a of data.accounts ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO accounts
         (id,user_id,name,type,balance,currency,color,icon,is_active,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          a.id,
          a.user_id,
          a.name,
          a.type,
          a.balance,
          a.currency,
          a.color,
          a.icon,
          a.is_active,
          a.created_at,
        ],
      )
    }
    for (const c of data.categories ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO categories
         (id,parent_id,name,icon,color,sort_order)
         VALUES (?,?,?,?,?,?)`,
        [c.id, c.parent_id ?? null, c.name, c.icon, c.color, c.sort_order],
      )
    }
    for (const t of data.transactions ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO transactions
         (id,date,amount,currency,account_id,user_id,type,category_id,description,merchant,
          is_private,is_recurring,transfer_to_account_id,split_id,created_at,updated_at,
          source,home_amount,exchange_rate)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          t.id,
          t.date,
          t.amount,
          t.currency,
          t.account_id ?? null,
          t.user_id ?? null,
          t.type,
          t.category_id ?? null,
          t.description,
          t.merchant,
          t.is_private,
          t.is_recurring,
          t.transfer_to_account_id ?? null,
          t.split_id ?? null,
          t.created_at,
          t.updated_at,
          t.source ?? 'manual',
          t.home_amount ?? null,
          t.exchange_rate ?? null,
        ],
      )
    }
    for (const e of data.envelopes ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO envelopes
         (id,name,icon,color,budget_amount,period,scope,category_ids,rollover,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          e.id,
          e.name,
          e.icon,
          e.color,
          e.budget_amount,
          e.period,
          e.scope,
          e.category_ids,
          e.rollover,
          e.created_at,
        ],
      )
    }
    for (const p of data.envelope_periods ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO envelope_periods
         (id,envelope_id,period,spent,rolled_over)
         VALUES (?,?,?,?,?)`,
        [p.id, p.envelope_id, p.period, p.spent, p.rolled_over],
      )
    }
    for (const s of data.iou_splits ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO iou_splits
         (id,transaction_id,from_user_id,to_user_id,amount,is_settled,settled_at,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          s.id,
          s.transaction_id,
          s.from_user_id,
          s.to_user_id,
          s.amount,
          s.is_settled,
          s.settled_at ?? null,
          s.created_at,
        ],
      )
    }
    for (const g of data.savings_goals ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO savings_goals
         (id,name,icon,color,target_amount,current_amount,target_date,scope,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          g.id,
          g.name,
          g.icon,
          g.color,
          g.target_amount,
          g.current_amount,
          g.target_date ?? null,
          g.scope,
          g.created_at,
        ],
      )
    }
    for (const ch of data.chores ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO chores
         (id,name,icon,color,frequency,scope,assigned_to,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          ch.id,
          ch.name,
          ch.icon,
          ch.color,
          ch.frequency,
          ch.scope,
          ch.assigned_to ?? null,
          ch.created_at,
        ],
      )
    }
    await db.exec('COMMIT')
    return null
  } catch (err) {
    await db.exec('ROLLBACK')
    throw err
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
      return getAccounts(db)
    case 'GET_ACCOUNTS_FOR_USER':
      return getAccountsForUser(db, req.payload)
    case 'CREATE_ACCOUNT':
      return createAccount(db, req.payload)
    case 'UPDATE_ACCOUNT':
      return updateAccount(db, req.payload)
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
    case 'CREATE_IOU_SPLIT':
      return createIouSplit(db, req.payload)
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
    // EXPORT_DB, EXPORT_JSON, NUKE_OPFS
    default:
      throw new Error(`Unknown request type: ${(req as WorkerRequestBody).type}`)
  }
}
