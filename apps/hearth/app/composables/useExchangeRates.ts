import { convertCurrency } from '~/lib/currency/convert'
import { fetchExchangeRate } from '~/lib/currency/fetch-rate'

const rateCache = new Map<string, number>()

function cacheKey(base: string, target: string, date: string): string {
  return `${base}:${target}:${date}`
}

export function useExchangeRates() {
  const db = useDatabase()

  async function getRate(base: string, target: string, date: string): Promise<number> {
    if (base === target) return 1

    const key = cacheKey(base, target, date)
    const cached = rateCache.get(key)
    if (cached != null) return cached

    // Try DB cache
    try {
      const dbRate = await db.getExchangeRate(base, target, date)
      if (dbRate) {
        rateCache.set(key, dbRate.rate)
        return dbRate.rate
      }
    } catch {
      // DB might not be ready
    }

    // Fetch from API
    const fetched = await fetchExchangeRate(base, target, date)
    rateCache.set(key, fetched.rate)

    // Persist to DB (fire-and-forget)
    try {
      await db.upsertExchangeRate(fetched)
    } catch {
      // Non-critical
    }

    return fetched.rate
  }

  function computeHomeAmount(amount: number, rate: number): number {
    return convertCurrency(amount, rate)
  }

  return { getRate, computeHomeAmount }
}
