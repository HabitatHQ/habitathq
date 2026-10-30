import {
  isSyncRow,
  type Op,
  type SchemaMap,
  type StorageAdapter,
  type SyncRow,
} from '@palladium/core'
import { HEPHAESTUS_OWNED_TABLES } from '~/lib/database-reset'

const JOURNAL = '_palladium_hephaestus_changes'
const LOCAL_TABLES = new Set([
  'applied_defaults',
  'prescription_previews',
  'history_correction_previews',
  'routine_update_previews',
  'organization_reviews',
])

export const CAPTURED_TABLES = HEPHAESTUS_OWNED_TABLES.filter((table) => !LOCAL_TABLES.has(table))

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid capture identifier')
  return `"${value}"`
}

function rowJson(prefix: 'NEW' | 'OLD', columns: readonly string[]): string {
  return `json_object(${columns.map((column) => `'${column}',${prefix}.${identifier(column)}`).join(',')})`
}

async function installDeleteCapture(
  storage: StorageAdapter,
  table: string,
  oldRow: string,
): Promise<void> {
  await storage.exec(`CREATE TEMP TRIGGER ${identifier(`${JOURNAL}_${table}_delete`)}
    AFTER DELETE ON main.${identifier(table)} WHEN OLD.id IS NOT NULL BEGIN
      INSERT INTO ${JOURNAL}(table_name,row_id,before_json,after_json)
      VALUES('${table}',OLD.id,${oldRow},NULL);
    END`)
}

/** The caller's transaction restores these owned triggers if reset fails. */
export async function withoutDeleteCapture<T>(
  storage: StorageAdapter,
  work: () => Promise<T>,
): Promise<T> {
  for (const table of CAPTURED_TABLES) {
    await storage.exec(`DROP TRIGGER temp.${identifier(`${JOURNAL}_${table}_delete`)}`)
  }
  const result = await work()
  for (const table of CAPTURED_TABLES) {
    const columns = await storage.exec<{ name: string }>(`PRAGMA table_info(${identifier(table)})`)
    await installDeleteCapture(
      storage,
      table,
      rowJson(
        'OLD',
        columns.map((column) => column.name),
      ),
    )
  }
  return result
}

/** Connection-local capture follows SQLite's actual cascades, upserts, and savepoints. */
export async function installChangeCapture(storage: StorageAdapter): Promise<void> {
  await storage.exec('PRAGMA recursive_triggers = ON')
  await storage.exec(`CREATE TEMP TABLE ${JOURNAL} (
    seq INTEGER PRIMARY KEY,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT
  )`)
  for (const table of CAPTURED_TABLES) {
    const columns = await storage.exec<{ name: string }>(`PRAGMA table_info(${identifier(table)})`)
    if (!columns.some((column) => column.name === 'id')) {
      throw new Error(`Palladium identity migration is incomplete for ${table}`)
    }
    const oldRow = rowJson(
      'OLD',
      columns.map((column) => column.name),
    )
    const newRow = rowJson(
      'NEW',
      columns.map((column) => column.name),
    )
    await storage.exec(`CREATE TEMP TRIGGER ${identifier(`${JOURNAL}_${table}_insert`)}
      AFTER INSERT ON main.${identifier(table)} WHEN NEW.id IS NOT NULL BEGIN
        INSERT INTO ${JOURNAL}(table_name,row_id,before_json,after_json)
        VALUES('${table}',NEW.id,NULL,${newRow});
      END`)
    await installDeleteCapture(storage, table, oldRow)
    await storage.exec(`CREATE TEMP TRIGGER ${identifier(`${JOURNAL}_${table}_update`)}
      AFTER UPDATE ON main.${identifier(table)} WHEN NEW.id IS NOT NULL BEGIN
        INSERT INTO ${JOURNAL}(table_name,row_id,before_json,after_json)
        SELECT '${table}',OLD.id,${oldRow},NULL WHERE OLD.id IS NOT NULL AND OLD.id IS NOT NEW.id;
        INSERT INTO ${JOURNAL}(table_name,row_id,before_json,after_json)
        VALUES('${table}',NEW.id,CASE WHEN OLD.id IS NEW.id THEN ${oldRow} ELSE NULL END,${newRow});
      END`)
  }
}

export async function clearCapturedChanges(storage: StorageAdapter): Promise<void> {
  await storage.exec(`DELETE FROM ${JOURNAL}`)
}

function parseRow(json: string | null): SyncRow | null {
  if (json === null) return null
  const value: unknown = JSON.parse(json)
  if (!isSyncRow(value))
    throw new Error('Captured row does not have a canonical Palladium identity')
  return value
}

/** Only net effects become engine operations; rolled-back preview writes never escape. */
export async function collectCapturedChanges(storage: StorageAdapter): Promise<Op<SchemaMap>[]> {
  const changes = await storage.exec<{
    table_name: string
    row_id: string
    before_json: string | null
    after_json: string | null
  }>(`SELECT span.table_name,span.row_id,first.before_json,last.after_json
      FROM (SELECT table_name,row_id,MIN(seq) AS first_seq,MAX(seq) AS last_seq
            FROM ${JOURNAL} GROUP BY table_name,row_id) span
      JOIN ${JOURNAL} first ON first.seq=span.first_seq
      JOIN ${JOURNAL} last ON last.seq=span.last_seq
      ORDER BY span.first_seq`)
  const ops: Op<SchemaMap>[] = []
  for (const change of changes) {
    if (change.before_json === change.after_json) continue
    const before = parseRow(change.before_json)
    const after = parseRow(change.after_json)
    if ((before && before.id !== change.row_id) || (after && after.id !== change.row_id)) {
      throw new Error('Captured row identity changed unexpectedly')
    }
    if (after === null) {
      if (before !== null) ops.push({ type: 'delete', table: change.table_name, id: before.id })
    } else if (before === null) {
      ops.push({ type: 'insert', table: change.table_name, id: after.id, data: after })
    } else {
      const patch = Object.fromEntries(
        Object.entries(after).filter(
          ([column, value]) => column !== 'id' && before[column] !== value,
        ),
      )
      if (Object.keys(patch).length > 0) {
        ops.push({ type: 'update', table: change.table_name, id: after.id, patch })
      }
    }
  }
  await clearCapturedChanges(storage)
  return ops
}
