import type { Account } from '~/types/database'

export function getCreditCardPaymentSuggestion(
  source: Pick<Account, 'id' | 'currency'> | undefined,
  target: Pick<Account, 'id' | 'type' | 'currency' | 'balance'> | undefined,
  transactionCurrency: string,
): number | null {
  if (
    !source ||
    !target ||
    target.type !== 'credit' ||
    source.id === target.id ||
    source.currency !== target.currency ||
    transactionCurrency !== target.currency ||
    target.balance >= 0
  ) {
    return null
  }
  return -target.balance
}
