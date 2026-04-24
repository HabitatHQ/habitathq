import type { TransactionType } from '~/types/database'

/** Confidence level for a parsed field */
export type Confidence = 'high' | 'medium' | 'low'

/** A single parsed transaction from natural language */
export interface ParsedTransaction {
  /** Unique client-side ID for card tracking */
  clientId: string
  /** Raw text segment that produced this transaction */
  rawText: string
  /** Transaction type */
  type: TransactionType
  typeConfidence: Confidence
  /** Absolute amount (always positive), null if not detected */
  amount: number | null
  amountConfidence: Confidence
  /** Merchant / payee name */
  merchant: string
  merchantConfidence: Confidence
  /** Category ID */
  categoryId: string | null
  categoryConfidence: Confidence
  /** Account ID */
  accountId: string | null
  accountConfidence: Confidence
  /** Transfer destination account ID */
  transferToAccountId: string | null
  /** Date as YYYY-MM-DD */
  date: string
  dateConfidence: Confidence
  /** Optional description / note */
  description: string
}

/** Context passed to the parser: categories, accounts, mappings */
export interface ParserContext {
  categories: Array<{ id: string; parent_id: string | null; name: string; icon: string }>
  accounts: Array<{ id: string; name: string; type: string }>
  merchantMappings: Map<string, { category_id: string; account_id: string | null }>
  defaultAccountByType: Record<TransactionType, string | null>
  currentUserId: string
  today: string // YYYY-MM-DD
}

/** Result of parsing an entire utterance */
export interface ParseResult {
  transactions: ParsedTransaction[]
  unrecognized: string | null
}
