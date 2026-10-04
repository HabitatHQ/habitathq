import {
  addCalendarDays,
  differenceInCalendarDays,
  formatCalendarDate,
  localCalendarDate,
  parseCalendarDate,
} from '@habitathq/utils'

// ── Currency formatting ────────────────────────────────────────────────────

/**
 * Format a number as currency string: "$1,234.56"
 * Negative amounts include the minus sign: "-$87.43"
 */
export function formatCurrency(amount: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Format absolute value as currency (sign stripped — use for display where
 * the sign is conveyed by color/type indicator instead).
 */
export function formatAmount(amount: number, currency = 'USD'): string {
  return formatCurrency(Math.abs(amount), currency)
}

/**
 * Split a formatted currency string into whole and decimal parts.
 * Returns { whole: '$1,234', decimal: '.56' }
 */
export function splitCurrencyParts(
  amount: number,
  currency = 'USD',
): { whole: string; decimal: string } {
  const formatted = formatAmount(amount, currency)
  const dotIndex = formatted.lastIndexOf('.')
  if (dotIndex === -1) return { whole: formatted, decimal: '' }
  return {
    whole: formatted.slice(0, dotIndex),
    decimal: formatted.slice(dotIndex),
  }
}

/** Narrow currency symbol cache to avoid repeated Intl object creation */
const symbolCache = new Map<string, string>()

export function getCurrencySymbol(currency: string): string {
  const cached = symbolCache.get(currency)
  if (cached) return cached
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    const sym = parts.find((p) => p.type === 'currency')?.value ?? currency
    symbolCache.set(currency, sym)
    return sym
  } catch {
    symbolCache.set(currency, currency)
    return currency
  }
}

/**
 * Compact format for large amounts: "$12.4K", "€1.2M"
 */
export function formatCompact(amount: number, currency = 'USD'): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  const symbol = getCurrencySymbol(currency)
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${symbol}${abs.toFixed(2)}`
}

/**
 * Format an amount with optional home-currency annotation for foreign transactions.
 */
export function formatWithHomeEquiv(
  amount: number,
  currency: string,
  homeAmount: number | null,
  homeCurrency: string,
): { primary: string; annotation: string | null } {
  const primary = formatAmount(amount, currency)
  if (currency === homeCurrency || homeAmount == null) return { primary, annotation: null }
  return { primary, annotation: `≈ ${formatAmount(homeAmount, homeCurrency)}` }
}

// ── Hearth date-label policy ───────────────────────────────────────────────

/**
 * Format a transaction calendar date using Hearth's established labels.
 * Today → "Today" · Yesterday → "Yesterday" · Within 7 days → "Mon 3 Mar"
 * · Same year → "3 Mar" · Older → "3 Mar 2025"
 */
export function formatHearthDateLabel(dateStr: string): string {
  const today = localCalendarDate()
  const daysAgo = differenceInCalendarDays(today, dateStr)

  if (dateStr === today) return 'Today'
  if (dateStr === addCalendarDays(today, -1)) return 'Yesterday'
  if (daysAgo < 7) {
    return formatCalendarDate(dateStr, {
      locale: 'en-GB',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).replace(',', '')
  }

  const { year } = parseCalendarDate(dateStr)
  const { year: currentYear } = parseCalendarDate(today)
  return formatCalendarDate(dateStr, {
    locale: 'en-GB',
    day: 'numeric',
    month: 'short',
    ...(year === currentYear ? {} : { year: 'numeric' }),
  })
}

// ── Percentage helpers ─────────────────────────────────────────────────────

/**
 * Clamp a value to [0, max]
 */
export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Get the envelope color class based on spending percentage.
 * < 70% used → green · 70–100% → amber · overspent → rose
 */
export function envelopeColorClass(
  percentUsed: number,
  isOverspent: boolean,
): {
  bar: string
  text: string
  bg: string
} {
  if (isOverspent || percentUsed >= 100) {
    return { bar: 'bg-rose-500', text: 'text-rose-400', bg: 'bg-rose-500/10' }
  }
  if (percentUsed >= 70) {
    return { bar: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/10' }
  }
  return { bar: 'bg-green-500', text: 'text-green-400', bg: 'bg-green-500/10' }
}

/**
 * Transaction type → left stripe CSS classes
 */
export function transactionStripeClass(type: 'expense' | 'income' | 'transfer'): string {
  if (type === 'income') return 'border-l-[3px] border-green-500'
  if (type === 'transfer') return 'border-l-[3px] border-dashed border-(--ui-border-accented)'
  return 'border-l-[3px] border-(--ui-border-accented)'
}

/**
 * Transaction amount display: sign + color class
 */
export function transactionAmountClass(type: 'expense' | 'income' | 'transfer'): string {
  if (type === 'income') return 'text-green-400 font-mono'
  if (type === 'transfer') return 'text-(--ui-text-muted) font-mono'
  return 'text-(--ui-text) font-mono'
}

export function transactionAmountPrefix(type: 'expense' | 'income' | 'transfer'): string {
  if (type === 'income') return '+'
  if (type === 'transfer') return ''
  return '-'
}
