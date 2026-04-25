import type { ExchangeRate } from '~/types/database'

/**
 * Fetch exchange rate from frankfurter.app (ECB rates, free, no API key).
 * Returns the rate for converting 1 unit of `base` to `target` on `date`.
 */
export async function fetchExchangeRate(
  base: string,
  target: string,
  date: string,
): Promise<ExchangeRate> {
  if (base === target) {
    return { base, target, rate: 1, date }
  }

  const res = await fetch(`https://api.frankfurter.app/${date}?from=${base}&to=${target}`)
  if (!res.ok) {
    throw new Error(`FX rate fetch failed: ${res.status}`)
  }

  const data = (await res.json()) as { base: string; date: string; rates: Record<string, number> }
  const rate = data.rates[target]
  if (rate == null) {
    throw new Error(`No rate found for ${base} -> ${target} on ${date}`)
  }

  return { base, target, rate, date: data.date }
}
