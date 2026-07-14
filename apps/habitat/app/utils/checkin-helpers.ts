import type { CheckinTemplate } from '~/types/database'

/** Full day names for schedule-label display. */
export const CHECKIN_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Abbreviated day labels for the day-picker UI. */
export const CHECKIN_DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

/** Ordinal form of a day number, e.g. 1 → "1st", 22 → "22nd". */
export function ordinalDay(n: number): string {
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** Short human-readable schedule label for a check-in template. */
export function checkinScheduleLabel(t: CheckinTemplate): string {
  if (t.schedule_type === 'DAILY') return 'Daily'
  if (t.schedule_type === 'MONTHLY') {
    const day = t.days_active?.[0]
    return day ? `Monthly · ${ordinalDay(day)}` : 'Monthly'
  }
  if (!t.days_active || t.days_active.length === 0) return 'Weekly'
  return `Weekly · ${t.days_active.map((d) => CHECKIN_DAY_NAMES[d]).join(', ')}`
}
