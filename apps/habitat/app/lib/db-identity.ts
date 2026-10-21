import { safeJsonParse } from '@habitathq/utils'
import {
  type BlobAdapter,
  isUuidV7,
  type StorageAdapter,
  type TransactableStorageAdapter,
} from '@palladium/core'
import type { HabitatDatabase } from '~/lib/palladium-database'
import { HABITAT_RELATIONS, HABITAT_TABLES } from '~/lib/palladium-database'
import type { HabitatExport } from '~/types/database'

/** Stable UUIDv7 identity for legacy rows; the timestamp is the migration epoch. */
export async function legacyRowId(table: string, id: string): Promise<string> {
  if (isUuidV7(id)) return id
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`habitat:${table}:${id}`),
  )
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
  return `019b76da-a800-7${hash.slice(0, 3)}-8${hash.slice(3, 6)}-${hash.slice(6, 18)}`
}

export async function availableRowId(
  read: Pick<HabitatDatabase, 'queryAll'>,
  table: string,
  candidate: string,
): Promise<string> {
  let id = candidate
  while (
    (
      await read.queryAll<{ row_id: string }>(
        "SELECT row_id FROM _sync_row_meta WHERE tbl = ? AND row_id = ? AND col = '__palladium_deleted__'",
        [table, id],
      )
    ).length > 0
  ) {
    id = await legacyRowId(table, `successor:${id}`)
  }
  return id
}

type LegacyRow = { id: string; [column: string]: unknown }
const DEFAULT_TEMPLATES = new Set(['Morning Check-in', 'Evening Reflection', 'Weekly Review'])

function naturalKey(table: string, row: LegacyRow): string | undefined {
  if (table === 'completions') return `${row['habit_id']}:${row['date']}`
  if (table === 'checkin_entries') return String(row['entry_date'])
  if (table === 'checkin_responses') return `${row['question_id']}:${row['logged_date']}`
  if (table === 'checkin_completions') return `${row['template_id']}:${row['date']}`
  return undefined
}

async function migrationId(tx: StorageAdapter, table: string, row: LegacyRow): Promise<string> {
  if (isUuidV7(row.id)) return row.id
  const natural = naturalKey(table, row)
  if (natural !== undefined) return legacyRowId(table, `natural:${natural}`)
  if (
    table === 'checkin_templates' &&
    typeof row['title'] === 'string' &&
    DEFAULT_TEMPLATES.has(row['title'])
  )
    return legacyRowId(table, `seed:${row['title']}`)
  if (table === 'checkin_questions') {
    const parents = await tx.exec<{ title: string }>(
      'SELECT title FROM checkin_templates WHERE id = ?',
      [row['template_id']],
    )
    if (DEFAULT_TEMPLATES.has(parents[0]?.title ?? ''))
      return legacyRowId(table, `seed:${row['template_id']}:${row['prompt']}`)
  }
  if (table === 'bored_activities') {
    const parents = await tx.exec<{ is_system: number }>(
      'SELECT is_system FROM bored_categories WHERE id = ?',
      [row['category_id']],
    )
    if (parents[0]?.is_system === 1)
      return legacyRowId(table, `seed:${row['category_id']}:${row['title']}`)
  }
  return legacyRowId(table, row.id)
}

async function migrateRow(
  tx: StorageAdapter,
  table: string,
  row: LegacyRow,
  blobs?: BlobAdapter,
): Promise<void> {
  const candidate = await migrationId(tx, table, row)
  let id =
    candidate === row.id
      ? candidate
      : await availableRowId({ queryAll: (sql, bind) => tx.exec(sql, bind) }, table, candidate)
  if (id === row.id) return
  const collision = await tx.exec<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [id])
  if (collision.length) {
    // Prompts/titles were never unique. Only one matching legacy row can use
    // the shared seed identity; preserve additional rows under their own IDs.
    id = await availableRowId(
      { queryAll: (sql, bind) => tx.exec(sql, bind) },
      table,
      await legacyRowId(table, row.id),
    )
  }
  if (blobs && (table === 'voice_notes' || table === 'image_notes')) {
    const bytes = await blobs.get(row.id)
    if (bytes) await blobs.put(id, bytes)
  }
  await tx.exec(`UPDATE ${table} SET id = ? WHERE id = ?`, [id, row.id])
  for (const [child, column] of HABITAT_RELATIONS.filter(([, , parent]) => parent === table)) {
    await tx.exec(`UPDATE ${child} SET ${column} = ? WHERE ${column} = ?`, [id, row.id])
  }
  if (table === 'bored_categories')
    await tx.exec('UPDATE todos SET bored_category_id = ? WHERE bored_category_id = ?', [
      id,
      row.id,
    ])
  await tx.exec(
    'INSERT OR REPLACE INTO _habitat_legacy_ids (table_name, legacy_id, id) VALUES (?, ?, ?)',
    [table, row.id, id],
  )
}

