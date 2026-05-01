import type { Confidence } from './types'

const TRANSFER_PATTERN =
  /\btransfer(?:red)?\s+(?:\$?\s?(\d+(?:\.\d{1,2})?)\s+)?from\s+(.+?)\s+to\s+(.+?)(?:\s|$)/i

export interface TransferResult {
  amount: number | null
  fromAccountId: string | null
  toAccountId: string | null
  confidence: Confidence
}

function fuzzyMatchAccount(
  query: string,
  accounts: Array<{ id: string; name: string; type: string }>,
): string | null {
  const q = query.toLowerCase().trim()
  // Exact name match
  for (const a of accounts) {
    if (a.name.toLowerCase() === q) return a.id
  }
  // Name contains query
  for (const a of accounts) {
    if (a.name.toLowerCase().includes(q)) return a.id
  }
  // Account type match ("checking", "savings", "credit")
  for (const a of accounts) {
    if (a.type.toLowerCase() === q) return a.id
  }
  return null
}

export function parseTransfer(
  text: string,
  accounts: Array<{ id: string; name: string; type: string }>,
): TransferResult | null {
  const match = TRANSFER_PATTERN.exec(text)
  if (!match) return null

  const amount = match[1] ? parseFloat(match[1]) : null
  const fromAccountId = match[2] ? fuzzyMatchAccount(match[2], accounts) : null
  const toAccountId = match[3] ? fuzzyMatchAccount(match[3], accounts) : null

  return {
    amount,
    fromAccountId,
    toAccountId,
    confidence: fromAccountId && toAccountId ? 'high' : 'medium',
  }
}
