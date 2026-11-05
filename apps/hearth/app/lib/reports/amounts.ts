import { convertCurrency } from '~/lib/currency/convert'

export interface HomeCurrencyTransactionAmount {
  amount: number
  currency: string
  date: string
  home_amount: number | null
  home_currency: string | null
}

export interface CachedHomeCurrencyRate {
  base: string
  target: string
  date: string
  rate: number
}

const SQLITE_MAX_FINITE = '1.7976931348623157e308'

/** Resolve only native, correctly-targeted saved, or exact positive cached conversions. */
export function homeCurrencyAmount(
  transaction: HomeCurrencyTransactionAmount,
  homeCurrency: string,
  cachedRate?: CachedHomeCurrencyRate | null,
): number | null {
  if (!Number.isFinite(transaction.amount)) return null
  if (transaction.currency === homeCurrency) return transaction.amount
  if (
    transaction.home_amount !== null &&
    Number.isFinite(transaction.home_amount) &&
    transaction.home_currency === homeCurrency
  ) {
    return transaction.home_amount
  }
  if (
    cachedRate &&
    cachedRate.base === transaction.currency &&
    cachedRate.target === homeCurrency &&
    cachedRate.date === transaction.date &&
    Number.isFinite(cachedRate.rate) &&
    cachedRate.rate > 0
  ) {
    if (!Number.isFinite(transaction.amount * cachedRate.rate)) return null
    return convertCurrency(transaction.amount, cachedRate.rate)
  }
  return null
}

/** SQL CASE expression; bind each `?` target occurrence unless using a SQL expression. */
export function homeCurrencyAmountSql(
  transactionAlias = 't',
  homeCurrencyExpression = '?',
): string {
  return `(CASE
    WHEN ${transactionAlias}.currency = ${homeCurrencyExpression}
      AND ABS(${transactionAlias}.amount) <= ${SQLITE_MAX_FINITE}
      THEN ${transactionAlias}.amount
    WHEN ${transactionAlias}.home_amount IS NOT NULL
      AND ABS(${transactionAlias}.home_amount) <= ${SQLITE_MAX_FINITE}
      AND ${transactionAlias}.home_currency = ${homeCurrencyExpression}
      THEN ${transactionAlias}.home_amount
    ELSE (
      SELECT CASE
        WHEN ${transactionAlias}.amount * exchange_rates.rate < 0
          THEN -ROUND(ABS(${transactionAlias}.amount * exchange_rates.rate), 2)
        ELSE ROUND(${transactionAlias}.amount * exchange_rates.rate, 2)
      END
      FROM exchange_rates
      WHERE exchange_rates.base = ${transactionAlias}.currency
        AND exchange_rates.target = ${homeCurrencyExpression}
        AND exchange_rates.date = ${transactionAlias}.date
        AND ABS(${transactionAlias}.amount) <= ${SQLITE_MAX_FINITE}
        AND ABS(${transactionAlias}.amount * exchange_rates.rate) <= ${SQLITE_MAX_FINITE}
        AND exchange_rates.rate > 0
        AND exchange_rates.rate <= ${SQLITE_MAX_FINITE}
      LIMIT 1
    )
  END)`
}
