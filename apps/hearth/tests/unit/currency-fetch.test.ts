import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchExchangeRate } from '~/lib/currency/fetch-rate'

describe('fetchExchangeRate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches rate from frankfurter.app', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ base: 'EUR', date: '2026-04-25', rates: { USD: 1.105 } }),
    })
    const result = await fetchExchangeRate('EUR', 'USD', '2026-04-25')
    expect(result).toEqual({ base: 'EUR', target: 'USD', rate: 1.105, date: '2026-04-25' })
    expect(fetch).toHaveBeenCalledWith('https://api.frankfurter.app/2026-04-25?from=EUR&to=USD')
  })

  it('returns rate 1 when base === target', async () => {
    global.fetch = vi.fn()
    const result = await fetchExchangeRate('USD', 'USD', '2026-04-25')
    expect(result.rate).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    await expect(fetchExchangeRate('EUR', 'USD', '2026-04-25')).rejects.toThrow(
      'FX rate fetch failed',
    )
  })

  it('throws when target currency missing from response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ base: 'EUR', date: '2026-04-25', rates: {} }),
    })
    await expect(fetchExchangeRate('EUR', 'USD', '2026-04-25')).rejects.toThrow('No rate found')
  })
})
