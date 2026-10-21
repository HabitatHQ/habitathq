import type { DbAdapter as SqlDatabase } from '@palladium/core'
import {
  isJsonValue,
  isSyncRow,
  type PalladiumEngine,
  type SchemaMap,
  TxBuilder,
} from '@palladium/core'

/** Reads may use SQL; every domain write must pass through Palladium's transaction builder. */
export interface HabitatDatabase extends SqlDatabase {
  insert(table: string, data: Record<string, unknown>, ignoreExisting?: boolean): Promise<void>
  patchWhere(
    table: string,
    patch: Record<string, unknown>,
    where?: string,
    params?: unknown[],
  ): Promise<void>
  deleteWhere(table: string, where?: string, params?: unknown[]): Promise<void>
  transaction(work: (db: HabitatDatabase) => Promise<void>): Promise<void>
}

export const HABITAT_TABLES = [
  'habits',
  'habit_schedules',
  'completions',
  'habit_logs',
  'reminders',
  'checkin_entries',
  'checkin_templates',
  'checkin_questions',
  'checkin_responses',
  'checkin_reminders',
  'checkin_completions',
  'scribbles',
  'bored_categories',
  'bored_activities',
  'todos',
  'focus_sessions',
  'voice_notes',
  'image_notes',
] as const

const naturalKeys: Record<string, readonly string[]> = {
  completions: ['habit_id', 'date'],
  checkin_entries: ['entry_date'],
  checkin_responses: ['question_id', 'logged_date'],
  checkin_completions: ['template_id', 'date'],
}

export const HABITAT_RELATIONS = [
  ['habit_schedules', 'habit_id', 'habits'],
  ['completions', 'habit_id', 'habits'],
  ['habit_logs', 'habit_id', 'habits'],
  ['reminders', 'habit_id', 'habits'],
  ['checkin_questions', 'template_id', 'checkin_templates'],
  ['checkin_completions', 'template_id', 'checkin_templates'],
  ['checkin_reminders', 'template_id', 'checkin_templates'],
  ['checkin_responses', 'question_id', 'checkin_questions'],
  ['bored_activities', 'category_id', 'bored_categories'],
  ['focus_sessions', 'todo_id', 'todos'],
] as const

function assertTable(table: string): void {
  if (!HABITAT_TABLES.some((name) => name === table))
    throw new Error(`Unknown Habitat table: ${table}`)
}

/**
 * A batch prepares its reads against committed data, then submits one canonical
 * change. Callers must fetch results after the batch has committed. The worker
 * dispatch queue serializes local requests; Palladium serializes actual writes.
 */
