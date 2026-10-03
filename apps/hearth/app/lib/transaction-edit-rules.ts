import type { TransactionType } from '~/types/database'

export interface SplitSensitiveTransactionFields {
  type: TransactionType
  amount: number
  currency: string
}

export function getIouSplitEditError(
  hasIouSplit: boolean,
  original: SplitSensitiveTransactionFields,
  updated: SplitSensitiveTransactionFields,
): string | null {
  if (!hasIouSplit) return null
  if (
    original.type !== 'expense' ||
    updated.type !== 'expense' ||
    updated.amount !== original.amount ||
    updated.currency !== original.currency
  ) {
    return 'This transaction has an IOU split. Its type, amount, and currency cannot be changed here.'
  }
  return null
}

export function getTransferDestinationError(
  type: TransactionType,
  sourceAccountId: string,
  destinationAccountId: string,
): string | null {
  if (type !== 'transfer') return null
  if (!destinationAccountId) return 'Please select a destination account'
  if (destinationAccountId === sourceAccountId) {
    return 'Source and destination accounts must be different'
  }
  return null
}
