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

/**
 * Compact format for large amounts: "$12.4K", "$1.2M"
 */
export function formatCompact(amount: number, currency = 'USD'): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  const symbol = currency === 'USD' ? '$' : currency
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${symbol}${abs.toFixed(2)}`
}

// ── Date formatting ────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Get today's date as a local YYYY-MM-DD string (avoids UTC offset issues) */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Format a YYYY-MM-DD date string as a relative label.
 * Today → "Today" · Yesterday → "Yesterday" · This week → "Mon 3 Mar" · Older → "3 Mar 2025"
 */
export function formatDateRelative(dateStr: string): string {
  // Use local date string for "today" to avoid UTC offset issues
  const todayStr = localToday()
  const todayDate = new Date(`${todayStr}T00:00:00`)
  const yesterdayDate = new Date(todayDate)
  yesterdayDate.setDate(todayDate.getDate() - 1)
  const yesterdayStr = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`

  if (dateStr === todayStr) return 'Today'
  if (dateStr === yesterdayStr) return 'Yesterday'

  const date = new Date(`${dateStr}T00:00:00`)
  const diffDays = Math.floor((todayDate.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 7) {
    return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
  }
  if (date.getFullYear() === todayDate.getFullYear()) {
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/**
 * Format YYYY-MM as "March 2026"
 */
export function formatPeriod(period: string): string {
  const parts = period.split('-').map(Number)
  const year = parts[0]!
  const month = parts[1]!
  const fullMonths = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${fullMonths[month - 1]} ${year}`
}

/**
 * Get current period string "YYYY-MM"
 */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

/**
 * Navigate period by offset (+1 = next month, -1 = previous month)
 */
export function offsetPeriod(period: string, offset: number): string {
  const parts = period.split('-').map(Number)
  const date = new Date(parts[0]!, parts[1]! - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
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
