import {
  addCalendarDays,
  compareCalendarDates,
  localCalendarDate,
  parseCalendarDate,
} from '@habitathq/utils'
import type { Reminder, StayInTouch } from '~/types/database'

/** True when a reminder is due today (and not done) */
export function isReminderDue(reminder: Reminder, today: string): boolean {
  return !reminder.is_done && compareCalendarDates(reminder.remind_at, today) === 0
}

/** True when a reminder is past due and not done */
export function isReminderOverdue(reminder: Reminder, today: string): boolean {
  return !reminder.is_done && compareCalendarDates(reminder.remind_at, today) < 0
}

/** True when a reminder falls within the next N days */
export function isDueWithinDays(reminder: Reminder, today: string, days: number): boolean {
  if (reminder.is_done) return false
  const until = addCalendarDays(today, days)
  return (
    compareCalendarDates(reminder.remind_at, today) >= 0 &&
    compareCalendarDates(reminder.remind_at, until) <= 0
  )
}

/**
 * For yearly reminders: returns the date of the next occurrence.
 * For one-off reminders: returns the remind_at unchanged.
 */
export function computeNextRemindAt(reminder: Reminder, today: string): string {
  if (!reminder.is_yearly) return reminder.remind_at

  parseCalendarDate(reminder.remind_at)
  const { year: currentYear } = parseCalendarDate(today)
  const monthDay = reminder.remind_at.slice(5)
  const thisYear = `${currentYear}-${monthDay}`

  if (monthDay >= today.slice(5)) return thisYear

  return `${currentYear + 1}-${monthDay}`
}

/**
 * Next occurrence of a birthday given today.
 * birthday: "YYYY-MM-DD" (full birth date)
 */
export function nextBirthdayDate(birthday: string, today: string): string {
  parseCalendarDate(birthday)
  const { year: currentYear } = parseCalendarDate(today)
  const monthDay = birthday.slice(5)
  const thisYear = `${currentYear}-${monthDay}`

  if (monthDay >= today.slice(5)) return thisYear
  return `${currentYear + 1}-${monthDay}`
}

/**
 * Compute the next_remind_at date for a stay-in-touch record.
 * Returns YYYY-MM-DD.
 */
export function stayInTouchNextDate(
  sit: Pick<StayInTouch, 'frequency_days' | 'last_contacted_at'>,
): string {
  if (!sit.last_contacted_at) return localCalendarDate()

  const lastContactedDate = localCalendarDate(new Date(sit.last_contacted_at))
  return addCalendarDays(lastContactedDate, sit.frequency_days)
}
