import { isSupportedCurrency } from '~/lib/currency/convert'
import type { Transaction } from '~/types/database'
import { parseImportAmount, parseImportDate } from './parsers'

export interface ImportAccount {
  id: string
  name: string
  currency: string
}

export interface ImportRowFields {
  date: string
  amount: string
  merchant: string
  description: string
  category: string
  account: string
  type: string
  currency: string
}

export type ImportRecordResult =
  | { record: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>; reason: null }
  | { record: null; reason: string }

type ImportType = 'expense' | 'income'

function parseImportType(value: string, amount: number): ImportType | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return amount < 0 ? 'expense' : 'income'
  if (normalized === 'expense' || normalized === 'debit') return 'expense'
  if (normalized === 'income' || normalized === 'credit') return 'income'
  return null
}

export function buildImportRecord(
  fields: ImportRowFields,
  accounts: ImportAccount[],
  defaultAccountId: string | null,
  defaultCurrency: string,
  userId: string,
  categoryId: string | null,
): ImportRecordResult {
  const date = parseImportDate(fields.date)
  if (!date) return { record: null, reason: `Invalid date: "${fields.date}"` }
  const parsedAmount = parseImportAmount(fields.amount)
  if (parsedAmount == null) return { record: null, reason: `Invalid amount: "${fields.amount}"` }

  const account = fields.account
    ? accounts.find((candidate) => candidate.name.toLowerCase() === fields.account.toLowerCase())
    : (accounts.find((candidate) => candidate.id === defaultAccountId) ?? accounts[0])
  if (fields.account && !account) {
    return { record: null, reason: `Unknown account: "${fields.account}"` }
  }
  if (!account) return { record: null, reason: 'No matching account' }
  const type = parseImportType(fields.type, parsedAmount)
  if (!type) return { record: null, reason: `Unsupported transaction type: "${fields.type}"` }

  const rawCurrency = fields.currency.trim().toUpperCase()
  if (rawCurrency && !isSupportedCurrency(rawCurrency)) {
    return { record: null, reason: `Unsupported currency: "${fields.currency}"` }
  }
  const currency = rawCurrency || account.currency || defaultCurrency
  const amount = type === 'expense' ? -Math.abs(parsedAmount) : Math.abs(parsedAmount)

  return {
    record: {
      date,
      amount,
      currency,
      account_id: account.id,
      user_id: userId,
      type,
      category_id: categoryId,
      description: fields.description,
      merchant: fields.merchant,
      is_private: 0,
      is_recurring: 0,
      home_amount: null,
      exchange_rate: null,
      transfer_to_account_id: null,
      split_id: null,
      source: 'import',
    },
    reason: null,
  }
}
