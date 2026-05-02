/**
 * SQLite OPFS SAH Pool adapter implementing palladium's StorageAdapter.
 *
 * Uses the high-performance OPFS Synchronous Access Handle pool VFS
 * (installOpfsSAHPoolVfs) instead of the basic OpfsDb. Also exposes
 * serialize() for binary DB export via sqlite3_serialize FFI.
 */
import type { StorageAdapter } from '@palladium/core'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

export interface SahPoolConfig {
  readonly directory: string
  readonly filename: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sqlite-wasm types are incomplete
type Sqlite3Db = any

export class SahPoolAdapter implements StorageAdapter {
  readonly #config: SahPoolConfig
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #sqlite3: any = null
  #db: Sqlite3Db = null

  constructor(config: SahPoolConfig) {
    this.#config = config
  }

  async open(): Promise<void> {
    // @ts-expect-error — sqlite-wasm types omit the optional config argument
    this.#sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} })

    const poolUtil = await this.#sqlite3.installOpfsSAHPoolVfs({
      directory: this.#config.directory,
      clearOnInit: false,
    })
    this.#db = new poolUtil.OpfsSAHPoolDb(this.#config.filename)
    this.#db.exec('PRAGMA foreign_keys = ON')
  }

  get #database(): Sqlite3Db {
    if (!this.#db) throw new Error('SahPoolAdapter: call open() before using the adapter.')
    return this.#db
  }

  async exec<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    const rows: T[] = []
    this.#database.exec({
      sql,
      ...(params !== undefined && { bind: params as unknown[] }),
      rowMode: 'object',
      callback: (row: Record<string, unknown>) => rows.push({ ...row } as T),
    })
    return rows
  }

  async put(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    assertIdentifier(table)
    const keys = Object.keys(data)
    const cols = keys.map(assertIdentifier).join(', ')
    const placeholders = keys.map(() => '?').join(', ')
    this.#database.exec({
      sql: `INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${placeholders})`,
      bind: [id, ...Object.values(data)],
    })
  }

  async patch(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
    assertIdentifier(table)
    const entries = Object.entries(patch)
    if (entries.length === 0) return
    const sets = entries.map(([k]) => `${assertIdentifier(k)} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    this.#database.exec({ sql: `UPDATE ${table} SET ${sets} WHERE id = ?`, bind: [...values, id] })
  }

  async remove(table: string, id: string): Promise<void> {
    assertIdentifier(table)
    this.#database.exec({ sql: `DELETE FROM ${table} WHERE id = ?`, bind: [id] })
  }

  async runMigrations(migrations: readonly string[]): Promise<void> {
    for (const sql of migrations) {
      this.#database.exec(sql)
    }
  }

  async close(): Promise<void> {
    if (this.#db) {
      this.#db.close()
      this.#db = null
    }
  }

  /**
   * Serialize the live database to a Uint8Array via sqlite3_serialize FFI.
   * OpfsSAHPoolDb doesn't expose OO1's serialize(), so we go through wasm.
   */
  serialize(): Uint8Array {
    if (!this.#sqlite3 || !this.#db) throw new Error('SahPoolAdapter: not open')
    const w = this.#sqlite3.wasm
    const c = this.#sqlite3.capi
    const savedStack = w.pstack.pointer
    try {
      const pSize = w.pstack.alloc(8)
      const pData = c.sqlite3_serialize(this.#db.pointer, 'main', pSize, 0)
      if (!pData) throw new Error('sqlite3_serialize returned null')
      const nBytes = Number(w.peek(pSize, 'i64'))
      const bytes = new Uint8Array(nBytes)
      bytes.set(w.heap8u().subarray(pData, pData + nBytes))
      c.sqlite3_free(pData)
      return bytes
    } finally {
      w.pstack.restore(savedStack)
    }
  }
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertIdentifier(name: string): string {
  if (!IDENT_RE.test(name)) throw new TypeError(`Invalid SQL identifier: ${name}`)
  return name
}
