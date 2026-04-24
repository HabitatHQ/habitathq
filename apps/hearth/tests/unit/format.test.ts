import { describe, expect, it } from 'vitest'
import {
  clamp,
  currentPeriod,
  envelopeColorClass,
  formatAmount,
  formatCompact,
  formatCurrency,
  formatDateRelative,
  formatPeriod,
  offsetPeriod,
  splitCurrencyParts,
  transactionAmountClass,
  transactionAmountPrefix,
  transactionStripeClass,
} from '~/utils/format'

// ── formatCurrency ────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats positive amounts', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56')
  })

  it('formats negative amounts with minus sign', () => {
    expect(formatCurrency(-87.43)).toBe('-$87.43')
  })

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00')
  })

  it('rounds to 2 decimal places', () => {
    expect(formatCurrency(1.005)).toBe('$1.01')
  })

  it('formats large amounts with commas', () => {
    expect(formatCurrency(10000)).toBe('$10,000.00')
  })
})

// ── formatAmount ──────────────────────────────────────────────────────────

describe('formatAmount', () => {
  it('always returns positive (absolute value)', () => {
    expect(formatAmount(-87.43)).toBe('$87.43')
    expect(formatAmount(87.43)).toBe('$87.43')
  })

  it('formats zero', () => {
    expect(formatAmount(0)).toBe('$0.00')
  })
})

// ── splitCurrencyParts ────────────────────────────────────────────────────

describe('splitCurrencyParts', () => {
  it('splits whole and decimal parts', () => {
    const { whole, decimal } = splitCurrencyParts(1234.56)
    expect(whole).toBe('$1,234')
    expect(decimal).toBe('.56')
  })

  it('handles zero', () => {
    const { whole, decimal } = splitCurrencyParts(0)
    expect(whole).toBe('$0')
    expect(decimal).toBe('.00')
  })
})

// ── formatCompact ─────────────────────────────────────────────────────────

describe('formatCompact', () => {
  it('formats thousands as K', () => {
    expect(formatCompact(12400)).toBe('$12.4K')
  })

  it('formats millions as M', () => {
    expect(formatCompact(1_200_000)).toBe('$1.2M')
  })

  it('formats small amounts without suffix', () => {
    expect(formatCompact(87.43)).toBe('$87.43')
  })

  it('handles negative amounts', () => {
    expect(formatCompact(-5000)).toBe('-$5.0K')
  })
})

// ── formatCurrency — additional edge cases ────────────────────────────────

describe('formatCurrency — additional', () => {
  it('formats EUR with correct symbol', () => {
    const result = formatCurrency(1234.56, 'EUR', 'de-DE')
    expect(result).toContain('1.234,56')
    expect(result).toContain('€')
  })

  it('formats large negative amounts', () => {
    expect(formatCurrency(-999999.99)).toBe('-$999,999.99')
  })

  it('formats fractional cent amounts by rounding', () => {
    // 1.004 rounds down to 1.00, 1.005 rounds up to 1.01
    expect(formatCurrency(1.004)).toBe('$1.00')
  })
})

// ── formatCompact — additional edge cases ─────────────────────────────────

describe('formatCompact — additional', () => {
  it('formats exactly 1000 as 1.0K', () => {
    expect(formatCompact(1000)).toBe('$1.0K')
  })

  it('formats 999.99 without suffix', () => {
    expect(formatCompact(999.99)).toBe('$999.99')
  })

  it('formats exactly 1_000_000 as 1.0M', () => {
    expect(formatCompact(1_000_000)).toBe('$1.0M')
  })

  it('formats zero', () => {
    expect(formatCompact(0)).toBe('$0.00')
  })

  it('formats negative millions', () => {
    expect(formatCompact(-2_500_000)).toBe('-$2.5M')
  })

  it('uses currency symbol for non-USD', () => {
    // Non-USD currencies fall back to the currency code
    const result = formatCompact(5000, 'EUR')
    expect(result).toContain('EUR')
    expect(result).toContain('5.0K')
  })
})

// ── splitCurrencyParts — additional edge cases ───────────────────────────

