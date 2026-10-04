/** Add calendar days to a date-only key without DST or local-time arithmetic. */
export function addDateKeyDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day! + days))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/** Inclusive ascending sequence of date-only keys. */
export function dateKeysBetween(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = addDateKeyDays(date, 1)) dates.push(date)
  return dates
}

/** Signed number of calendar days from `from` to `to`, independent of DST. */
export function calendarDayDifference(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number)
  const [toYear, toMonth, toDay] = to.split('-').map(Number)
  return (
    (Date.UTC(toYear!, toMonth! - 1, toDay!) - Date.UTC(fromYear!, fromMonth! - 1, fromDay!)) /
    86_400_000
  )
}
