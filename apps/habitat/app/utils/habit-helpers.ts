import type { HabitWithSchedule } from '~/types/database'

export const HABIT_DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

/** Short human-readable schedule label for a habit (e.g. "Daily", "3×/week", "Mo We Fr"). */
export function habitScheduleLabel(habit: HabitWithSchedule): string {
  const sched = habit.schedule
  if (!sched || sched.schedule_type === 'DAILY') return 'Daily'
  if (sched.schedule_type === 'WEEKLY_FLEX') return `${sched.frequency_count ?? 1}×/week`
  if (sched.schedule_type === 'SPECIFIC_DAYS') {
    return (sched.days_of_week ?? []).map((d) => HABIT_DAY_LABELS[d]).join(' ')
  }
  return 'Daily'
}

/** Convert an array of key/value entry objects into a plain record. */
export function buildAnnotations(
  entries: { key: string; value: string }[],
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const { key, value } of entries) {
    if (key.trim()) result[key.trim()] = value
  }
  return result
}
