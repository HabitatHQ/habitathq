import { localDateString } from '@habitathq/utils'

export function legacyUtcKeysForLocalDay(date: Date): string[] {
  const localDay = localDateString(date)
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  end.setMilliseconds(end.getMilliseconds() - 1)
  return [...new Set([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)])].filter(
    (key) => key !== localDay,
  )
}

export async function getTodayRowsWithLegacyUtcKeys<T extends { date: string }>(
  getForDate: (date: string) => Promise<T[]>,
  today: string,
  legacyUtcKeys: readonly string[],
  recordedAt: (row: T) => string,
): Promise<T[]> {
  const localRows = await getForDate(today)
  const legacyCandidates = (await Promise.all(legacyUtcKeys.map((key) => getForDate(key)))).flat()
  const legacyRows = legacyCandidates.filter((row) => {
    const timestamp = new Date(recordedAt(row))
    return (
      !Number.isNaN(timestamp.valueOf()) &&
      timestamp.toISOString().slice(0, 10) === row.date &&
      localDateString(timestamp) === today
    )
  })
  return [...localRows, ...legacyRows]
}

// Normalize only Today's in-memory history view; persisted date keys stay untouched.
export function mergeTodayIntoHistory<T extends { id: string; date: string }>(
  rangeRows: T[],
  todayRows: T[],
  today: string,
): T[] {
  const todayIds = new Set(todayRows.map((row) => row.id))
  return [
    ...rangeRows.filter((row) => !todayIds.has(row.id)),
    ...todayRows.map((row) => ({ ...row, date: today })),
  ]
}
