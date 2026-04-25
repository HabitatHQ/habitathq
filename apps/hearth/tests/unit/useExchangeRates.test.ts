import { beforeEach, describe, expect, it, vi } from 'vitest'
import { convertCurrency } from '~/lib/currency/convert'

// Mock useDatabase (auto-imported by Nuxt, not available in vitest)
const mockGetExchangeRate = vi.fn().mockResolvedValue(null)
const mockUpsertExchangeRate = vi.fn().mockResolvedValue(null)

vi.stubGlobal('useDatabase', () => ({
  getExchangeRate: mockGetExchangeRate,
  upsertExchangeRate: mockUpsertExchangeRate,
}))

// Mock fetch for frankfurter.app
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ base: 'EUR', date: '2026-04-25', rates: { USD: 1.105 } }),
  }),
)

describe('useExchangeRates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getRate returns 1 when base === target', async () => {
    const { useExchangeRates } = await import('~/composables/useExchangeRates')
    const { getRate } = useExchangeRates()
    const rate = await getRate('USD', 'USD', '2026-04-25')
    expect(rate).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('computeHomeAmount converts using convertCurrency', () => {
    expect(convertCurrency(-50, 1.105)).toBeCloseTo(-55.25, 2)
    expect(convertCurrency(100, 1)).toBe(100)
  })
})
