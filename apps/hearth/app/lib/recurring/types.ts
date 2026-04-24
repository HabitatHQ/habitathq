import type { TransactionType } from '~/types/database'

export type RecurringInterval = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
export type RecurringStatus = 'detected' | 'confirmed' | 'dismissed'

export interface RecurringPattern {
  id: string
  merchant: string
  type: TransactionType
  interval: RecurringInterval
  averageAmount: number
  lastOccurrence: string // YYYY-MM-DD
  nextExpected: string // YYYY-MM-DD
  confidence: number // 0-1
  status: RecurringStatus
  categoryId: string | null
  accountId: string | null
  transactionIds: string[]
}

/** Minimal transaction shape needed for detection */
export interface DetectableTransaction {
  id: string
  date: string
  amount: number
  type: TransactionType
  merchant: string
  category_id: string | null
  account_id: string | null
}
