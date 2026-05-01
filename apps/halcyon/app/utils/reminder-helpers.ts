import type { Reminder, StayInTouch } from '~/types/database'

/** True when a reminder is due today (and not done) */
export function isReminderDue(reminder: Reminder, today: string): boolean {
  return !reminder.is_done && reminder.remind_at === today
}

/** True when a reminder is past due and not done */
export function isReminderOverdue(reminder: Reminder, today: string): boolean {
  return !reminder.is_done && reminder.remind_at < today
}

/** True when a reminder falls within the next N days */
export function isDueWithinDays(reminder: Reminder, today: string, days: number): boolean {
  if (reminder.is_done) return false
  const due = new Date(reminder.remind_at)
  const from = new Date(today)
  const to = new Date(today)
  to.setDate(to.getDate() + days)
  return due >= from && due <= to
}

/**
 * For yearly reminders: returns the date of the next occurrence.
 * For one-off reminders: returns the remind_at unchanged.
 */
export function computeNextRemindAt(reminder: Reminder, today: string): string {
  if (!reminder.is_yearly) return reminder.remind_at

  const parts = reminder.remind_at.split('-')
  const monthDay = `${parts[1]}-${parts[2]}`
  const currentYear = new Date(today).getFullYear()
  const thisYear = `${currentYear}-${monthDay}`

  if (thisYear >= today) return thisYear

  return `${currentYear + 1}-${monthDay}`
}

/**
 * Next occurrence of a birthday given today.
 * birthday: "YYYY-MM-DD" (full birth date)
 */
export function nextBirthdayDate(birthday: string, today: string): string {
  const parts = birthday.split('-')
  const month = parts[1]!
  const day = parts[2]!
  const currentYear = new Date(today).getFullYear()
  const thisYear = `${currentYear}-${month}-${day}`

  if (thisYear >= today) return thisYear
  return `${currentYear + 1}-${month}-${day}`
}

/**
 * Compute the next_remind_at date for a stay-in-touch record.
 * Returns YYYY-MM-DD.
 */
export function stayInTouchNextDate(
  sit: Pick<StayInTouch, 'frequency_days' | 'last_contacted_at'>,
): string {
  if (!sit.last_contacted_at) {
    return new Date().toISOString().slice(0, 10)
  }
  const base = new Date(sit.last_contacted_at)
  base.setDate(base.getDate() + sit.frequency_days)
  return base.toISOString().slice(0, 10)
}
