import { availableRowId, legacyRowId } from '~/lib/db-identity'
import type { DbAdapter } from '~/types/database'

/** Devices with the same retirement history choose the same natural-key generation. */
export async function nextNaturalRowId(
  db: Pick<DbAdapter, 'queryAll'>,
  table: string,
  key: string,
): Promise<string> {
  return availableRowId(db, table, await legacyRowId(table, `natural:${key}`))
}
