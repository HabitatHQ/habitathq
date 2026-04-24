import { parseAmount } from './parse-amount'
import { parseCategory } from './parse-category'
import { parseDate } from './parse-date'
import { parseMerchant } from './parse-merchant'
import { parseTransfer } from './parse-transfer'
import { parseType } from './parse-type'
import type { ParsedTransaction, ParseResult, ParserContext } from './types'

/**
 * Split on semicolons, newlines, commas before amounts, "and" before amounts.
 * Preserves "and" inside merchant names like "Bed Bath and Beyond".
 */
const BATCH_SPLIT_RE = /(?:;|\n|,\s*(?=\$?\d)|\band\b\s+(?=\$?\d))/i

function splitBatch(input: string): string[] {
  return input
    .split(BATCH_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function parseSingleTransaction(segment: string, context: ParserContext): ParsedTransaction {
  // 1. Detect type
  const typeResult = parseType(segment)

  // 2. Handle transfers specially
  if (typeResult.type === 'transfer') {
    const transferResult = parseTransfer(segment, context.accounts)
    if (transferResult) {
      const dateResult = parseDate(segment, context.today)
      return {
        clientId: crypto.randomUUID(),
        rawText: segment,
        type: 'transfer',
        typeConfidence: typeResult.confidence,
        amount: transferResult.amount,
        amountConfidence: transferResult.amount != null ? 'high' : 'low',
        merchant: '',
        merchantConfidence: 'high',
        categoryId: null,
        categoryConfidence: 'high',
        accountId: transferResult.fromAccountId,
        accountConfidence: transferResult.fromAccountId ? 'high' : 'low',
        transferToAccountId: transferResult.toAccountId,
        date: dateResult?.date ?? context.today,
        dateConfidence: dateResult?.confidence ?? 'low',
        description: '',
      }
    }
  }

  // 3. Extract amount
  const amountResult = parseAmount(segment)

  // 4. Extract date
  const dateResult = parseDate(segment, context.today)

  // 5. Extract merchant (remainder after removing matched segments)
  const merchantResult = parseMerchant(
    segment,
    amountResult?.matchedText ?? null,
    dateResult?.matchedText ?? null,
    typeResult.matchedKeywords,
  )

  // 6. Resolve category
  const categoryResult = parseCategory(merchantResult.merchant, segment, typeResult.type, context)

  // 7. Resolve account
  let accountId: string | null = null
  let accountConfidence: 'high' | 'medium' | 'low' = 'low'

  // Check merchant mapping for account
  const merchantLower = merchantResult.merchant.toLowerCase().trim()
  const mapping = context.merchantMappings.get(merchantLower)
  if (mapping?.account_id) {
    accountId = mapping.account_id
    accountConfidence = 'high'
  } else if (context.defaultAccountByType[typeResult.type]) {
    accountId = context.defaultAccountByType[typeResult.type]
    accountConfidence = 'medium'
  } else if (context.accounts[0]) {
    accountId = context.accounts[0].id
    accountConfidence = 'low'
  }

  return {
    clientId: crypto.randomUUID(),
    rawText: segment,
    type: typeResult.type,
    typeConfidence: typeResult.confidence,
    amount: amountResult?.amount ?? null,
    amountConfidence: amountResult?.confidence ?? 'low',
    merchant: merchantResult.merchant,
    merchantConfidence: merchantResult.confidence,
    categoryId: categoryResult.categoryId,
    categoryConfidence: categoryResult.confidence,
    accountId,
    accountConfidence,
    transferToAccountId: null,
    date: dateResult?.date ?? context.today,
    dateConfidence: dateResult?.confidence ?? 'low',
    description: '',
  }
}

export function parseUtterance(input: string, context: ParserContext): ParseResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { transactions: [], unrecognized: null }
  }

  const segments = splitBatch(trimmed)
  const transactions = segments.map((seg) => parseSingleTransaction(seg, context))

  return { transactions, unrecognized: null }
}
