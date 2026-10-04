import { addCalendarDays, parseCalendarDate } from '@habitathq/utils'

import type { RecurringInterval } from './types'

/** Project the next occurrence date from a last occurrence + interval */
export function projectNextOccurrence(lastDate: string, interval: RecurringInterval): string {
  const { year, month, day } = parseCalendarDate(lastDate)
  if (interval === 'weekly') return addCalendarDays(lastDate, 7)
  if (interval === 'biweekly') return addCalendarDays(lastDate, 14)
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  const monthOffset = interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : 12
  d.setUTCMonth(d.getUTCMonth() + monthOffset)
  if (d.getUTCDate() < day) d.setUTCDate(0)
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
