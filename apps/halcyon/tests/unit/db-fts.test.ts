// @vitest-environment node
import type { DbAdapter } from '@palladium/core'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runMigrations, SCHEMA_DDL } from '~/lib/db-schema'
import {
  createContact,
  createNote,
  deleteNote,
  search,
  updateContact,
  updateNote,
} from '~/lib/db-shared'

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

function nodeAdapter(db: DatabaseSync): DbAdapter {
  return {
    queryAll: async <T,>(sql: string, bind?: unknown[]) =>
      db.prepare(sql).all(...sqlValues(bind)) as T[],
    queryOne: async <T,>(sql: string, bind?: unknown[]) =>
      (db.prepare(sql).get(...sqlValues(bind)) as T) ?? null,
    exec: async (sql: string, bind?: unknown[]) => {
      if (bind?.length) db.prepare(sql).run(...sqlValues(bind))
      else db.exec(sql)
    },
  }
}

function database(): { db: DatabaseSync; adapter: DbAdapter } {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  return { db, adapter: nodeAdapter(db) }
}

async function insertVault(adapter: DbAdapter, id = 'vault-1'): Promise<void> {
  await adapter.exec(
    `INSERT INTO vaults (id, name, description, color, icon, created_at)
     VALUES (?, 'Personal', '', '#7c3aed', 'user', '2026-10-04T00:00:00.000Z')`,
    [id],
  )
}

function contactInput(vault_id: string, first_name: string, last_name: string) {
  return {
    vault_id,
    first_name,
    last_name,
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
  } satisfies Parameters<typeof createContact>[1]
}

// Relevant statements copied verbatim from the version-1 SCHEMA_DDL at d2b9bd1.
// Keeping this fixture independent of current DDL exercises the real upgrade path.
const LEGACY_V1_DDL = `
  CREATE TABLE IF NOT EXISTS vaults (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#7c3aed',
    icon        TEXT NOT NULL DEFAULT 'i-heroicons-home',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id                TEXT PRIMARY KEY,
    vault_id          TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL DEFAULT '',
    nickname          TEXT NOT NULL DEFAULT '',
    maiden_name       TEXT NOT NULL DEFAULT '',
    middle_name       TEXT NOT NULL DEFAULT '',
    pronouns          TEXT NOT NULL DEFAULT '',
    gender            TEXT NOT NULL DEFAULT '',
    how_we_met        TEXT NOT NULL DEFAULT '',
    is_deceased       INTEGER NOT NULL DEFAULT 0,
    deceased_at       TEXT,
    birthday          TEXT,
    is_starred        INTEGER NOT NULL DEFAULT 0,
    last_contacted_at TEXT,
    avatar_url        TEXT,
    tags              TEXT NOT NULL DEFAULT '[]',
    annotations       TEXT NOT NULL DEFAULT '{}',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    archived_at       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_vault    ON contacts(vault_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_name     ON contacts(last_name, first_name);
  CREATE INDEX IF NOT EXISTS idx_contacts_starred  ON contacts(vault_id, is_starred);

  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    is_pinned  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notes_contact ON notes(contact_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS applied_defaults (
    key TEXT PRIMARY KEY
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
    id UNINDEXED,
    first_name,
    last_name,
    nickname,
    content=contacts,
    content_rowid=rowid
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    id UNINDEXED,
    contact_id UNINDEXED,
    body,
    content=notes,
    content_rowid=rowid
  );
`

