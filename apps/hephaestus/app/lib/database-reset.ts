import type { DbAdapter } from '~/types/database'

const RESERVED_TABLE_PREFIXES = ['sqlite_', '_palladium', 'palladium_', '_sync_']

function isAppTable(name: string): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
    !RESERVED_TABLE_PREFIXES.some((prefix) => name.startsWith(prefix))
  )
}

export async function resetAppDatabase(db: DbAdapter): Promise<void> {
  const tables = await db.queryAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  )
  const appTables = tables.map(({ name }) => name).filter(isAppTable)
  await db.transaction(async (tx) => {
    await tx.exec('PRAGMA defer_foreign_keys = ON')
    for (const table of appTables) await tx.exec(`DELETE FROM "${table}"`)
  })
}