describe('splitCurrencyParts — additional', () => {
  it('strips sign from negative amounts (uses abs)', () => {
    const { whole, decimal } = splitCurrencyParts(-1234.56)
    expect(whole).toBe('$1,234')
    expect(decimal).toBe('.56')
  })

  it('handles large amounts', () => {
    const { whole, decimal } = splitCurrencyParts(1_000_000)
    expect(whole).toBe('$1,000,000')
    expect(decimal).toBe('.00')
  })
})

// ── formatDateRelative ────────────────────────────────────────────────────

describe('formatDateRelative', () => {
  it('returns "Today" for today', () => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(formatDateRelative(today)).toBe('Today')
  })

  it('returns "Yesterday" for yesterday', () => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(formatDateRelative(yesterday)).toBe('Yesterday')
  })

  it('returns day + date for this week', () => {
    const d = new Date()
    d.setDate(d.getDate() - 3)
    const result = formatDateRelative(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    // Should be like "Mon 6 Mar" — just check it's not Today/Yesterday and has a space
    expect(result).not.toBe('Today')
    expect(result).not.toBe('Yesterday')
    expect(result).toMatch(/\w{3} \d{1,2} \w{3}/)
  })

  it('returns date without day for older dates', () => {
    const d = new Date()
    d.setDate(d.getDate() - 10)
    const result = formatDateRelative(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    expect(result).not.toMatch(/\w{3} \d{1,2} \w{3}/)
  })

  it('returns just "D Mon" (no year) for dates in the current year older than 7 days', () => {
    const d = new Date()
    d.setDate(d.getDate() - 10)
    if (d.getFullYear() === new Date().getFullYear()) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const result = formatDateRelative(dateStr)
      expect(result).toMatch(/^\d{1,2} \w{3}$/)
    }
  })

  it('returns "D Mon YYYY" for dates in a prior year', () => {
    const result = formatDateRelative('2023-01-15')
    expect(result).toBe('15 Jan 2023')
  })

  it('handles January 1st across year boundary', () => {
    const result = formatDateRelative('2024-01-01')
    expect(result).toContain('2024')
  })
})

// ── formatPeriod ──────────────────────────────────────────────────────────

describe('formatPeriod', () => {
  it('formats YYYY-MM as "Month Year"', () => {
    expect(formatPeriod('2026-03')).toBe('March 2026')
    expect(formatPeriod('2026-01')).toBe('January 2026')
    expect(formatPeriod('2025-12')).toBe('December 2025')
  })
})

// ── currentPeriod ─────────────────────────────────────────────────────────

describe('currentPeriod', () => {
  it('returns current YYYY-MM', () => {
    const result = currentPeriod()
    expect(result).toMatch(/^\d{4}-\d{2}$/)
    const [year, month] = result.split('-').map(Number)
    const now = new Date()
    expect(year).toBe(now.getFullYear())
    expect(month).toBe(now.getMonth() + 1)
  })
})

// ── offsetPeriod ──────────────────────────────────────────────────────────

describe('offsetPeriod', () => {
  it('increments month', () => {
    expect(offsetPeriod('2026-01', 1)).toBe('2026-02')
    expect(offsetPeriod('2026-12', 1)).toBe('2027-01')
  })

  it('decrements month', () => {
    expect(offsetPeriod('2026-03', -1)).toBe('2026-02')
    expect(offsetPeriod('2026-01', -1)).toBe('2025-12')
  })

  it('stays within bounds', () => {
    const result = offsetPeriod('2026-06', 0)
    expect(result).toBe('2026-06')
  })
})

// ── offsetPeriod — additional ─────────────────────────────────────────────

describe('offsetPeriod — additional', () => {
  it('handles large positive offsets', () => {
    expect(offsetPeriod('2026-01', 24)).toBe('2028-01')
  })

  it('handles large negative offsets', () => {
    expect(offsetPeriod('2026-06', -18)).toBe('2024-12')
  })

  it('pads single-digit months', () => {
    const result = offsetPeriod('2026-08', 1)
    expect(result).toBe('2026-09') // September, padded
  })
})

