import type { DbAdapter as SqlDatabase } from '@palladium/core'
import type { HabitatDatabase } from '~/lib/palladium-database'

/** Legacy SQL fixtures exercise domain behavior while the integration tests use the real engine. */
export function withMutations(sql: SqlDatabase): HabitatDatabase {
  const db: HabitatDatabase = {
    queryAll: (text, bind) => sql.queryAll(text, bind),
    queryOne: (text, bind) => sql.queryOne(text, bind),
    exec: (text, bind) => sql.exec(text, bind),
    async insert(table, data, ignoreExisting) {
      const keys = Object.keys(data)
      await sql.exec(
        `INSERT${ignoreExisting ? ' OR IGNORE' : ''} INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(',')})`,
        Object.values(data),
      )
    },
    async patchWhere(table, patch, where, bind = []) {
      const pairs = Object.entries(patch)
      await sql.exec(
        `UPDATE ${table} SET ${pairs.map(([key]) => `${key} = ?`).join(', ')}${where ? ` WHERE ${where}` : ''}`,
        [...pairs.map(([, value]) => value), ...bind],
      )
    },
    async deleteWhere(table, where, bind) {
      await sql.exec(`DELETE FROM ${table}${where ? ` WHERE ${where}` : ''}`, bind)
    },
    async transaction(work) {
      await sql.exec('BEGIN')
      try {
        await work(db)
        await sql.exec('COMMIT')
      } catch (error) {
        await sql.exec('ROLLBACK')
        throw error
      }
    },
  }
  return db
}