export function toHabitatDatabase(engine: PalladiumEngine<SchemaMap>): HabitatDatabase {
  function database(builder?: TxBuilder<SchemaMap>): HabitatDatabase {
    async function write(work: (tx: TxBuilder<SchemaMap>) => void): Promise<void> {
      if (builder) work(builder)
      else await engine.tx(work)
    }
    const db: HabitatDatabase = {
      queryAll: (sql, bind) => engine.exec({ text: sql, params: bind ?? [], tables: [] }),
      async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
        const rows = await db.queryAll<T>(sql, bind)
        return rows[0] ?? null
      },
      async exec(sql, bind) {
        // Domain tables cannot escape change capture. Only device-local seed flags are writable here.
        if (
          !/^(?:INSERT OR IGNORE INTO applied_defaults\b|DELETE FROM (?:applied_defaults|_palladium_seeds)\s*$)/i.test(
            sql.trim(),
          )
        ) {
          throw new Error('Use Palladium mutations for Habitat data writes')
        }
        await engine.exec({ text: sql, params: bind ?? [], tables: [] })
      },
      async insert(table, data, ignoreExisting = false) {
        assertTable(table)
        if (!isSyncRow(data)) throw new TypeError(`Invalid replicated row for ${table}`)
        if (ignoreExisting) {
          for (const [child, foreignKey, parent] of HABITAT_RELATIONS) {
            if (child !== table || typeof data[foreignKey] !== 'string') continue
            const retiredParent = await db.queryAll<{ row_id: string }>(
              "SELECT row_id FROM _sync_row_meta WHERE tbl = ? AND row_id = ? AND col = '__palladium_deleted__'",
              [parent, data[foreignKey]],
            )
            // An older backup must not re-create children of a locally erased parent.
            if (retiredParent.length) return
          }
          const keys = naturalKeys[table] ?? ['id']
          const existing = await db.queryAll<{ id: string }>(
            `SELECT id FROM ${table} WHERE id = ? OR (${keys.map((key) => `${key} = ?`).join(' AND ')})`,
            [data.id, ...keys.map((key) => data[key])],
          )
          const pending = builder
            ?.build()
            .some(
              (op) =>
                op.type === 'insert' &&
                op.table === table &&
                (op.id === data.id || keys.every((key) => op.data[key] === data[key])),
            )
          if (existing.length || pending) return
          const retired = await db.queryAll<{ row_id: string }>(
            "SELECT row_id FROM _sync_row_meta WHERE tbl = ? AND row_id = ? AND col = '__palladium_deleted__'",
            [table, data.id],
          )
          // Merging an older backup must respect already replicated erasure.
          if (retired.length) return
        }
        await write((tx) => {
          tx.insert(table, data)
        })
      },
      async patchWhere(table, patch, where, params) {
        assertTable(table)
        if (!isJsonValue(patch) || Object.hasOwn(patch, 'id'))
          throw new TypeError('Invalid replicated patch')
        if (!Object.keys(patch).length) return
        const rows = await db.queryAll<{ id: string }>(
          `SELECT id FROM ${table}${where ? ` WHERE ${where}` : ''}`,
          params,
        )
        await write((tx) => {
          for (const row of rows) tx.update(table, row.id, patch)
        })
      },
      async deleteWhere(table, where, params) {
        assertTable(table)
        // Explicit child deletes persist tombstones; SQL cascades alone could allow stale remote updates to resurrect children.
        const rows = await db.queryAll<{ id: string }>(
          `SELECT id FROM ${table}${where ? ` WHERE ${where}` : ''}`,
          params,
        )
        const deletes = new TxBuilder<SchemaMap>()
        async function collect(parent: string, id: string): Promise<void> {
          for (const [child, foreignKey] of HABITAT_RELATIONS.filter(
            ([, , target]) => target === parent,
          )) {
            const children = await db.queryAll<{ id: string }>(
              `SELECT id FROM ${child} WHERE ${foreignKey} = ?`,
              [id],
            )
            for (const row of children) await collect(child, row.id)
          }
          if (parent === 'bored_categories') {
            const todos = await db.queryAll<{ id: string }>(
              'SELECT id FROM todos WHERE bored_category_id = ?',
              [id],
            )
            for (const todo of todos)
              deletes.update('todos', todo.id, { bored_category_id: null, show_in_bored: 0 })
          }
          deletes.delete(parent, id)
        }
        for (const row of rows) await collect(table, row.id)
        await write((tx) => {
          for (const op of deletes.build()) {
            if (op.type === 'delete') tx.delete(op.table, op.id)
            else if (op.type === 'update') tx.update(op.table, op.id, op.patch)
          }
        })
      },
      async transaction(work) {
        if (builder) throw new Error('Nested Habitat batches are not supported')
        const batch = new TxBuilder<SchemaMap>()
        await work(database(batch))
        await engine.tx((tx) => {
          for (const op of batch.build()) {
            if (op.type === 'insert') tx.insert(op.table, op.data)
            else if (op.type === 'update') tx.update(op.table, op.id, op.patch)
            else tx.delete(op.table, op.id)
          }
        })
      },
    }
    return db
  }
  return database()
}