describe('contact and note full-text indexes', () => {
  it('tracks create, update, delete, search, and cascades through real SQLite', async () => {
    const { db, adapter } = database()
    await adapter.exec(SCHEMA_DDL)
    await runMigrations(adapter)
    await insertVault(adapter)

    const contact = await createContact(adapter, contactInput('vault-1', 'Ada', 'Lovelace'))
    expect((await search(adapter, 'vault-1', 'Ada')).contacts.map((row) => row.id)).toEqual([
      contact.id,
    ])

    await updateContact(adapter, { id: contact.id, first_name: 'Grace', last_name: 'Hopper' })
    expect((await search(adapter, 'vault-1', 'Ada')).contacts).toEqual([])
    expect((await search(adapter, 'vault-1', 'Grace')).contacts.map((row) => row.id)).toEqual([
      contact.id,
    ])

    const note = await createNote(adapter, {
      contact_id: contact.id,
      body: 'Analytical engine memorandum',
      is_pinned: false,
    })
    expect((await search(adapter, 'vault-1', 'Analytical')).notes.map((row) => row.id)).toEqual([
      note.id,
    ])

    await updateNote(adapter, { id: note.id, body: 'Compiler architecture notes' })
    expect((await search(adapter, 'vault-1', 'Analytical')).notes).toEqual([])
    expect((await search(adapter, 'vault-1', 'Compiler')).notes.map((row) => row.id)).toEqual([
      note.id,
    ])

    await deleteNote(adapter, note.id)
    expect((await search(adapter, 'vault-1', 'Compiler')).notes).toEqual([])

    await createNote(adapter, {
      contact_id: contact.id,
      body: 'Cascade sentinel',
      is_pinned: false,
    })
    await adapter.exec('DELETE FROM contacts WHERE id = ?', [contact.id])

    expect((await search(adapter, 'vault-1', 'Grace')).contacts).toEqual([])
    expect((await search(adapter, 'vault-1', 'Cascade')).notes).toEqual([])
    expect(
      await adapter.queryAll('SELECT rowid FROM contacts_fts WHERE contacts_fts MATCH ?', ['Grace*']),
    ).toEqual([])
    expect(
      await adapter.queryAll('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?', ['Cascade*']),
    ).toEqual([])
    expect(await adapter.queryAll('SELECT id FROM notes WHERE contact_id = ?', [contact.id])).toEqual(
      [],
    )

    db.close()
  })

  it('upgrades the captured version-1 schema without losing data and rebuilds stale indexes', async () => {
    const { db, adapter } = database()
    await adapter.exec(LEGACY_V1_DDL)
    await insertVault(adapter, 'legacy-vault')
    await adapter.exec(
      `INSERT INTO contacts
       (id, vault_id, first_name, last_name, created_at, updated_at)
       VALUES ('legacy-contact', 'legacy-vault', 'Legacy', 'Person', 'created', 'updated')`,
    )
    await adapter.exec(
      `INSERT INTO notes (id, contact_id, body, created_at, updated_at)
       VALUES ('legacy-note', 'legacy-contact', 'Legacy note token', 'created', 'updated')`,
    )
    await adapter.exec(
      `INSERT INTO contacts_fts (rowid, id, first_name, last_name, nickname)
       SELECT rowid, id, first_name, last_name, nickname FROM contacts`,
    )
    await adapter.exec(
      `INSERT INTO notes_fts (rowid, id, contact_id, body)
       SELECT rowid, id, contact_id, body FROM notes`,
    )
    await adapter.exec(
      "UPDATE contacts SET first_name = 'Preserved', last_name = 'Record' WHERE id = 'legacy-contact'",
    )
    await adapter.exec("UPDATE notes SET body = 'Repaired index token' WHERE id = 'legacy-note'")
    await adapter.exec('PRAGMA user_version = 1')

    // Match both runtime paths: apply the current DDL before upgrading the stored version.
    await adapter.exec(SCHEMA_DDL)
    await runMigrations(adapter)

    expect(await adapter.queryAll('PRAGMA user_version')).toEqual([{ user_version: 2 }])
    expect(
      await adapter.queryAll('SELECT id, first_name, last_name FROM contacts ORDER BY id'),
    ).toEqual([{ id: 'legacy-contact', first_name: 'Preserved', last_name: 'Record' }])
    expect(await adapter.queryAll('SELECT id, contact_id, body FROM notes ORDER BY id')).toEqual([
      {
        id: 'legacy-note',
        contact_id: 'legacy-contact',
        body: 'Repaired index token',
      },
    ])
    expect(
      (await search(adapter, 'legacy-vault', 'Preserved')).contacts.map((row) => row.id),
    ).toEqual(['legacy-contact'])
    expect((await search(adapter, 'legacy-vault', 'Repaired')).notes.map((row) => row.id)).toEqual([
      'legacy-note',
    ])
    expect(
      await adapter.queryAll('SELECT rowid FROM contacts_fts WHERE contacts_fts MATCH ?', ['Legacy*']),
    ).toEqual([])
    expect(
      await adapter.queryAll('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?', ['Legacy*']),
    ).toEqual([])
    expect(
      await adapter.queryAll<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
      ),
    ).toEqual([
      { name: 'contacts_fts_ad' },
      { name: 'contacts_fts_ai' },
      { name: 'contacts_fts_au' },
      { name: 'notes_fts_ad' },
      { name: 'notes_fts_ai' },
      { name: 'notes_fts_au' },
    ])

    db.close()
  })
})
