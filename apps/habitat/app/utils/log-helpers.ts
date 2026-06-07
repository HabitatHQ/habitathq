import type { HabitLog } from '~/types/database'

/** Total logged on the most recent day present in `rows` (0 if none). */
function latestDayTotal(rows: HabitLog[]): number {
  let latestDate = ''
  for (const l of rows) if (l.date > latestDate) latestDate = l.date
  return rows.filter((l) => l.date === latestDate).reduce((sum, l) => sum + l.value, 0)
}

/** Value of the most recently logged single entry in `rows` (0 if none). */
function latestEntryValue(rows: HabitLog[]): number {
  let latest: HabitLog | null = null
  for (const l of rows) if (!latest || l.logged_at > latest.logged_at) latest = l
  return latest ? latest.value : 0
}

/**
 * Smart default for the LogSheet: pre-fill the value the user most likely wants,
 * so routine logging is a confirm-and-go.
 *
 * - Absolute mode (you set the day's total): today's running total if any,
 *   otherwise the most recent past day's total.
 * - Incremental mode (you add an amount): the most recent single logged amount.
 * - Falls back to the habit's target (or 1 for incremental with no target).
 */
export function suggestedLogValue(opts: {
  logs: HabitLog[]
  habitId: string
  isAbsolute: boolean
  todaySum: number
  target: number
}): number {
  const { logs, habitId, isAbsolute, todaySum, target } = opts

  if (isAbsolute && todaySum > 0) return todaySum

  const rows = logs.filter((l) => l.habit_id === habitId)
  const fromHistory = isAbsolute ? latestDayTotal(rows) : latestEntryValue(rows)
  if (fromHistory > 0) return fromHistory

  if (target > 0) return target
  return isAbsolute ? 0 : 1
}
