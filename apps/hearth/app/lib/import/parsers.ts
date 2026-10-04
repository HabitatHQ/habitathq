import { isCalendarDate } from '@habitathq/utils'

export function parseImportDate(raw: string): string | null {
  let year: number
  let month: number
  let day: number
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const shortYear = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else if (mdy || shortYear) {
    const parts = mdy ?? shortYear
    if (!parts) return null
    month = Number(parts[1])
    day = Number(parts[2])
    const parsedYear = Number(parts[3])
    const yearPart = parts[3]
    if (!yearPart) return null
    year =
      yearPart.length === 2 ? (parsedYear > 50 ? 1900 + parsedYear : 2000 + parsedYear) : parsedYear
  } else {
    return null
  }

  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isCalendarDate(date) ? date : null
}

export function parseImportAmount(raw: string): number | null {
  const value = raw.trim()
  const negative = value.startsWith('(') && value.endsWith(')')
  const unwrapped = negative ? value.slice(1, -1) : value
  const currencySymbol = /^(?:[$€£¥₹])?(.*?)(?:[$€£¥₹])?$/.exec(unwrapped)
  const cleaned = currencySymbol?.[1]?.replace(/\s/g, '') ?? ''
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(cleaned)) return null
  if (negative && /^[+-]/.test(cleaned)) return null
  const amount = Number(cleaned.replace(/,/g, ''))
  if (!Number.isFinite(amount)) return null
  return negative ? -amount : amount
}
