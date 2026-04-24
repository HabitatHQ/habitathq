import { sendToWorker } from '~/plugins/database.client'
import type {
  Account,
  Category,
  Chore,
  ChoreWithStatus,
  DashboardSummary,
  DbInfo,
  Envelope,
  EnvelopeWithSpending,
  HearthExport,
  IouBalance,
  IouSplit,
  MerchantMapping,
  SavingsGoal,
  Transaction,
  TransactionType,
  TransactionWithDetails,
  User,
} from '~/types/database'

export function useDatabase() {
  return {
    // ── Users ──────────────────────────────────────────────────────────────
    getUsers: (): Promise<User[]> => sendToWorker({ type: 'GET_USERS' }),
    getCurrentUser: (): Promise<User | null> => sendToWorker({ type: 'GET_CURRENT_USER' }),
    createUser: (p: Omit<User, 'id' | 'created_at'>): Promise<User> =>
      sendToWorker({ type: 'CREATE_USER', payload: p }),
    updateUser: (p: Partial<User> & { id: string }): Promise<User> =>
      sendToWorker({ type: 'UPDATE_USER', payload: p }),
    deleteUser: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_USER', payload: { id } }),

    // ── Accounts ───────────────────────────────────────────────────────────
    getAccounts: (): Promise<Account[]> => sendToWorker({ type: 'GET_ACCOUNTS' }),
    getAccountsForUser: (user_id: string): Promise<Account[]> =>
      sendToWorker({ type: 'GET_ACCOUNTS_FOR_USER', payload: { user_id } }),
    createAccount: (p: Omit<Account, 'id' | 'created_at'>): Promise<Account> =>
      sendToWorker({ type: 'CREATE_ACCOUNT', payload: p }),
    updateAccount: (p: Partial<Account> & { id: string }): Promise<Account> =>
      sendToWorker({ type: 'UPDATE_ACCOUNT', payload: p }),
    deleteAccount: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_ACCOUNT', payload: { id } }),

    // ── Categories ─────────────────────────────────────────────────────────
    getCategories: (): Promise<Category[]> => sendToWorker({ type: 'GET_CATEGORIES' }),
    getCategoryTree: (): Promise<Array<Category & { children: Category[] }>> =>
      sendToWorker({ type: 'GET_CATEGORY_TREE' }),

    // ── Transactions ───────────────────────────────────────────────────────
    getTransactions: (limit = 50, offset = 0): Promise<TransactionWithDetails[]> =>
      sendToWorker({ type: 'GET_TRANSACTIONS', payload: { limit, offset } }),
    getTransactionsForPeriod: (
      period: string,
      user_id?: string,
    ): Promise<TransactionWithDetails[]> =>
      sendToWorker({ type: 'GET_TRANSACTIONS_FOR_PERIOD', payload: { period, user_id } }),
    getTransaction: (id: string): Promise<TransactionWithDetails | null> =>
      sendToWorker({ type: 'GET_TRANSACTION', payload: { id } }),
    createTransaction: (
      p: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>,
    ): Promise<Transaction> => sendToWorker({ type: 'CREATE_TRANSACTION', payload: p }),
    updateTransaction: (p: Partial<Transaction> & { id: string }): Promise<Transaction> =>
      sendToWorker({ type: 'UPDATE_TRANSACTION', payload: p }),
    deleteTransaction: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_TRANSACTION', payload: { id } }),

    // ── Envelopes ──────────────────────────────────────────────────────────
    getEnvelopes: (): Promise<Envelope[]> => sendToWorker({ type: 'GET_ENVELOPES' }),
    getEnvelopesWithSpending: (period: string): Promise<EnvelopeWithSpending[]> =>
      sendToWorker({ type: 'GET_ENVELOPES_WITH_SPENDING', payload: { period } }),
    getEnvelopeWithSpending: (id: string, period: string): Promise<EnvelopeWithSpending | null> =>
      sendToWorker({ type: 'GET_ENVELOPE_WITH_SPENDING', payload: { id, period } }),
    createEnvelope: (p: Omit<Envelope, 'id' | 'created_at'>): Promise<Envelope> =>
      sendToWorker({ type: 'CREATE_ENVELOPE', payload: p }),
    updateEnvelope: (p: Partial<Envelope> & { id: string }): Promise<Envelope> =>
      sendToWorker({ type: 'UPDATE_ENVELOPE', payload: p }),
    deleteEnvelope: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_ENVELOPE', payload: { id } }),

    // ── Savings Goals ──────────────────────────────────────────────────────
    getSavingsGoals: (): Promise<SavingsGoal[]> => sendToWorker({ type: 'GET_SAVINGS_GOALS' }),
    createSavingsGoal: (p: Omit<SavingsGoal, 'id' | 'created_at'>): Promise<SavingsGoal> =>
      sendToWorker({ type: 'CREATE_SAVINGS_GOAL', payload: p }),
    updateSavingsGoal: (p: Partial<SavingsGoal> & { id: string }): Promise<SavingsGoal> =>
      sendToWorker({ type: 'UPDATE_SAVINGS_GOAL', payload: p }),
    deleteSavingsGoal: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_SAVINGS_GOAL', payload: { id } }),

    // ── IOU / Splits ───────────────────────────────────────────────────────
    getIouSplits: (): Promise<IouSplit[]> => sendToWorker({ type: 'GET_IOU_SPLITS' }),
    getIouBalances: (): Promise<IouBalance[]> => sendToWorker({ type: 'GET_IOU_BALANCES' }),
    createIouSplit: (p: Omit<IouSplit, 'id' | 'created_at'>): Promise<IouSplit> =>
      sendToWorker({ type: 'CREATE_IOU_SPLIT', payload: p }),
    settleIou: (from_user_id: string, to_user_id: string): Promise<null> =>
      sendToWorker({ type: 'SETTLE_IOU', payload: { from_user_id, to_user_id } }),

    // ── Dashboard ──────────────────────────────────────────────────────────
    getDashboardSummary: (period: string): Promise<DashboardSummary> =>
      sendToWorker({ type: 'GET_DASHBOARD_SUMMARY', payload: { period } }),

    // ── Utilities ──────────────────────────────────────────────────────────
    getDbInfo: (): Promise<DbInfo> => sendToWorker({ type: 'GET_DB_INFO' }),
    exportDb: (): Promise<Uint8Array> => sendToWorker({ type: 'EXPORT_DB' }),
    exportJson: (): Promise<HearthExport> => sendToWorker({ type: 'EXPORT_JSON' }),
    importJson: (data: HearthExport): Promise<null> =>
      sendToWorker({ type: 'IMPORT_JSON', payload: data }),
    nukeOpfs: (): Promise<null> => sendToWorker({ type: 'NUKE_OPFS' }),

    // ── Chores ─────────────────────────────────────────────────────────────
    getChoresWithStatus: (date: string): Promise<ChoreWithStatus[]> =>
      sendToWorker({ type: 'GET_CHORES_WITH_STATUS', payload: { date } }),
    createChore: (p: Omit<Chore, 'id' | 'created_at'>): Promise<Chore> =>
      sendToWorker({ type: 'CREATE_CHORE', payload: p }),
    updateChore: (p: Partial<Chore> & { id: string }): Promise<Chore> =>
      sendToWorker({ type: 'UPDATE_CHORE', payload: p }),
    deleteChore: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_CHORE', payload: { id } }),
    completeChore: (chore_id: string, user_id: string, date: string): Promise<null> =>
      sendToWorker({ type: 'COMPLETE_CHORE', payload: { chore_id, user_id, date } }),
    uncompleteChore: (chore_id: string, date: string): Promise<null> =>
      sendToWorker({ type: 'UNCOMPLETE_CHORE', payload: { chore_id, date } }),

    // ── Merchant Mappings ────────────────────────────────────────────────
    getMerchantMappings: (): Promise<MerchantMapping[]> =>
      sendToWorker({ type: 'GET_MERCHANT_MAPPINGS' }),
    getMerchantMapping: (merchant: string): Promise<MerchantMapping | null> =>
      sendToWorker({ type: 'GET_MERCHANT_MAPPING', payload: { merchant } }),
    upsertMerchantMapping: (
      merchant: string,
      category_id: string,
      account_id?: string | null,
    ): Promise<MerchantMapping> =>
      sendToWorker({
        type: 'UPSERT_MERCHANT_MAPPING',
        payload: { merchant, category_id, account_id },
      }),
    getRecentAccountByType: (
      type: TransactionType,
    ): Promise<{ account_id: string; cnt: number } | null> =>
      sendToWorker({ type: 'GET_RECENT_ACCOUNT_BY_TYPE', payload: { type } }),
  }
}