function linkedJot(annotations: unknown): { id: string; table: string } | null {
  if (annotations === null || typeof annotations !== 'object' || Array.isArray(annotations))
    return null
  const id: unknown = Reflect.get(annotations, 'linked_jot_id')
  const kind: unknown = Reflect.get(annotations, 'linked_jot_kind')
  if (typeof id !== 'string') return null
  const table = kind === 'voice' ? 'voice_notes' : kind === 'image' ? 'image_notes' : 'scribbles'
  return { id, table }
}

async function migrateJotLinks(tx: StorageAdapter): Promise<void> {
  const todos = await tx.exec<{ id: string; annotations: string }>(
    'SELECT id, annotations FROM todos',
  )
  for (const todo of todos) {
    const annotations: unknown = safeJsonParse(todo.annotations, null)
    const link = linkedJot(annotations)
    if (!link || typeof annotations !== 'object' || annotations === null) continue
    const matches = await tx.exec<{ id: string }>(
      'SELECT id FROM _habitat_legacy_ids WHERE legacy_id = ? AND table_name = ?',
      [link.id, link.table],
    )
    if (!matches[0]) continue
    Reflect.set(annotations, 'linked_jot_id', matches[0].id)
    await tx.exec('UPDATE todos SET annotations = ? WHERE id = ?', [
      JSON.stringify(annotations),
      todo.id,
    ])
  }
}

/** Blob copies precede the atomic SQL migration and retain old keys for safe retry. */
export async function migrateLegacyIds(
  storage: TransactableStorageAdapter,
  blobs?: BlobAdapter,
): Promise<void> {
  await storage.exec(
    'CREATE TABLE IF NOT EXISTS _habitat_legacy_ids (table_name TEXT NOT NULL, legacy_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(table_name, legacy_id))',
  )
  await storage.transaction(async (tx) => {
    await tx.exec('PRAGMA defer_foreign_keys = ON')
    for (const table of HABITAT_TABLES) {
      const rows = await tx.exec<LegacyRow>(`SELECT * FROM ${table}`)
      for (const row of rows) await migrateRow(tx, table, row, blobs)
    }
    await migrateJotLinks(tx)
  })
}

type ResolveId = (table: string, id: string, fallback?: string) => Promise<string> | string

async function normalizeRow(
  table: string,
  row: LegacyRow,
  resolve: ResolveId,
  read: Pick<HabitatDatabase, 'queryAll'>,
): Promise<void> {
  const natural = naturalKey(table, row)
  row.id =
    natural === undefined
      ? await resolve(table, row.id)
      : await availableRowId(read, table, await resolve(table, row.id, `natural:${natural}`))
  if (table === 'todos' && typeof row['bored_category_id'] === 'string')
    row['bored_category_id'] = await resolve('bored_categories', row['bored_category_id'])
  if (table === 'todos') {
    const annotations: unknown = row['annotations']
    const link = linkedJot(annotations)
    if (link && annotations !== null && typeof annotations === 'object')
      Reflect.set(annotations, 'linked_jot_id', await resolve(link.table, link.id))
  }
}

/** JSON exports keep their public format while old identities become sync-safe. */
export async function normalizeImportIds(
  data: HabitatExport,
  read: Pick<HabitatDatabase, 'queryAll'>,
): Promise<HabitatExport> {
  const mappings = await read.queryAll<{ table_name: string; legacy_id: string; id: string }>(
    'SELECT table_name, legacy_id, id FROM _habitat_legacy_ids',
  )
  const known = new Map(mappings.map((row) => [`${row.table_name}:${row.legacy_id}`, row.id]))
  const resolve: ResolveId = (table, id, fallback) =>
    known.get(`${table}:${id}`) ?? legacyRowId(table, fallback ?? id)
  const normalized = structuredClone(data)
  for (const table of HABITAT_TABLES) {
    const rows: unknown = Reflect.get(normalized, table)
    if (!Array.isArray(rows)) continue
    for (const value of rows) {
      if (
        value === null ||
        typeof value !== 'object' ||
        !('id' in value) ||
        typeof value.id !== 'string'
      )
        throw new TypeError(`Invalid import row for ${table}`)
      const row: LegacyRow = value
      const originalId = row.id
      // Parent identities must be resolved before deriving a child's natural key.
      for (const [, column, parent] of HABITAT_RELATIONS.filter(([child]) => child === table)) {
        if (typeof row[column] === 'string') row[column] = await resolve(parent, row[column])
      }
      await normalizeRow(table, row, resolve, read)
      known.set(`${table}:${originalId}`, row.id)
    }
  }
  return normalized
}
