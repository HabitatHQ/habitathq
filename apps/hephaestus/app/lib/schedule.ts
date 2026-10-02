import type { TemplateRow } from '~/types/database'

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/** Convert JavaScript's Sunday=0 weekday to the persisted Monday=1…Sunday=7 contract. */
export function weekdayNumber(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay()
}

export function dayIndexToName(dayNum: number): string {
  return DAY_NAMES[dayNum - 1] ?? 'Unknown'
}

export function parseDaySchedule(json: string | null): number[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(
        parsed.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7),
      ),
    ]
  } catch {
    return []
  }
}

export function serialiseDaySchedule(days: number[]): string | null {
  const validDays = [
    ...new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)),
  ]
  return validDays.length === 0 ? null : JSON.stringify(validDays)
}

export function scheduledDaysForToday(days: string | null, today: Date): boolean {
  return parseDaySchedule(days).includes(weekdayNumber(today))
}

export function suggestTemplatesForToday(
  templates: (TemplateRow & { scheduled_days?: string | null })[],
  today: Date,
): typeof templates {
  return templates.filter((t) => scheduledDaysForToday(t.scheduled_days ?? null, today))
}