// ── clamp ─────────────────────────────────────────────────────────────────

describe('clamp', () => {
  it('clamps to min (0)', () => {
    expect(clamp(-10)).toBe(0)
  })

  it('clamps to max (100)', () => {
    expect(clamp(150)).toBe(100)
  })

  it('returns value within range', () => {
    expect(clamp(50)).toBe(50)
  })

  it('respects custom min/max', () => {
    expect(clamp(5, 10, 20)).toBe(10)
    expect(clamp(25, 10, 20)).toBe(20)
    expect(clamp(15, 10, 20)).toBe(15)
  })
})

// ── clamp — additional ────────────────────────────────────────────────────

describe('clamp — additional', () => {
  it('returns min when value equals min', () => {
    expect(clamp(0)).toBe(0)
  })

  it('returns max when value equals max', () => {
    expect(clamp(100)).toBe(100)
  })

  it('handles negative custom min', () => {
    expect(clamp(-5, -10, 10)).toBe(-5)
    expect(clamp(-15, -10, 10)).toBe(-10)
  })
})

// ── envelopeColorClass ────────────────────────────────────────────────────

describe('envelopeColorClass', () => {
  it('returns green when under 70%', () => {
    const result = envelopeColorClass(50, false)
    expect(result.bar).toBe('bg-green-500')
    expect(result.text).toBe('text-green-400')
  })

  it('returns amber when 70–99%', () => {
    const result = envelopeColorClass(80, false)
    expect(result.bar).toBe('bg-amber-500')
    expect(result.text).toBe('text-amber-400')
  })

  it('returns rose when overspent', () => {
    const result = envelopeColorClass(105, true)
    expect(result.bar).toBe('bg-rose-500')
    expect(result.text).toBe('text-rose-400')
  })

  it('returns rose when percent is 100 even without overspent flag', () => {
    const result = envelopeColorClass(100, false)
    expect(result.bar).toBe('bg-rose-500')
  })

  it('returns amber at exactly 70%', () => {
    const result = envelopeColorClass(70, false)
    expect(result.bar).toBe('bg-amber-500')
    expect(result.bg).toBe('bg-amber-500/10')
  })

  it('returns green at 69%', () => {
    const result = envelopeColorClass(69, false)
    expect(result.bar).toBe('bg-green-500')
  })

  it('isOverspent flag alone triggers rose even at 0%', () => {
    const result = envelopeColorClass(0, true)
    expect(result.bar).toBe('bg-rose-500')
  })

  it('returns all three CSS keys for every color', () => {
    for (const [pct, over] of [
      [50, false],
      [75, false],
      [105, true],
    ] as [number, boolean][]) {
      const result = envelopeColorClass(pct, over)
      expect(result).toHaveProperty('bar')
      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('bg')
    }
  })
})

// ── transactionStripeClass ────────────────────────────────────────────────

describe('transactionStripeClass', () => {
  it('returns green stripe for income', () => {
    expect(transactionStripeClass('income')).toContain('border-green-500')
  })

  it('returns muted stripe for expense', () => {
    expect(transactionStripeClass('expense')).toContain('border-l-[3px]')
    expect(transactionStripeClass('expense')).not.toContain('border-green-500')
  })

  it('returns dashed stripe for transfer', () => {
    expect(transactionStripeClass('transfer')).toContain('border-dashed')
  })
})

// ── transactionAmountClass / Prefix ──────────────────────────────────────

describe('transactionAmountClass', () => {
  it('income is green', () => {
    expect(transactionAmountClass('income')).toContain('text-green-400')
  })
  it('transfer is muted', () => {
    expect(transactionAmountClass('transfer')).toContain('text-(--ui-text-muted)')
  })
})

describe('transactionAmountPrefix', () => {
  it('income has + prefix', () => {
    expect(transactionAmountPrefix('income')).toBe('+')
  })
  it('expense has - prefix', () => {
    expect(transactionAmountPrefix('expense')).toBe('-')
  })
  it('transfer has no prefix', () => {
    expect(transactionAmountPrefix('transfer')).toBe('')
  })
})
