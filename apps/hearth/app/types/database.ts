// ── Hearth Database Types ──────────────────────────────────────────────────

export type UserRole = 'owner' | 'partner' | 'family' | 'child'
export type AccountType = 'checking' | 'savings' | 'credit' | 'cash'
export type TransactionType = 'expense' | 'income' | 'transfer'
export type TransactionSource = 'manual' | 'import' | 'voice' | 'ocr'
export type EnvelopeScope = 'personal' | 'household'
export type BudgetPeriod = 'monthly' | 'weekly' | 'yearly'

export interface User {
  id: string
  name: string
  email: string | null
  role: UserRole
  avatar_emoji: string
  color: string
  is_current: number // 1 = this device's "me", 0 = household member
  created_at: string
}

export interface Account {
  id: string
  user_id: string
  name: string
  type: AccountType
  balance: number
  currency: string
  color: string
  icon: string
  is_active: number
  created_at: string
}

export interface Category {
  id: string
  parent_id: string | null
  name: string
  icon: string
  color: string
  sort_order: number
}

export interface CategoryWithChildren extends Category {
  children: Category[]
}

export interface Transaction {
  id: string
  date: string
  amount: number // negative for expense, positive for income
  currency: string
  account_id: string
  user_id: string
  type: TransactionType
  category_id: string | null
  description: string
  merchant: string
  is_private: number
  is_recurring: number
  transfer_to_account_id: string | null
  split_id: string | null
  source: TransactionSource
  created_at: string
  updated_at: string
}

export interface TransactionWithDetails extends Transaction {
  category_name: string | null
  category_icon: string | null
  category_color: string | null
  user_name: string
  user_avatar: string
  account_name: string
}

export interface Envelope {
  id: string
  name: string
  icon: string
  color: string
  budget_amount: number
  period: BudgetPeriod
  scope: EnvelopeScope
  category_ids: string // JSON array
  rollover: number
  created_at: string
}

export interface EnvelopeWithSpending extends Envelope {
  spent: number
  rolled_over: number
  remaining: number
  percent_used: number
  is_overspent: boolean
}

export interface EnvelopePeriod {
  id: string
  envelope_id: string
  period: string // YYYY-MM
  spent: number
  rolled_over: number
}

export interface IouSplit {
  id: string
  transaction_id: string
  from_user_id: string
  to_user_id: string
  amount: number
  is_settled: number
  settled_at: string | null
  created_at: string
}

export interface IouBalance {
  from_user_id: string
  to_user_id: string
  from_user_name: string
  to_user_name: string
  from_user_avatar: string
  to_user_avatar: string
  net_amount: number // positive = to_user owes from_user
}

export interface SavingsGoal {
  id: string
  name: string
  icon: string
  color: string
  target_amount: number
  current_amount: number
  target_date: string | null
  scope: EnvelopeScope
  created_at: string
}

export interface DashboardSummary {
  spent_this_month: number
  income_this_month: number
  budget_total: number
  budget_remaining: number
  envelopes: EnvelopeWithSpending[]
  recent_transactions: TransactionWithDetails[]
  savings_goals: SavingsGoal[]
  iou_balances: IouBalance[]
}

export interface DbInfo {
  size_bytes: number
  transaction_count: number
  user_count: number
  account_count: number
  envelope_count: number
}

export interface MonthlyTotal {
  period: string // YYYY-MM
  expenses: number
  income: number
}

export type RecurringInterval = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
export type RecurringStatus = 'detected' | 'confirmed' | 'dismissed'

export interface RecurringPatternRow {
  id: string
  merchant: string
  type: TransactionType
  interval: RecurringInterval
  average_amount: number
  last_occurrence: string
  next_expected: string
  confidence: number
  status: RecurringStatus
  category_id: string | null
  account_id: string | null
  transaction_ids: string // JSON array
  created_at: string
  updated_at: string
}

export type ChoreFrequency = 'daily' | 'weekly' | 'monthly'

export interface Chore {
  id: string
  name: string
  icon: string
  color: string
  frequency: ChoreFrequency
  scope: 'personal' | 'household'
  assigned_to: string | null
  created_at: string
}

export interface ChoreCompletion {
  id: string
  chore_id: string
  user_id: string
  completed_at: string
  period_key: string
  created_at: string
}

export interface ChoreWithStatus extends Chore {
  is_done: boolean
  completed_at: string | null
  completed_by_name: string | null
  completed_by_avatar: string | null
  assigned_to_name: string | null
  assigned_to_avatar: string | null
  period_key: string
}

export interface MerchantMapping {
  id: string
  merchant: string
  category_id: string
  account_id: string | null
  use_count: number
  last_used_at: string
  created_at: string
}

export interface HearthExport {
  version: string
  exported_at: string
  users: User[]
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  envelopes: Envelope[]
  envelope_periods: EnvelopePeriod[]
  iou_splits: IouSplit[]
  savings_goals: SavingsGoal[]
  chores: Chore[]
}

// ── Worker message protocol ────────────────────────────────────────────────

