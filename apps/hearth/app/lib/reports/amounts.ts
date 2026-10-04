export function homeCurrencyAmount(transaction: {
  amount: number
  home_amount: number | null
}): number {
  return transaction.home_amount ?? transaction.amount
}
