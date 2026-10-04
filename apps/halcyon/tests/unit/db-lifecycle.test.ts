// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { DbAdapter } from '~/types/database'
import { createContact } from '~/lib/db-shared'
import { resetDatabaseStorage } from '~/lib/db-lifecycle'
import { describe, expect, it } from 'vitest'

function sqlValues(bind?: unknown[]): SQLInputValue[] {
  return (bind ?? []).map((value) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      value instanceof Uint8Array
    ) {
      return value
    }
    throw new TypeError(`Unsupported SQLite bind value: ${typeof value}`)
  })
}

function databaseHarness() {
  let sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const db: DbAdapter = {
    queryAll: async <T,>(sql: string, bind?: unknown[]) => sqlite.prepare(sql).all(...sqlValues(bind)) as T[],
    queryOne: async <T,>(sql: string, bind?: unknown[]) =>
      (sqlite.prepare(sql).get(...sqlValues(bind)) as T) ?? null,
    exec: async (sql: string, bind?: unknown[]) => {
      if (bind?.length) sqlite.prepare(sql).run(...sqlValues(bind))
      else sqlite.exec(sql)
    },
  }
  const storage = {
    async resetStorage() {
      sqlite.close()
      sqlite = new DatabaseSync(':memory:')
    },
  }
  return { db, storage }
}

describe('database physical reset lifecycle', () => {
  it('recreates schema and defaults and supports writes after reset', async () => {
    const { db, storage } = databaseHarness()
    await db.exec('CREATE TABLE stale_data (value TEXT)')
    await db.exec("INSERT INTO stale_data VALUES ('old')")

    await resetDatabaseStorage(storage, db)

    expect(await db.queryAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stale_data'")).toEqual([])
    const vaults = await db.queryAll<{ id: string; name: string }>('SELECT id, name FROM vaults')
    expect(vaults).toHaveLength(1)
    expect(vaults[0]?.name).toBe('Personal')
    expect(await db.queryAll('PRAGMA user_version')).toEqual([{ user_version: 2 }])

    const vaultId = vaults[0]!.id
    const contact = await createContact(db, {
      vault_id: vaultId,
      first_name: 'Ada',
      last_name: 'Lovelace',
      nickname: '',
      maiden_name: '',
      middle_name: '',
      pronouns: '',
      gender: '',
      how_we_met: '',
      is_deceased: false,
      deceased_at: null,
      birthday: null,
      is_starred: false,
      avatar_url: null,
      tags: [],
      annotations: {},
    })
    expect(await db.queryOne('SELECT id FROM contacts WHERE id = ?', [contact.id])).toEqual({ id: contact.id })
  })

  it('propagates physical storage reset failures without reporting success', async () => {
    const { db } = databaseHarness()
    const storage = { resetStorage: async () => { throw new Error('storage unavailable') } }
    await expect(resetDatabaseStorage(storage, db)).rejects.toThrow('storage unavailable')
  })
})
