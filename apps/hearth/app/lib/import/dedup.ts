interface ImportRow {
  date: string
  amount: number
  merchant: string
}

/**
 * Find indices of duplicate rows in incoming data.
 * Strict matching: all of (date, amount, merchant normalized) must match.
 */
export function findDuplicates(incoming: ImportRow[], existing: ImportRow[]): Set<number> {
  const existingKeys = new Set(
    existing.map((t) => `${t.date}|${t.amount}|${t.merchant.toLowerCase().trim()}`),
  )

  const dupes = new Set<number>()
  for (let i = 0; i < incoming.length; i++) {
    const row = incoming[i]!
    const key = `${row.date}|${row.amount}|${row.merchant.toLowerCase().trim()}`
    if (existingKeys.has(key)) {
      dupes.add(i)
    }
  }

  return dupes
}
