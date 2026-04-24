import type { RecurringInterval } from './types'

/** Format a Date as YYYY-MM-DD using local time (avoids UTC offset issues) */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Project the next occurrence date from a last occurrence + interval */
export function projectNextOccurrence(lastDate: string, interval: RecurringInterval): string {
  const [year, month, day] = lastDate.split('-').map(Number) as [number, number, number]
  const d = new Date(year, month - 1, day)

  switch (interval) {
    case 'weekly':
      d.setDate(d.getDate() + 7)
      break
    case 'biweekly':
      d.setDate(d.getDate() + 14)
      break
    case 'monthly': {
      d.setMonth(d.getMonth() + 1)
      if (d.getDate() < day) d.setDate(0)
      break
    }
    case 'quarterly': {
      d.setMonth(d.getMonth() + 3)
      if (d.getDate() < day) d.setDate(0)
      break
    }
    case 'annual': {
      d.setFullYear(d.getFullYear() + 1)
      if (d.getDate() < day) d.setDate(0)
      break
    }
  }

  return toLocalDateStr(d)
}
