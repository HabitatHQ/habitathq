import type { TemplateRow } from '~/types/database'

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export function dayIndexToName(index: number): string {
  return DAY_NAMES[index] ?? 'Unknown'
}

export function parseDaySchedule(json: string | null): number[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed as number[]
    return []
  } catch {
    return []
  }
}

export function serialiseDaySchedule(days: number[]): string | null {
  if (days.length === 0) return null
  return JSON.stringify(days)
}

export function scheduledDaysForToday(days: string | null, today: Date): boolean {
  const parsed = parseDaySchedule(days)
  if (parsed.length === 0) return false
  return parsed.includes(today.getDay())
}

export function suggestTemplatesForToday(
  templates: (TemplateRow & { scheduled_days?: string | null })[],
  today: Date,
): typeof templates {
  return templates.filter((t) => scheduledDaysForToday(t.scheduled_days ?? null, today))
}
