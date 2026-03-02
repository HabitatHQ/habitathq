import type { CheckinTemplate } from '~/types/database'

/** Full day names for schedule-label display. */
export const CHECKIN_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Abbreviated day labels for the day-picker UI. */
export const CHECKIN_DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

/** Short human-readable schedule label for a check-in template. */
export function checkinScheduleLabel(t: CheckinTemplate): string {
  if (t.schedule_type === 'DAILY') return 'Daily'
  if (t.schedule_type === 'MONTHLY') return 'Monthly'
  if (!t.days_active || t.days_active.length === 0) return 'Weekly'
  return `Weekly · ${t.days_active.map((d) => CHECKIN_DAY_NAMES[d]).join(', ')}`
}