export type WorkerRequestBody =
  | { type: 'GET_USERS' }
  | { type: 'GET_CURRENT_USER' }
  | { type: 'CREATE_USER'; payload: Omit<User, 'id' | 'created_at'> }
  | { type: 'UPDATE_USER'; payload: Partial<User> & { id: string } }
  | { type: 'DELETE_USER'; payload: { id: string } }
  | { type: 'GET_ACCOUNTS' }
  | { type: 'GET_ACCOUNTS_FOR_USER'; payload: { user_id: string } }
  | { type: 'CREATE_ACCOUNT'; payload: Omit<Account, 'id' | 'created_at'> }
  | { type: 'UPDATE_ACCOUNT'; payload: Partial<Account> & { id: string } }
  | { type: 'DELETE_ACCOUNT'; payload: { id: string } }
  | { type: 'GET_CATEGORIES' }
  | { type: 'GET_CATEGORY_TREE' }
  | { type: 'GET_TRANSACTIONS'; payload: { limit?: number; offset?: number } }
  | { type: 'GET_TRANSACTIONS_FOR_PERIOD'; payload: { period: string; user_id?: string } }
  | { type: 'GET_TRANSACTION'; payload: { id: string } }
  | { type: 'CREATE_TRANSACTION'; payload: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> }
  | { type: 'UPDATE_TRANSACTION'; payload: Partial<Transaction> & { id: string } }
  | { type: 'DELETE_TRANSACTION'; payload: { id: string } }
  | { type: 'GET_ENVELOPES' }
  | { type: 'GET_ENVELOPE_WITH_SPENDING'; payload: { id: string; period: string } }
  | { type: 'GET_ENVELOPES_WITH_SPENDING'; payload: { period: string } }
  | { type: 'CREATE_ENVELOPE'; payload: Omit<Envelope, 'id' | 'created_at'> }
  | { type: 'UPDATE_ENVELOPE'; payload: Partial<Envelope> & { id: string } }
  | { type: 'DELETE_ENVELOPE'; payload: { id: string } }
  | { type: 'GET_SAVINGS_GOALS' }
  | { type: 'CREATE_SAVINGS_GOAL'; payload: Omit<SavingsGoal, 'id' | 'created_at'> }
  | { type: 'UPDATE_SAVINGS_GOAL'; payload: Partial<SavingsGoal> & { id: string } }
  | { type: 'DELETE_SAVINGS_GOAL'; payload: { id: string } }
  | { type: 'GET_IOU_SPLITS' }
  | { type: 'GET_IOU_BALANCES' }
  | { type: 'CREATE_IOU_SPLIT'; payload: Omit<IouSplit, 'id' | 'created_at'> }
  | { type: 'SETTLE_IOU'; payload: { from_user_id: string; to_user_id: string } }
  | { type: 'GET_DASHBOARD_SUMMARY'; payload: { period: string } }
  | { type: 'GET_DB_INFO' }
  | { type: 'EXPORT_DB' }
  | { type: 'EXPORT_JSON' }
  | { type: 'IMPORT_JSON'; payload: HearthExport }
  | { type: 'NUKE_OPFS' }
  | { type: 'GET_CHORES_WITH_STATUS'; payload: { date: string } }
  | { type: 'CREATE_CHORE'; payload: Omit<Chore, 'id' | 'created_at'> }
  | { type: 'UPDATE_CHORE'; payload: Partial<Chore> & { id: string } }
  | { type: 'DELETE_CHORE'; payload: { id: string } }
  | { type: 'COMPLETE_CHORE'; payload: { chore_id: string; user_id: string; date: string } }
  | { type: 'UNCOMPLETE_CHORE'; payload: { chore_id: string; date: string } }
  | { type: 'GET_MERCHANT_MAPPINGS' }
  | { type: 'GET_MERCHANT_MAPPING'; payload: { merchant: string } }
  | {
      type: 'UPSERT_MERCHANT_MAPPING'
      payload: { merchant: string; category_id: string; account_id?: string | null }
    }
  | { type: 'GET_RECENT_ACCOUNT_BY_TYPE'; payload: { type: TransactionType } }
  | { type: 'GET_MONTHLY_TOTALS'; payload: { months: number } }
  | { type: 'DETECT_RECURRING' }
  | {
      type: 'GET_RECURRING_PATTERNS'
      payload: { status?: RecurringStatus; includeDismissed?: boolean }
    }
  | { type: 'UPDATE_RECURRING_PATTERN'; payload: { id: string; status: RecurringStatus } }
  | { type: 'CONFIRM_ALL_RECURRING'; payload: { minConfidence: number } }
  | {
      type: 'SAVE_RECEIPT_IMAGE'
      payload: { transaction_id: string; image_data: string; mime_type?: string }
    }
  | { type: 'GET_RECEIPT_IMAGE'; payload: { transaction_id: string } }
  | { type: 'DELETE_RECEIPT_IMAGE'; payload: { transaction_id: string } }
  | {
      type: 'IMPORT_TRANSACTIONS'
      payload: {
        transactions: Array<Omit<Transaction, 'id' | 'created_at' | 'updated_at'>>
      }
    }

export type WorkerRequest = WorkerRequestBody & { id: string }

export type WorkerResponse =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string }
