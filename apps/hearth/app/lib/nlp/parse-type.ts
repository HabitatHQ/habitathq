import type { TransactionType } from '~/types/database'
import type { Confidence } from './types'

const TRANSFER_RE = /\btransfer(?:red)?\b.*\bfrom\b.*\bto\b/i
const TRANSFER_SIMPLE_RE = /\btransfer(?:red)?\b/i

const INCOME_KEYWORDS = [
  'earned',
  'received',
  'got paid',
  'paycheck',
  'salary',
  'income',
  'refund',
  'reimbursement',
  'freelance payment',
]

const EXPENSE_KEYWORDS = ['spent', 'paid', 'bought', 'purchased', 'cost']

export interface TypeResult {
  type: TransactionType
  confidence: Confidence
  matchedKeywords: string[]
}

export function parseType(text: string): TypeResult {
  const lower = text.toLowerCase()

  // Transfer: "transfer from X to Y" or just "transfer"
  if (TRANSFER_RE.test(lower)) {
    return { type: 'transfer', confidence: 'high', matchedKeywords: ['transfer'] }
  }
  if (TRANSFER_SIMPLE_RE.test(lower)) {
    return { type: 'transfer', confidence: 'medium', matchedKeywords: ['transfer'] }
  }

  // Income keywords
  for (const kw of INCOME_KEYWORDS) {
    if (lower.includes(kw)) {
      return { type: 'income', confidence: 'high', matchedKeywords: [kw] }
    }
  }

  // Expense keywords
  for (const kw of EXPENSE_KEYWORDS) {
    if (lower.includes(kw)) {
      return { type: 'expense', confidence: 'high', matchedKeywords: [kw] }
    }
  }

  // Default: expense
  return { type: 'expense', confidence: 'low', matchedKeywords: [] }
}
