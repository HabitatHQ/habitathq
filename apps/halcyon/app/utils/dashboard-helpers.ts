import { differenceInCalendarDays, parseCalendarDate } from '@habitathq/utils'
import type { Contact } from '~/types/database'
import { nextBirthdayDate } from '~/utils/reminder-helpers'

export function daysUntilBirthday(birthday: string | null, today: string): number {
  if (!birthday) return Number.POSITIVE_INFINITY
  const next = nextBirthdayDate(birthday, today)
  return differenceInCalendarDays(next, today)
}

export function turningAge(birthday: string | null, today: string): number | null {
  if (!birthday) return null
  const next = nextBirthdayDate(birthday, today)
  const birthYear = parseCalendarDate(birthday).year
  const nextYear = parseCalendarDate(next).year
  return nextYear - birthYear
}

export interface BirthdayItem {
  contact: Contact
  days_away: number
  turning_age: number | null
}

export function upcomingBirthdays(
  contacts: Contact[],
  today: string,
  days: number,
): BirthdayItem[] {
  const items: BirthdayItem[] = []
  for (const contact of contacts) {
    if (!contact.birthday) continue
    const days_away = daysUntilBirthday(contact.birthday, today)
    if (days_away <= days) {
      items.push({ contact, days_away, turning_age: turningAge(contact.birthday, today) })
    }
  }
  return items.sort((a, b) => a.days_away - b.days_away)
}
