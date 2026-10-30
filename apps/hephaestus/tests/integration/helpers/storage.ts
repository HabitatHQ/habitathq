import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { StorageAdapter, TransactableStorageAdapter } from '@palladium/core'
import type { Database, SqlJsStatic } from 'sql.js'
import initSqlJs from 'sql.js'

const require = createRequire(import.meta.url)
let sqlite: Promise<SqlJsStatic> | undefined

function parameters(values: readonly unknown[]): Array<string | number | null | Uint8Array> {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      value instanceof Uint8Array
    )
      return value
    if (typeof value === 'boolean') return Number(value)
    throw new TypeError('Unsupported SQLite test parameter')
  })
}

function name(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid SQLite test identifier')
  return `"${value}"`
}

/** Real SQL execution, transactions, and row writes for the engine/backend integration seam. */
export async function createTestStorage(): Promise<TransactableStorageAdapter> {
  sqlite ??= initSqlJs({ wasmBinary: readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')) })
  const SQL = await sqlite
  let database: Database | undefined = new SQL.Database()
  const storage: TransactableStorageAdapter = {
    async open() {
      if (!database) throw new Error('Test storage is closed')
    },
    async exec<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (!database) throw new Error('Test storage is closed')
      const results = database.exec(sql, parameters(params))
      return results.flatMap((result) =>
        result.values.map(
          (row) =>
            Object.fromEntries(result.columns.map((column, index) => [column, row[index]])) as T,
        ),
      )
    },
    async put(table, id, data) {
      const columns = Object.keys(data)
      const assignments = columns
        .filter((column) => column !== 'id')
        .map((column) => `${name(column)}=excluded.${name(column)}`)
      await storage.exec(
        `INSERT INTO ${name(table)}(${columns.map(name).join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO ${assignments.length ? `UPDATE SET ${assignments.join(',')}` : 'NOTHING'}`,
        columns.map((column) => (column === 'id' ? id : data[column])),
      )
    },
    async patch(table, id, patch) {
      const columns = Object.keys(patch)
      if (!columns.length) return
      await storage.exec(
        `UPDATE ${name(table)} SET ${columns.map((column) => `${name(column)}=?`).join(',')} WHERE id=?`,
        [...columns.map((column) => patch[column]), id],
      )
    },
    async remove(table, id) {
      await storage.exec(`DELETE FROM ${name(table)} WHERE id=?`, [id])
    },
    async runMigrations(scripts) {
      for (const script of scripts) await storage.exec(script)
    },
    async close() {
      database?.close()
      database = undefined
    },
    async transaction<T>(work: (tx: StorageAdapter) => Promise<T>): Promise<T> {
      await storage.exec('BEGIN')
      try {
        const result = await work(storage)
        await storage.exec('COMMIT')
        return result
      } catch (error) {
        await storage.exec('ROLLBACK')
        throw error
      }
    },
  }
  return storage
}
