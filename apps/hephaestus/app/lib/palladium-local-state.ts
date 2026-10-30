import { isSyncRow, type Op, type SchemaMap, type StorageAdapter } from '@palladium/core'
import { CAPTURED_TABLES } from '~/lib/sql-change-capture'

export async function forgetRowMetadata(storage: StorageAdapter): Promise<void> {
  const placeholders = CAPTURED_TABLES.map(() => '?').join(',')
  for (const table of ['_sync_row_meta', '_sync_pending_remote_updates']) {
    await storage.exec(`DELETE FROM ${table} WHERE tbl IN (${placeholders})`, CAPTURED_TABLES)
  }
}

/** Existing rows are admitted without replaying immutable revision inserts. */
export async function untrackedRows(
  storage: StorageAdapter,
  table: string,
  limit?: number,
): Promise<Op<SchemaMap>[]> {
  if (!CAPTURED_TABLES.some((candidate) => candidate === table))
    throw new Error('Unknown app table')
  const rows = await storage.exec<Record<string, unknown>>(
    `SELECT data.* FROM "${table}" data WHERE NOT EXISTS
      (SELECT 1 FROM _sync_row_meta meta WHERE meta.tbl=? AND meta.row_id=data.id)
      ${limit === undefined ? '' : 'LIMIT ?'}`,
    limit === undefined ? [table] : [table, limit],
  )
  return rows.map((row) => {
    if (!isSyncRow(row)) throw new Error(`Invalid Palladium identity in ${table}`)
    return { type: 'insert', table, id: row.id, data: row }
  })
}
