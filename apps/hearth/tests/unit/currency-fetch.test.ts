import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchExchangeRate } from '~/lib/currency/fetch-rate'

afterEach(() => vi.unstubAllGlobals())

describe('exchange rate response boundary', () => {
  it.each([0, -1, '1.25', null])('rejects an unusable remote rate %s instead of saving a false conversion', async (rate) => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      base: 'EUR', date: '2026-11-05', rates: { USD: rate },
    })))
    await expect(fetchExchangeRate('EUR', 'USD', '2026-11-05')).rejects.toThrow()
  })

  it.each(['1e999', '-1e999'])('rejects a non-finite JSON rate %s', async (rate) => {
    vi.stubGlobal('fetch', async () => new Response(
      `{"base":"EUR","date":"2026-11-05","rates":{"USD":${rate}}}`,
    ))
    await expect(fetchExchangeRate('EUR', 'USD', '2026-11-05')).rejects.toThrow()
  })
})
