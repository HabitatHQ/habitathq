import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type {
  Address,
  AddressType,
  Company,
  Contact,
  ContactDetail,
  ContactField,
  ContactFieldType,
  DashboardData,
  GiftNote,
  Group,
  GroupWithCount,
  HalcyonExport,
  Interaction,
  InteractionWithContacts,
  JournalEntry,
  LifeEvent,
  LifeEventType,
  Note,
  Occupation,
  OccupationWithCompany,
  Pet,
  Relationship,
  RelationshipType,
  RelationshipWithContact,
  Reminder,
  SearchResult,
  StayInTouch,
  StayInTouchWithContact,
  Tag,
  Task,
  Vault,
  WorkerRequest,
  WorkerResponse,
} from '~/types/database'
import { stayInTouchNextDate } from '~/utils/reminder-helpers'

// ─── Lock ─────────────────────────────────────────────────────────────────────

async function tryAcquireDbLock(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
    const got = await new Promise<boolean>((resolve) => {
      void navigator.locks.request('halcyon-db', { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false)
          return Promise.resolve()
        }
        resolve(true)
        return new Promise(() => {}) // hold until worker terminates
      })
    })
    if (got) return true
  }
  return false
}

await (async () => {
  const hasLock = await tryAcquireDbLock()
  if (!hasLock) {
    self.postMessage({ type: 'LOCK_UNAVAILABLE' })
    return
  }

  try {
    // ─── Init ─────────────────────────────────────────────────────────────────
    // @ts-expect-error — sqlite-wasm omits optional config param from types
    const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} })

    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/halcyon',
      clearOnInit: false,
    })
    const db = new poolUtil.OpfsSAHPoolDb('/halcyon.db')
    db.exec('PRAGMA foreign_keys = ON')

    // ─── Schema ───────────────────────────────────────────────────────────────

    db.exec(`
      CREATE TABLE IF NOT EXISTS vaults (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color       TEXT NOT NULL DEFAULT '#7c3aed',
        icon        TEXT NOT NULL DEFAULT 'i-heroicons-home',
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_field_types (
        id         TEXT PRIMARY KEY,
        vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        icon       TEXT NOT NULL DEFAULT 'i-heroicons-link',
        protocol   TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0
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

      CREATE TABLE IF NOT EXISTS contact_fields (
        id         TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type_id    TEXT NOT NULL REFERENCES contact_field_types(id),
        value      TEXT NOT NULL,
        label      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_contact_fields ON contact_fields(contact_id);

      CREATE TABLE IF NOT EXISTS address_types (
        id       TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        name     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS addresses (
        id          TEXT PRIMARY KEY,
        contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type_id     TEXT REFERENCES address_types(id),
        street      TEXT NOT NULL DEFAULT '',
        city        TEXT NOT NULL DEFAULT '',
        province    TEXT NOT NULL DEFAULT '',
        postal_code TEXT NOT NULL DEFAULT '',
        country     TEXT NOT NULL DEFAULT '',
        is_primary  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_addresses_contact ON addresses(contact_id);

      CREATE TABLE IF NOT EXISTS relationship_types (
        id           TEXT PRIMARY KEY,
        vault_id     TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        name_reverse TEXT NOT NULL,
        is_symmetric INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id         TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        related_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type_id    TEXT NOT NULL REFERENCES relationship_types(id),
        notes      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_relationships_contact ON relationships(contact_id);

      CREATE TABLE IF NOT EXISTS companies (
        id          TEXT PRIMARY KEY,
        vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        website     TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        tags        TEXT NOT NULL DEFAULT '[]',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_companies_vault ON companies(vault_id);

      CREATE TABLE IF NOT EXISTS occupations (
        id         TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        title      TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        is_current INTEGER NOT NULL DEFAULT 1,
        started_at TEXT,
        ended_at   TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_occupations_contact ON occupations(contact_id);

      CREATE TABLE IF NOT EXISTS pets (
        id         TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        species    TEXT NOT NULL DEFAULT '',
        breed      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pets_contact ON pets(contact_id);

      CREATE TABLE IF NOT EXISTS tags (
        id       TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        name     TEXT NOT NULL,
        color    TEXT NOT NULL DEFAULT '#7c3aed'
      );

      CREATE TABLE IF NOT EXISTS contact_tags (
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (contact_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS groups (
        id          TEXT PRIMARY KEY,
        vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_contacts (
        group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, contact_id)
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id               TEXT PRIMARY KEY,
        vault_id         TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        type             TEXT NOT NULL,
        channel          TEXT,
        subject          TEXT NOT NULL DEFAULT '',
        notes            TEXT NOT NULL DEFAULT '',
        happened_at      TEXT NOT NULL,
        duration_minutes INTEGER,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_interactions_vault ON interactions(vault_id, happened_at DESC);

      CREATE TABLE IF NOT EXISTS interaction_contacts (
        interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
        contact_id     TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        PRIMARY KEY (interaction_id, contact_id)
      );

      CREATE INDEX IF NOT EXISTS idx_interaction_contacts_contact ON interaction_contacts(contact_id);

      CREATE TABLE IF NOT EXISTS notes (
        id         TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        is_pinned  INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notes_contact ON notes(contact_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS life_event_types (
        id       TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        name     TEXT NOT NULL,
        icon     TEXT NOT NULL DEFAULT 'i-heroicons-star',
        category TEXT NOT NULL DEFAULT 'personal'
      );

      CREATE TABLE IF NOT EXISTS life_events (
        id               TEXT PRIMARY KEY,
        contact_id       TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type_id          TEXT REFERENCES life_event_types(id) ON DELETE SET NULL,
        label            TEXT NOT NULL DEFAULT '',
        notes            TEXT NOT NULL DEFAULT '',
        happened_at      TEXT,
        yearly_reminder  INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_life_events_contact ON life_events(contact_id);

      CREATE TABLE IF NOT EXISTS reminders (
        id         TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        remind_at  TEXT NOT NULL,
        is_yearly  INTEGER NOT NULL DEFAULT 0,
        is_done    INTEGER NOT NULL DEFAULT 0,
        done_at    TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reminders_contact ON reminders(contact_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_date    ON reminders(remind_at);

      CREATE TABLE IF NOT EXISTS stay_in_touch (
        id                TEXT PRIMARY KEY,
        contact_id        TEXT NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
        frequency_days    INTEGER NOT NULL,
        last_contacted_at TEXT,
        next_remind_at    TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_stay_in_touch_next ON stay_in_touch(next_remind_at);

      CREATE TABLE IF NOT EXISTS tasks (
        id         TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        notes      TEXT NOT NULL DEFAULT '',
        due_at     TEXT,
        is_done    INTEGER NOT NULL DEFAULT 0,
        done_at    TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);

      CREATE TABLE IF NOT EXISTS gift_notes (
        id         TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        idea       TEXT NOT NULL,
        occasion   TEXT NOT NULL DEFAULT '',
        is_given   INTEGER NOT NULL DEFAULT 0,
        given_at   TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_gift_notes_contact ON gift_notes(contact_id);

      CREATE TABLE IF NOT EXISTS journal_entries (
        id         TEXT PRIMARY KEY,
        vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        title      TEXT NOT NULL DEFAULT '',
        body       TEXT NOT NULL,
        date       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(vault_id, date)
      );

      CREATE INDEX IF NOT EXISTS idx_journal_vault_date ON journal_entries(vault_id, date DESC);

      CREATE TABLE IF NOT EXISTS applied_defaults (
        key TEXT PRIMARY KEY
      );

      -- FTS5 virtual table for full-text search
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
    `)

    // ─── Migrations ───────────────────────────────────────────────────────────

    const userVersion: number =
      ((
        db.exec('PRAGMA user_version', { returnValue: 'resultRows' }) as number[][]
      )[0]?.[0] as number) ?? 0

    type Migration = string[]
    const migrations: Record<number, Migration> = {
      1: [
        // Initial schema is created above via CREATE TABLE IF NOT EXISTS.
        // Seed default vaults and field types.
        `INSERT OR IGNORE INTO applied_defaults (key) VALUES ('schema_v1')`,
      ],
    }

    for (let v = userVersion + 1; v in migrations; v++) {
      for (const sql of migrations[v]!) {
        db.exec(sql)
      }
      db.exec(`PRAGMA user_version = ${v}`)
    }

    // ─── Seeds ────────────────────────────────────────────────────────────────

    type Seed = { key: string; apply: () => void }

    const seeds: Seed[] = [
      {
        key: 'default_vault',
        apply: () => {
          const vaultId = crypto.randomUUID()
          exec(
            `INSERT INTO vaults (id, name, description, color, icon, created_at)
             VALUES (?, 'Personal', '', '#7c3aed', 'i-heroicons-user', ?)`,
            [vaultId, now()],
          )
          seedDefaultFieldTypes(vaultId)
          seedDefaultRelationshipTypes(vaultId)
          seedDefaultAddressTypes(vaultId)
          seedDefaultLifeEventTypes(vaultId)
        },
      },
    ]

    for (const seed of seeds) {
      const exists = queryRaw('SELECT 1 FROM applied_defaults WHERE key = ?', [seed.key])
      if (exists.length === 0) {
        seed.apply()
        exec('INSERT INTO applied_defaults (key) VALUES (?)', [seed.key])
      }
    }

    function seedDefaultFieldTypes(vaultId: string) {
      const types = [
        { name: 'Phone', icon: 'i-heroicons-phone', protocol: 'tel:' },
        { name: 'Email', icon: 'i-heroicons-envelope', protocol: 'mailto:' },
        { name: 'Website', icon: 'i-heroicons-globe-alt', protocol: '' },
        { name: 'WhatsApp', icon: 'i-heroicons-chat-bubble-oval-left', protocol: 'https://wa.me/' },
        { name: 'Twitter', icon: 'i-heroicons-at-symbol', protocol: 'https://twitter.com/' },
        { name: 'LinkedIn', icon: 'i-heroicons-briefcase', protocol: 'https://linkedin.com/in/' },
        { name: 'Instagram', icon: 'i-heroicons-camera', protocol: 'https://instagram.com/' },
      ]
      for (const t of types) {
        exec(
          `INSERT INTO contact_field_types (id, vault_id, name, icon, protocol, is_default)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [crypto.randomUUID(), vaultId, t.name, t.icon, t.protocol],
        )
      }
    }

    function seedDefaultRelationshipTypes(vaultId: string) {
      const types = [
        { name: 'partner of', name_reverse: 'partner of', symmetric: 1 },
        { name: 'parent of', name_reverse: 'child of', symmetric: 0 },
        { name: 'child of', name_reverse: 'parent of', symmetric: 0 },
        { name: 'sibling of', name_reverse: 'sibling of', symmetric: 1 },
        { name: 'friend of', name_reverse: 'friend of', symmetric: 1 },
        { name: 'colleague of', name_reverse: 'colleague of', symmetric: 1 },
        { name: 'mentor of', name_reverse: 'mentee of', symmetric: 0 },
        { name: 'mentee of', name_reverse: 'mentor of', symmetric: 0 },
      ]
      for (const t of types) {
        exec(
          `INSERT INTO relationship_types (id, vault_id, name, name_reverse, is_symmetric, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), vaultId, t.name, t.name_reverse, t.symmetric, now()],
        )
      }
    }

    function seedDefaultAddressTypes(vaultId: string) {
      for (const name of ['Home', 'Work', 'Other']) {
        exec('INSERT INTO address_types (id, vault_id, name) VALUES (?, ?, ?)', [
          crypto.randomUUID(),
          vaultId,
          name,
        ])
      }
    }

    function seedDefaultLifeEventTypes(vaultId: string) {
      const types = [
        { name: 'Got married', icon: 'i-heroicons-heart', category: 'family' },
        { name: 'Had a child', icon: 'i-heroicons-face-smile', category: 'family' },
        { name: 'Got engaged', icon: 'i-heroicons-sparkles', category: 'family' },
        { name: 'Got divorced', icon: 'i-heroicons-x-circle', category: 'family' },
        { name: 'Moved city', icon: 'i-heroicons-home', category: 'life' },
        { name: 'Started new job', icon: 'i-heroicons-briefcase', category: 'career' },
        { name: 'Changed career', icon: 'i-heroicons-arrow-path', category: 'career' },
        { name: 'Graduated', icon: 'i-heroicons-academic-cap', category: 'career' },
        { name: 'Lost a loved one', icon: 'i-heroicons-heart-broken', category: 'life' },
        { name: 'Medical event', icon: 'i-heroicons-beaker', category: 'health' },
      ]
      for (const t of types) {
        exec(
          'INSERT INTO life_event_types (id, vault_id, name, icon, category) VALUES (?, ?, ?, ?, ?)',
          [crypto.randomUUID(), vaultId, t.name, t.icon, t.category],
        )
      }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function now(): string {
      return new Date().toISOString()
    }

    function queryRaw(sql: string, bind?: unknown[]): Record<string, unknown>[] {
      const rows: Record<string, unknown>[] = []
      db.exec({
        sql,
        ...(bind !== undefined && { bind }),
        rowMode: 'object',
        callback: (row: Record<string, unknown>) => rows.push({ ...row }),
      })
      return rows
    }

    function exec(sql: string, bind?: unknown[]): void {
      db.exec({ sql, ...(bind !== undefined && { bind }) })
    }

    function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
      if (str == null) return fallback
      try {
        return JSON.parse(str) as T
      } catch {
        return fallback
      }
    }

    function rowToVault(r: Record<string, unknown>): Vault {
      return {
        id: r.id as string,
        name: r.name as string,
        description: r.description as string,
        color: r.color as string,
        icon: r.icon as string,
        created_at: r.created_at as string,
      }
    }

    function rowToContact(r: Record<string, unknown>): Contact {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        first_name: r.first_name as string,
        last_name: r.last_name as string,
        nickname: r.nickname as string,
        maiden_name: r.maiden_name as string,
        middle_name: r.middle_name as string,
        pronouns: r.pronouns as string,
        gender: r.gender as string,
        how_we_met: r.how_we_met as string,
        is_deceased: Boolean(r.is_deceased),
        deceased_at: (r.deceased_at as string | null) ?? null,
        birthday: (r.birthday as string | null) ?? null,
        is_starred: Boolean(r.is_starred),
        last_contacted_at: (r.last_contacted_at as string | null) ?? null,
        avatar_url: (r.avatar_url as string | null) ?? null,
        tags: safeJsonParse(r.tags as string, []),
        annotations: safeJsonParse(r.annotations as string, {}),
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
        archived_at: (r.archived_at as string | null) ?? null,
      }
    }

    function rowToContactFieldType(r: Record<string, unknown>): ContactFieldType {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        name: r.name as string,
        icon: r.icon as string,
        protocol: r.protocol as string,
        is_default: Boolean(r.is_default),
      }
    }

    function rowToContactField(r: Record<string, unknown>): ContactField {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        type_id: r.type_id as string,
        value: r.value as string,
        label: r.label as string,
        created_at: r.created_at as string,
      }
    }

    function rowToAddress(r: Record<string, unknown>): Address {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        type_id: (r.type_id as string | null) ?? null,
        street: r.street as string,
        city: r.city as string,
        province: r.province as string,
        postal_code: r.postal_code as string,
        country: r.country as string,
        is_primary: Boolean(r.is_primary),
        created_at: r.created_at as string,
      }
    }

    function rowToRelationshipType(r: Record<string, unknown>): RelationshipType {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        name: r.name as string,
        name_reverse: r.name_reverse as string,
        is_symmetric: Boolean(r.is_symmetric),
        created_at: r.created_at as string,
      }
    }

    function rowToRelationship(r: Record<string, unknown>): Relationship {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        related_id: r.related_id as string,
        type_id: r.type_id as string,
        notes: r.notes as string,
        created_at: r.created_at as string,
      }
    }

    function rowToCompany(r: Record<string, unknown>): Company {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        name: r.name as string,
        website: r.website as string,
        description: r.description as string,
        tags: safeJsonParse(r.tags as string, []),
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      }
    }

    function rowToOccupation(r: Record<string, unknown>): Occupation {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        company_id: (r.company_id as string | null) ?? null,
        title: r.title as string,
        department: r.department as string,
        is_current: Boolean(r.is_current),
        started_at: (r.started_at as string | null) ?? null,
        ended_at: (r.ended_at as string | null) ?? null,
        created_at: r.created_at as string,
      }
    }

    function rowToPet(r: Record<string, unknown>): Pet {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        name: r.name as string,
        species: r.species as string,
        breed: r.breed as string,
        created_at: r.created_at as string,
      }
    }

    function rowToTag(r: Record<string, unknown>): Tag {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        name: r.name as string,
        color: r.color as string,
      }
    }

    function rowToGroup(r: Record<string, unknown>): Group {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        name: r.name as string,
        description: r.description as string,
        created_at: r.created_at as string,
      }
    }

    function rowToInteraction(r: Record<string, unknown>): Interaction {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        type: r.type as Interaction['type'],
        channel: (r.channel as Interaction['channel']) ?? null,
        subject: r.subject as string,
        notes: r.notes as string,
        happened_at: r.happened_at as string,
        duration_minutes: (r.duration_minutes as number | null) ?? null,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      }
    }

    function rowToNote(r: Record<string, unknown>): Note {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        body: r.body as string,
        is_pinned: Boolean(r.is_pinned),
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      }
    }

    function rowToLifeEventType(r: Record<string, unknown>): LifeEventType {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        name: r.name as string,
        icon: r.icon as string,
        category: r.category as string,
      }
    }

    function rowToLifeEvent(r: Record<string, unknown>): LifeEvent {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        type_id: (r.type_id as string | null) ?? null,
        label: r.label as string,
        notes: r.notes as string,
        happened_at: (r.happened_at as string | null) ?? null,
        yearly_reminder: Boolean(r.yearly_reminder),
        created_at: r.created_at as string,
      }
    }

    function rowToReminder(r: Record<string, unknown>): Reminder {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        title: r.title as string,
        body: r.body as string,
        remind_at: r.remind_at as string,
        is_yearly: Boolean(r.is_yearly),
        is_done: Boolean(r.is_done),
        done_at: (r.done_at as string | null) ?? null,
        created_at: r.created_at as string,
      }
    }

    function rowToStayInTouch(r: Record<string, unknown>): StayInTouch {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        frequency_days: r.frequency_days as number,
        last_contacted_at: (r.last_contacted_at as string | null) ?? null,
        next_remind_at: r.next_remind_at as string,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      }
    }

    function rowToTask(r: Record<string, unknown>): Task {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        title: r.title as string,
        notes: r.notes as string,
        due_at: (r.due_at as string | null) ?? null,
        is_done: Boolean(r.is_done),
        done_at: (r.done_at as string | null) ?? null,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      }
    }

    function rowToGiftNote(r: Record<string, unknown>): GiftNote {
      return {
        id: r.id as string,
        contact_id: r.contact_id as string,
        idea: r.idea as string,
        occasion: r.occasion as string,
        is_given: Boolean(r.is_given),
        given_at: (r.given_at as string | null) ?? null,
        created_at: r.created_at as string,
      }
    }

    function rowToJournalEntry(r: Record<string, unknown>): JournalEntry {
      return {
        id: r.id as string,
        vault_id: r.vault_id as string,
        title: r.title as string,
        body: r.body as string,
        date: r.date as string,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      }
    }

    // Helper: get interaction contacts
    function getInteractionContacts(interactionId: string): Contact[] {
      return queryRaw(
        `SELECT c.* FROM contacts c
         JOIN interaction_contacts ic ON ic.contact_id = c.id
         WHERE ic.interaction_id = ?`,
        [interactionId],
      ).map(rowToContact)
    }

    // Helper: update last_contacted_at for all contacts in an interaction
    function touchContacts(contactIds: string[]): void {
      const ts = now()
      for (const id of contactIds) {
        exec('UPDATE contacts SET last_contacted_at = ?, updated_at = ? WHERE id = ?', [ts, ts, id])
        // Reset stay-in-touch
        const sit = queryRaw('SELECT * FROM stay_in_touch WHERE contact_id = ?', [id])
        if (sit.length > 0) {
          const next = stayInTouchNextDate({
            frequency_days: sit[0]!.frequency_days as number,
            last_contacted_at: ts,
          })
          exec(
            `UPDATE stay_in_touch SET last_contacted_at = ?, next_remind_at = ?, updated_at = ?
             WHERE contact_id = ?`,
            [ts, next, ts, id],
          )
        }
      }
    }

    // Helper: sync FTS on contact upsert
    function syncContactFts(contact: Contact): void {
      exec('DELETE FROM contacts_fts WHERE id = ?', [contact.id])
      exec('INSERT INTO contacts_fts (id, first_name, last_name, nickname) VALUES (?, ?, ?, ?)', [
        contact.id,
        contact.first_name,
        contact.last_name,
        contact.nickname,
      ])
    }

    // Helper: sync FTS on note upsert
    function syncNoteFts(note: Note): void {
      exec('DELETE FROM notes_fts WHERE id = ?', [note.id])
      exec('INSERT INTO notes_fts (id, contact_id, body) VALUES (?, ?, ?)', [
        note.id,
        note.contact_id,
        note.body,
      ])
    }

    // ─── Handlers ─────────────────────────────────────────────────────────────

    // VAULTS
    function getVaults(): Vault[] {
      return queryRaw('SELECT * FROM vaults ORDER BY name').map(rowToVault)
    }

    function createVault(p: Omit<Vault, 'id' | 'created_at'>): Vault {
      const id = crypto.randomUUID()
      const ts = now()
      exec(
        `INSERT INTO vaults (id, name, description, color, icon, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, p.name, p.description, p.color, p.icon, ts],
      )
      seedDefaultFieldTypes(id)
      seedDefaultRelationshipTypes(id)
      seedDefaultAddressTypes(id)
      seedDefaultLifeEventTypes(id)
      return rowToVault(queryRaw('SELECT * FROM vaults WHERE id = ?', [id])[0]!)
    }

    function updateVault(p: Partial<Vault> & { id: string }): Vault {
      if (p.name !== undefined) exec('UPDATE vaults SET name = ? WHERE id = ?', [p.name, p.id])
      if (p.description !== undefined)
        exec('UPDATE vaults SET description = ? WHERE id = ?', [p.description, p.id])
      if (p.color !== undefined) exec('UPDATE vaults SET color = ? WHERE id = ?', [p.color, p.id])
      if (p.icon !== undefined) exec('UPDATE vaults SET icon = ? WHERE id = ?', [p.icon, p.id])
      return rowToVault(queryRaw('SELECT * FROM vaults WHERE id = ?', [p.id])[0]!)
    }

    function deleteVault(id: string): void {
      exec('DELETE FROM vaults WHERE id = ?', [id])
    }

    // CONTACTS
    function getContacts(vault_id: string): Contact[] {
      return queryRaw(
        `SELECT * FROM contacts WHERE vault_id = ? AND archived_at IS NULL
         ORDER BY last_name, first_name`,
        [vault_id],
      ).map(rowToContact)
    }

    function getContact(id: string): Contact {
      return rowToContact(queryRaw('SELECT * FROM contacts WHERE id = ?', [id])[0]!)
    }

    function getContactDetail(id: string): ContactDetail {
      const contact = getContact(id)

      // Fields with type
      const fieldRows = queryRaw(
        `SELECT cf.*, cft.name as type_name, cft.icon as type_icon, cft.protocol as type_protocol,
                cft.vault_id as type_vault_id, cft.is_default as type_is_default
         FROM contact_fields cf
         JOIN contact_field_types cft ON cft.id = cf.type_id
         WHERE cf.contact_id = ?
         ORDER BY cft.name`,
        [id],
      )
      const fields = fieldRows.map((r) => ({
        ...rowToContactField(r),
        type: {
          id: r.type_id as string,
          vault_id: r.type_vault_id as string,
          name: r.type_name as string,
          icon: r.type_icon as string,
          protocol: r.type_protocol as string,
          is_default: Boolean(r.type_is_default),
        } as ContactFieldType,
      }))

      // Addresses
      const addresses = queryRaw(
        'SELECT * FROM addresses WHERE contact_id = ? ORDER BY is_primary DESC',
        [id],
      ).map(rowToAddress)

      // Relationships with related contact + type
      const relRows = queryRaw(
        `SELECT r.*, c.first_name, c.last_name, c.nickname, c.avatar_url,
                rt.name as type_name, rt.name_reverse, rt.is_symmetric
         FROM relationships r
         JOIN contacts c ON c.id = r.related_id
         JOIN relationship_types rt ON rt.id = r.type_id
         WHERE r.contact_id = ?`,
        [id],
      )
      const relationships: RelationshipWithContact[] = relRows.map((r) => ({
        ...rowToRelationship(r),
        related: rowToContact({ ...r, id: r.related_id }),
        type: rowToRelationshipType({
          id: r.type_id,
          vault_id: contact.vault_id,
          name: r.type_name,
          name_reverse: r.name_reverse,
          is_symmetric: r.is_symmetric,
          created_at: r.created_at,
        }),
      }))

      // Occupations
      const occRows = queryRaw(
        `SELECT o.*, c.name as company_name, c.website as company_website,
                c.description as company_desc, c.tags as company_tags,
                c.created_at as company_created_at, c.updated_at as company_updated_at,
                c.vault_id as company_vault_id
         FROM occupations o
         LEFT JOIN companies c ON c.id = o.company_id
         WHERE o.contact_id = ?
         ORDER BY o.is_current DESC, o.started_at DESC`,
        [id],
      )
      const occupations: OccupationWithCompany[] = occRows.map((r) => {
        const occ = rowToOccupation(r)
        const company = r.company_id
          ? ({
              id: r.company_id as string,
              vault_id: r.company_vault_id as string,
              name: r.company_name as string,
              website: r.company_website as string,
              description: r.company_desc as string,
              tags: safeJsonParse(r.company_tags as string, []),
              created_at: r.company_created_at as string,
              updated_at: r.company_updated_at as string,
            } as Company)
          : null
        return { ...occ, company }
      })

      const currentOccupation = occupations.find((o) => o.is_current) ?? null
      const pastOccupations = occupations.filter((o) => !o.is_current)

      // Pets
      const pets = queryRaw('SELECT * FROM pets WHERE contact_id = ? ORDER BY name', [id]).map(
        rowToPet,
      )

      // Stay-in-touch
      const sitRows = queryRaw('SELECT * FROM stay_in_touch WHERE contact_id = ?', [id])
      const stay_in_touch = sitRows.length > 0 ? rowToStayInTouch(sitRows[0]!) : null

      return {
        ...contact,
        fields,
        addresses,
        relationships,
        current_occupation: currentOccupation,
        past_occupations: pastOccupations,
        pets,
        stay_in_touch,
      }
    }

    function createContact(
      p: Omit<Contact, 'id' | 'created_at' | 'updated_at' | 'archived_at' | 'last_contacted_at'>,
    ): Contact {
      const id = crypto.randomUUID()
      const ts = now()
      exec(
        `INSERT INTO contacts
         (id, vault_id, first_name, last_name, nickname, maiden_name, middle_name,
          pronouns, gender, how_we_met, is_deceased, deceased_at, birthday,
          is_starred, avatar_url, tags, annotations, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          p.vault_id,
          p.first_name,
          p.last_name,
          p.nickname,
          p.maiden_name,
          p.middle_name,
          p.pronouns,
          p.gender,
          p.how_we_met,
          p.is_deceased ? 1 : 0,
          p.deceased_at ?? null,
          p.birthday ?? null,
          p.is_starred ? 1 : 0,
          p.avatar_url ?? null,
          JSON.stringify(p.tags),
          JSON.stringify(p.annotations),
          ts,
          ts,
        ],
      )
      const contact = getContact(id)
      syncContactFts(contact)
      return contact
    }

    function updateContact(p: Partial<Contact> & { id: string }): Contact {
      const ts = now()
      const fields: string[] = ['updated_at = ?']
      const vals: unknown[] = [ts]

      const maybeSet = (col: string, val: unknown) => {
        if (val !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(val)
        }
      }

      maybeSet('first_name', p.first_name)
      maybeSet('last_name', p.last_name)
      maybeSet('nickname', p.nickname)
      maybeSet('maiden_name', p.maiden_name)
      maybeSet('middle_name', p.middle_name)
      maybeSet('pronouns', p.pronouns)
      maybeSet('gender', p.gender)
      maybeSet('how_we_met', p.how_we_met)
      if (p.is_deceased !== undefined) maybeSet('is_deceased', p.is_deceased ? 1 : 0)
      maybeSet('deceased_at', p.deceased_at)
      maybeSet('birthday', p.birthday)
      if (p.is_starred !== undefined) maybeSet('is_starred', p.is_starred ? 1 : 0)
      maybeSet('avatar_url', p.avatar_url)
      if (p.tags !== undefined) maybeSet('tags', JSON.stringify(p.tags))
      if (p.annotations !== undefined) maybeSet('annotations', JSON.stringify(p.annotations))

      vals.push(p.id)
      exec(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`, vals)
      const contact = getContact(p.id)
      syncContactFts(contact)
      return contact
    }

    function archiveContact(id: string): void {
      exec('UPDATE contacts SET archived_at = ?, updated_at = ? WHERE id = ?', [now(), now(), id])
    }

    function unarchiveContact(id: string): void {
      exec('UPDATE contacts SET archived_at = NULL, updated_at = ? WHERE id = ?', [now(), id])
    }

    function toggleStarContact(id: string): Contact {
      exec(
        `UPDATE contacts SET is_starred = CASE WHEN is_starred = 1 THEN 0 ELSE 1 END,
         updated_at = ? WHERE id = ?`,
        [now(), id],
      )
      return getContact(id)
    }

    // CONTACT FIELD TYPES
    function getContactFieldTypes(vault_id: string): ContactFieldType[] {
      return queryRaw('SELECT * FROM contact_field_types WHERE vault_id = ? ORDER BY name', [
        vault_id,
      ]).map(rowToContactFieldType)
    }

    function createContactFieldType(p: Omit<ContactFieldType, 'id'>): ContactFieldType {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO contact_field_types (id, vault_id, name, icon, protocol, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, p.vault_id, p.name, p.icon, p.protocol, p.is_default ? 1 : 0],
      )
      return rowToContactFieldType(
        queryRaw('SELECT * FROM contact_field_types WHERE id = ?', [id])[0]!,
      )
    }

    function updateContactFieldType(
      p: Partial<ContactFieldType> & { id: string },
    ): ContactFieldType {
      if (p.name !== undefined)
        exec('UPDATE contact_field_types SET name = ? WHERE id = ?', [p.name, p.id])
      if (p.icon !== undefined)
        exec('UPDATE contact_field_types SET icon = ? WHERE id = ?', [p.icon, p.id])
      if (p.protocol !== undefined)
        exec('UPDATE contact_field_types SET protocol = ? WHERE id = ?', [p.protocol, p.id])
      return rowToContactFieldType(
        queryRaw('SELECT * FROM contact_field_types WHERE id = ?', [p.id])[0]!,
      )
    }

    // CONTACT FIELDS
    function createContactField(p: Omit<ContactField, 'id' | 'created_at'>): ContactField {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO contact_fields (id, contact_id, type_id, value, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, p.contact_id, p.type_id, p.value, p.label, now()],
      )
      return rowToContactField(queryRaw('SELECT * FROM contact_fields WHERE id = ?', [id])[0]!)
    }

    function updateContactField(p: Partial<ContactField> & { id: string }): ContactField {
      if (p.value !== undefined)
        exec('UPDATE contact_fields SET value = ? WHERE id = ?', [p.value, p.id])
      if (p.label !== undefined)
        exec('UPDATE contact_fields SET label = ? WHERE id = ?', [p.label, p.id])
      return rowToContactField(queryRaw('SELECT * FROM contact_fields WHERE id = ?', [p.id])[0]!)
    }

    // ADDRESSES
    function getAddressTypes(vault_id: string): AddressType[] {
      return queryRaw('SELECT * FROM address_types WHERE vault_id = ? ORDER BY name', [
        vault_id,
      ]).map((r) => ({
        id: r.id as string,
        vault_id: r.vault_id as string,
        name: r.name as string,
      }))
    }

    function createAddress(p: Omit<Address, 'id' | 'created_at'>): Address {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO addresses (id, contact_id, type_id, street, city, province, postal_code, country, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          p.contact_id,
          p.type_id ?? null,
          p.street,
          p.city,
          p.province,
          p.postal_code,
          p.country,
          p.is_primary ? 1 : 0,
          now(),
        ],
      )
      return rowToAddress(queryRaw('SELECT * FROM addresses WHERE id = ?', [id])[0]!)
    }

    function updateAddress(p: Partial<Address> & { id: string }): Address {
      const fields: string[] = []
      const vals: unknown[] = []
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('street', p.street)
      s('city', p.city)
      s('province', p.province)
      s('postal_code', p.postal_code)
      s('country', p.country)
      if (p.is_primary !== undefined) {
        fields.push('is_primary = ?')
        vals.push(p.is_primary ? 1 : 0)
      }
      if (fields.length > 0) {
        vals.push(p.id)
        exec(`UPDATE addresses SET ${fields.join(', ')} WHERE id = ?`, vals)
      }
      return rowToAddress(queryRaw('SELECT * FROM addresses WHERE id = ?', [p.id])[0]!)
    }

    // RELATIONSHIP TYPES
    function getRelationshipTypes(vault_id: string): RelationshipType[] {
      return queryRaw('SELECT * FROM relationship_types WHERE vault_id = ? ORDER BY name', [
        vault_id,
      ]).map(rowToRelationshipType)
    }

    function createRelationshipType(
      p: Omit<RelationshipType, 'id' | 'created_at'>,
    ): RelationshipType {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO relationship_types (id, vault_id, name, name_reverse, is_symmetric, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, p.vault_id, p.name, p.name_reverse, p.is_symmetric ? 1 : 0, now()],
      )
      return rowToRelationshipType(
        queryRaw('SELECT * FROM relationship_types WHERE id = ?', [id])[0]!,
      )
    }

    function createRelationship(p: Omit<Relationship, 'id' | 'created_at'>): Relationship {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO relationships (id, contact_id, related_id, type_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, p.contact_id, p.related_id, p.type_id, p.notes, now()],
      )
      return rowToRelationship(queryRaw('SELECT * FROM relationships WHERE id = ?', [id])[0]!)
    }

    // COMPANIES
    function getCompanies(vault_id: string): Company[] {
      return queryRaw('SELECT * FROM companies WHERE vault_id = ? ORDER BY name', [vault_id]).map(
        rowToCompany,
      )
    }

    function getCompany(id: string): Company {
      return rowToCompany(queryRaw('SELECT * FROM companies WHERE id = ?', [id])[0]!)
    }

    function createCompany(p: Omit<Company, 'id' | 'created_at' | 'updated_at'>): Company {
      const id = crypto.randomUUID()
      const ts = now()
      exec(
        `INSERT INTO companies (id, vault_id, name, website, description, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, p.vault_id, p.name, p.website, p.description, JSON.stringify(p.tags), ts, ts],
      )
      return getCompany(id)
    }

    function updateCompany(p: Partial<Company> & { id: string }): Company {
      const ts = now()
      const fields: string[] = ['updated_at = ?']
      const vals: unknown[] = [ts]
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('name', p.name)
      s('website', p.website)
      s('description', p.description)
      if (p.tags !== undefined) {
        fields.push('tags = ?')
        vals.push(JSON.stringify(p.tags))
      }
      vals.push(p.id)
      exec(`UPDATE companies SET ${fields.join(', ')} WHERE id = ?`, vals)
      return getCompany(p.id)
    }

    // OCCUPATIONS
    function getOccupations(contact_id: string): OccupationWithCompany[] {
      const rows = queryRaw(
        `SELECT o.*, c.name as company_name, c.website as company_website,
                c.description as company_desc, c.tags as company_tags,
                c.created_at as company_created_at, c.updated_at as company_updated_at,
                c.vault_id as company_vault_id
         FROM occupations o LEFT JOIN companies c ON c.id = o.company_id
         WHERE o.contact_id = ? ORDER BY o.is_current DESC, o.started_at DESC`,
        [contact_id],
      )
      return rows.map((r) => ({
        ...rowToOccupation(r),
        company: r.company_id
          ? ({
              id: r.company_id as string,
              vault_id: r.company_vault_id as string,
              name: r.company_name as string,
              website: r.company_website as string,
              description: r.company_desc as string,
              tags: safeJsonParse(r.company_tags as string, []),
              created_at: r.company_created_at as string,
              updated_at: r.company_updated_at as string,
            } as Company)
          : null,
      }))
    }

    function createOccupation(p: Omit<Occupation, 'id' | 'created_at'>): Occupation {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO occupations (id, contact_id, company_id, title, department, is_current, started_at, ended_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          p.contact_id,
          p.company_id ?? null,
          p.title,
          p.department,
          p.is_current ? 1 : 0,
          p.started_at ?? null,
          p.ended_at ?? null,
          now(),
        ],
      )
      return rowToOccupation(queryRaw('SELECT * FROM occupations WHERE id = ?', [id])[0]!)
    }

    function updateOccupation(p: Partial<Occupation> & { id: string }): Occupation {
      const fields: string[] = []
      const vals: unknown[] = []
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('title', p.title)
      s('department', p.department)
      s('company_id', p.company_id)
      s('started_at', p.started_at)
      s('ended_at', p.ended_at)
      if (p.is_current !== undefined) {
        fields.push('is_current = ?')
        vals.push(p.is_current ? 1 : 0)
      }
      if (fields.length > 0) {
        vals.push(p.id)
        exec(`UPDATE occupations SET ${fields.join(', ')} WHERE id = ?`, vals)
      }
      return rowToOccupation(queryRaw('SELECT * FROM occupations WHERE id = ?', [p.id])[0]!)
    }

    // PETS
    function getPets(contact_id: string): Pet[] {
      return queryRaw('SELECT * FROM pets WHERE contact_id = ? ORDER BY name', [contact_id]).map(
        rowToPet,
      )
    }

    function createPet(p: Omit<Pet, 'id' | 'created_at'>): Pet {
      const id = crypto.randomUUID()
      exec(
        'INSERT INTO pets (id, contact_id, name, species, breed, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, p.contact_id, p.name, p.species, p.breed, now()],
      )
      return rowToPet(queryRaw('SELECT * FROM pets WHERE id = ?', [id])[0]!)
    }

    function updatePet(p: Partial<Pet> & { id: string }): Pet {
      const fields: string[] = []
      const vals: unknown[] = []
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('name', p.name)
      s('species', p.species)
      s('breed', p.breed)
      if (fields.length > 0) {
        vals.push(p.id)
        exec(`UPDATE pets SET ${fields.join(', ')} WHERE id = ?`, vals)
      }
      return rowToPet(queryRaw('SELECT * FROM pets WHERE id = ?', [p.id])[0]!)
    }

    // TAGS
    function getTags(vault_id: string): Tag[] {
      return queryRaw('SELECT * FROM tags WHERE vault_id = ? ORDER BY name', [vault_id]).map(
        rowToTag,
      )
    }

    function createTag(p: Omit<Tag, 'id'>): Tag {
      const id = crypto.randomUUID()
      exec('INSERT INTO tags (id, vault_id, name, color) VALUES (?, ?, ?, ?)', [
        id,
        p.vault_id,
        p.name,
        p.color,
      ])
      return rowToTag(queryRaw('SELECT * FROM tags WHERE id = ?', [id])[0]!)
    }

    function updateTag(p: Partial<Tag> & { id: string }): Tag {
      if (p.name !== undefined) exec('UPDATE tags SET name = ? WHERE id = ?', [p.name, p.id])
      if (p.color !== undefined) exec('UPDATE tags SET color = ? WHERE id = ?', [p.color, p.id])
      return rowToTag(queryRaw('SELECT * FROM tags WHERE id = ?', [p.id])[0]!)
    }

    function setContactTags(contact_id: string, tag_ids: string[]): void {
      exec('DELETE FROM contact_tags WHERE contact_id = ?', [contact_id])
      for (const tag_id of tag_ids) {
        exec('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', [
          contact_id,
          tag_id,
        ])
      }
    }

    // GROUPS
    function getGroups(vault_id: string): GroupWithCount[] {
      return queryRaw(
        `SELECT g.*, COUNT(gc.contact_id) as member_count
         FROM groups g LEFT JOIN group_contacts gc ON gc.group_id = g.id
         WHERE g.vault_id = ? GROUP BY g.id ORDER BY g.name`,
        [vault_id],
      ).map((r) => ({ ...rowToGroup(r), member_count: r.member_count as number }))
    }

    function getGroupContacts(group_id: string): Contact[] {
      return queryRaw(
        `SELECT c.* FROM contacts c
         JOIN group_contacts gc ON gc.contact_id = c.id
         WHERE gc.group_id = ? AND c.archived_at IS NULL
         ORDER BY c.last_name, c.first_name`,
        [group_id],
      ).map(rowToContact)
    }

    function createGroup(p: Omit<Group, 'id' | 'created_at'>): Group {
      const id = crypto.randomUUID()
      exec(
        'INSERT INTO groups (id, vault_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, p.vault_id, p.name, p.description, now()],
      )
      return rowToGroup(queryRaw('SELECT * FROM groups WHERE id = ?', [id])[0]!)
    }

    function updateGroup(p: Partial<Group> & { id: string }): Group {
      if (p.name !== undefined) exec('UPDATE groups SET name = ? WHERE id = ?', [p.name, p.id])
      if (p.description !== undefined)
        exec('UPDATE groups SET description = ? WHERE id = ?', [p.description, p.id])
      return rowToGroup(queryRaw('SELECT * FROM groups WHERE id = ?', [p.id])[0]!)
    }

    // INTERACTIONS
    function getInteractions(
      vault_id: string,
      contact_id?: string,
      limit = 50,
    ): InteractionWithContacts[] {
      let sql: string
      let bind: unknown[]

      if (contact_id) {
        sql = `SELECT DISTINCT i.* FROM interactions i
               JOIN interaction_contacts ic ON ic.interaction_id = i.id
               WHERE i.vault_id = ? AND ic.contact_id = ?
               ORDER BY i.happened_at DESC LIMIT ?`
        bind = [vault_id, contact_id, limit]
      } else {
        sql = `SELECT * FROM interactions WHERE vault_id = ?
               ORDER BY happened_at DESC LIMIT ?`
        bind = [vault_id, limit]
      }

      return queryRaw(sql, bind).map((r) => ({
        ...rowToInteraction(r),
        contacts: getInteractionContacts(r.id as string),
      }))
    }

    function createInteraction(
      p: Omit<Interaction, 'id' | 'created_at' | 'updated_at'> & { contact_ids: string[] },
    ): InteractionWithContacts {
      const id = crypto.randomUUID()
      const ts = now()
      exec(
        `INSERT INTO interactions (id, vault_id, type, channel, subject, notes, happened_at, duration_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          p.vault_id,
          p.type,
          p.channel ?? null,
          p.subject,
          p.notes,
          p.happened_at,
          p.duration_minutes ?? null,
          ts,
          ts,
        ],
      )
      for (const contact_id of p.contact_ids) {
        exec(
          'INSERT OR IGNORE INTO interaction_contacts (interaction_id, contact_id) VALUES (?, ?)',
          [id, contact_id],
        )
      }
      touchContacts(p.contact_ids)
      const interaction = rowToInteraction(
        queryRaw('SELECT * FROM interactions WHERE id = ?', [id])[0]!,
      )
      return { ...interaction, contacts: getInteractionContacts(id) }
    }

    function updateInteraction(
      p: Partial<Interaction> & { id: string } & { contact_ids?: string[] },
    ): InteractionWithContacts {
      const ts = now()
      const fields: string[] = ['updated_at = ?']
      const vals: unknown[] = [ts]
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('type', p.type)
      s('channel', p.channel)
      s('subject', p.subject)
      s('notes', p.notes)
      s('happened_at', p.happened_at)
      s('duration_minutes', p.duration_minutes)
      vals.push(p.id)
      exec(`UPDATE interactions SET ${fields.join(', ')} WHERE id = ?`, vals)

      if (p.contact_ids !== undefined) {
        exec('DELETE FROM interaction_contacts WHERE interaction_id = ?', [p.id])
        for (const contact_id of p.contact_ids) {
          exec('INSERT OR IGNORE INTO interaction_contacts VALUES (?, ?)', [p.id, contact_id])
        }
        touchContacts(p.contact_ids)
      }

      const interaction = rowToInteraction(
        queryRaw('SELECT * FROM interactions WHERE id = ?', [p.id])[0]!,
      )
      return { ...interaction, contacts: getInteractionContacts(p.id) }
    }

    function deleteInteraction(id: string): void {
      exec('DELETE FROM interactions WHERE id = ?', [id])
    }

    // NOTES
    function getNotes(contact_id: string): Note[] {
      return queryRaw(
        'SELECT * FROM notes WHERE contact_id = ? ORDER BY is_pinned DESC, updated_at DESC',
        [contact_id],
      ).map(rowToNote)
    }

    function createNote(p: Omit<Note, 'id' | 'created_at' | 'updated_at'>): Note {
      const id = crypto.randomUUID()
      const ts = now()
      exec(
        `INSERT INTO notes (id, contact_id, body, is_pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, p.contact_id, p.body, p.is_pinned ? 1 : 0, ts, ts],
      )
      const note = rowToNote(queryRaw('SELECT * FROM notes WHERE id = ?', [id])[0]!)
      syncNoteFts(note)
      return note
    }

    function updateNote(p: Partial<Note> & { id: string }): Note {
      const ts = now()
      const fields: string[] = ['updated_at = ?']
      const vals: unknown[] = [ts]
      if (p.body !== undefined) {
        fields.push('body = ?')
        vals.push(p.body)
      }
      if (p.is_pinned !== undefined) {
        fields.push('is_pinned = ?')
        vals.push(p.is_pinned ? 1 : 0)
      }
      vals.push(p.id)
      exec(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`, vals)
      const note = rowToNote(queryRaw('SELECT * FROM notes WHERE id = ?', [p.id])[0]!)
      syncNoteFts(note)
      return note
    }

    function togglePinNote(id: string): Note {
      exec(
        `UPDATE notes SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END, updated_at = ?
         WHERE id = ?`,
        [now(), id],
      )
      return rowToNote(queryRaw('SELECT * FROM notes WHERE id = ?', [id])[0]!)
    }

    // LIFE EVENT TYPES
    function getLifeEventTypes(vault_id: string): LifeEventType[] {
      return queryRaw('SELECT * FROM life_event_types WHERE vault_id = ? ORDER BY name', [
        vault_id,
      ]).map(rowToLifeEventType)
    }

    function createLifeEventType(p: Omit<LifeEventType, 'id'>): LifeEventType {
      const id = crypto.randomUUID()
      exec(
        'INSERT INTO life_event_types (id, vault_id, name, icon, category) VALUES (?, ?, ?, ?, ?)',
        [id, p.vault_id, p.name, p.icon, p.category],
      )
      return rowToLifeEventType(queryRaw('SELECT * FROM life_event_types WHERE id = ?', [id])[0]!)
    }

    // LIFE EVENTS
    function getLifeEvents(contact_id: string): LifeEvent[] {
      return queryRaw('SELECT * FROM life_events WHERE contact_id = ? ORDER BY happened_at DESC', [
        contact_id,
      ]).map(rowToLifeEvent)
    }

    function createLifeEvent(p: Omit<LifeEvent, 'id' | 'created_at'>): LifeEvent {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO life_events (id, contact_id, type_id, label, notes, happened_at, yearly_reminder, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          p.contact_id,
          p.type_id ?? null,
          p.label,
          p.notes,
          p.happened_at ?? null,
          p.yearly_reminder ? 1 : 0,
          now(),
        ],
      )
      return rowToLifeEvent(queryRaw('SELECT * FROM life_events WHERE id = ?', [id])[0]!)
    }

    function updateLifeEvent(p: Partial<LifeEvent> & { id: string }): LifeEvent {
      const fields: string[] = []
      const vals: unknown[] = []
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('label', p.label)
      s('notes', p.notes)
      s('happened_at', p.happened_at)
      if (p.yearly_reminder !== undefined) {
        fields.push('yearly_reminder = ?')
        vals.push(p.yearly_reminder ? 1 : 0)
      }
      if (fields.length > 0) {
        vals.push(p.id)
        exec(`UPDATE life_events SET ${fields.join(', ')} WHERE id = ?`, vals)
      }
      return rowToLifeEvent(queryRaw('SELECT * FROM life_events WHERE id = ?', [p.id])[0]!)
    }

    // REMINDERS
    function getReminders(contact_id: string): Reminder[] {
      return queryRaw('SELECT * FROM reminders WHERE contact_id = ? ORDER BY remind_at', [
        contact_id,
      ]).map(rowToReminder)
    }

    function getUpcomingReminders(
      vault_id: string,
      days: number,
    ): Array<{ contact: Contact; reminder: Reminder; days_away: number }> {
      const today = new Date().toISOString().slice(0, 10)
      const future = new Date()
      future.setDate(future.getDate() + days)
      const until = future.toISOString().slice(0, 10)

      const rows = queryRaw(
        `SELECT r.*, c.* FROM reminders r
         JOIN contacts c ON c.id = r.contact_id
         WHERE c.vault_id = ? AND r.is_done = 0
           AND r.remind_at BETWEEN ? AND ?
         ORDER BY r.remind_at`,
        [vault_id, today, until],
      )

      return rows.map((r) => {
        const reminder = rowToReminder(r)
        const contact = rowToContact(r)
        const daysAway = Math.round(
          (new Date(reminder.remind_at).getTime() - new Date(today).getTime()) / 86_400_000,
        )
        return { contact, reminder, days_away: daysAway }
      })
    }

    function createReminder(
      p: Omit<Reminder, 'id' | 'created_at' | 'is_done' | 'done_at'>,
    ): Reminder {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO reminders (id, contact_id, title, body, remind_at, is_yearly, is_done, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [id, p.contact_id, p.title, p.body, p.remind_at, p.is_yearly ? 1 : 0, now()],
      )
      return rowToReminder(queryRaw('SELECT * FROM reminders WHERE id = ?', [id])[0]!)
    }

    function updateReminder(p: Partial<Reminder> & { id: string }): Reminder {
      const fields: string[] = []
      const vals: unknown[] = []
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('title', p.title)
      s('body', p.body)
      s('remind_at', p.remind_at)
      if (p.is_yearly !== undefined) {
        fields.push('is_yearly = ?')
        vals.push(p.is_yearly ? 1 : 0)
      }
      if (fields.length > 0) {
        vals.push(p.id)
        exec(`UPDATE reminders SET ${fields.join(', ')} WHERE id = ?`, vals)
      }
      return rowToReminder(queryRaw('SELECT * FROM reminders WHERE id = ?', [p.id])[0]!)
    }

    function doneReminder(id: string): Reminder {
      exec('UPDATE reminders SET is_done = 1, done_at = ? WHERE id = ?', [now(), id])
      return rowToReminder(queryRaw('SELECT * FROM reminders WHERE id = ?', [id])[0]!)
    }

    // STAY-IN-TOUCH
    function getStayInTouch(contact_id: string): StayInTouch | null {
      const rows = queryRaw('SELECT * FROM stay_in_touch WHERE contact_id = ?', [contact_id])
      return rows.length > 0 ? rowToStayInTouch(rows[0]!) : null
    }

    function getOverdueStayInTouch(vault_id: string): StayInTouchWithContact[] {
      const today = new Date().toISOString().slice(0, 10)
      return queryRaw(
        `SELECT s.*, c.* FROM stay_in_touch s
         JOIN contacts c ON c.id = s.contact_id
         WHERE c.vault_id = ? AND s.next_remind_at <= ? AND c.archived_at IS NULL
         ORDER BY s.next_remind_at`,
        [vault_id, today],
      ).map((r) => ({ ...rowToStayInTouch(r), contact: rowToContact(r) }))
    }

    function setStayInTouch(contact_id: string, frequency_days: number): StayInTouch {
      const ts = now()
      const existing = getStayInTouch(contact_id)
      const next = stayInTouchNextDate({
        frequency_days,
        last_contacted_at: existing?.last_contacted_at ?? null,
      })
      if (existing) {
        exec(
          `UPDATE stay_in_touch SET frequency_days = ?, next_remind_at = ?, updated_at = ?
           WHERE contact_id = ?`,
          [frequency_days, next, ts, contact_id],
        )
      } else {
        exec(
          `INSERT INTO stay_in_touch (id, contact_id, frequency_days, last_contacted_at, next_remind_at, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?)`,
          [crypto.randomUUID(), contact_id, frequency_days, next, ts, ts],
        )
      }
      return rowToStayInTouch(
        queryRaw('SELECT * FROM stay_in_touch WHERE contact_id = ?', [contact_id])[0]!,
      )
    }

    function removeStayInTouch(contact_id: string): void {
      exec('DELETE FROM stay_in_touch WHERE contact_id = ?', [contact_id])
    }

    function markContacted(contact_id: string): void {
      touchContacts([contact_id])
    }

    // TASKS
    function getTasks(contact_id: string): Task[] {
      return queryRaw(
        'SELECT * FROM tasks WHERE contact_id = ? ORDER BY is_done, due_at, created_at',
        [contact_id],
      ).map(rowToTask)
    }

    function createTask(
      p: Omit<Task, 'id' | 'created_at' | 'updated_at' | 'is_done' | 'done_at'>,
    ): Task {
      const id = crypto.randomUUID()
      const ts = now()
      exec(
        `INSERT INTO tasks (id, contact_id, title, notes, due_at, is_done, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [id, p.contact_id, p.title, p.notes, p.due_at ?? null, ts, ts],
      )
      return rowToTask(queryRaw('SELECT * FROM tasks WHERE id = ?', [id])[0]!)
    }

    function updateTask(p: Partial<Task> & { id: string }): Task {
      const ts = now()
      const fields: string[] = ['updated_at = ?']
      const vals: unknown[] = [ts]
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('title', p.title)
      s('notes', p.notes)
      s('due_at', p.due_at)
      if (p.is_done !== undefined) {
        fields.push('is_done = ?')
        vals.push(p.is_done ? 1 : 0)
      }
      vals.push(p.id)
      exec(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, vals)
      return rowToTask(queryRaw('SELECT * FROM tasks WHERE id = ?', [p.id])[0]!)
    }

    function toggleTask(id: string): Task {
      const ts = now()
      exec(
        `UPDATE tasks SET is_done = CASE WHEN is_done = 1 THEN 0 ELSE 1 END,
         done_at = CASE WHEN is_done = 0 THEN ? ELSE NULL END, updated_at = ?
         WHERE id = ?`,
        [ts, ts, id],
      )
      return rowToTask(queryRaw('SELECT * FROM tasks WHERE id = ?', [id])[0]!)
    }

    // GIFT NOTES
    function getGiftNotes(contact_id: string): GiftNote[] {
      return queryRaw(
        'SELECT * FROM gift_notes WHERE contact_id = ? ORDER BY is_given, created_at DESC',
        [contact_id],
      ).map(rowToGiftNote)
    }

    function createGiftNote(
      p: Omit<GiftNote, 'id' | 'created_at' | 'is_given' | 'given_at'>,
    ): GiftNote {
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO gift_notes (id, contact_id, idea, occasion, is_given, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [id, p.contact_id, p.idea, p.occasion, now()],
      )
      return rowToGiftNote(queryRaw('SELECT * FROM gift_notes WHERE id = ?', [id])[0]!)
    }

    function updateGiftNote(p: Partial<GiftNote> & { id: string }): GiftNote {
      const fields: string[] = []
      const vals: unknown[] = []
      const s = (col: string, v: unknown) => {
        if (v !== undefined) {
          fields.push(`${col} = ?`)
          vals.push(v)
        }
      }
      s('idea', p.idea)
      s('occasion', p.occasion)
      if (p.is_given !== undefined) {
        fields.push('is_given = ?')
        vals.push(p.is_given ? 1 : 0)
      }
      if (fields.length > 0) {
        vals.push(p.id)
        exec(`UPDATE gift_notes SET ${fields.join(', ')} WHERE id = ?`, vals)
      }
      return rowToGiftNote(queryRaw('SELECT * FROM gift_notes WHERE id = ?', [p.id])[0]!)
    }

    function markGiftGiven(id: string): GiftNote {
      exec('UPDATE gift_notes SET is_given = 1, given_at = ? WHERE id = ?', [now(), id])
      return rowToGiftNote(queryRaw('SELECT * FROM gift_notes WHERE id = ?', [id])[0]!)
    }

    // JOURNAL
    function getJournalEntries(vault_id: string): JournalEntry[] {
      return queryRaw('SELECT * FROM journal_entries WHERE vault_id = ? ORDER BY date DESC', [
        vault_id,
      ]).map(rowToJournalEntry)
    }

    function getJournalEntry(date: string, vault_id: string): JournalEntry | null {
      const rows = queryRaw('SELECT * FROM journal_entries WHERE vault_id = ? AND date = ?', [
        vault_id,
        date,
      ])
      return rows.length > 0 ? rowToJournalEntry(rows[0]!) : null
    }

    function upsertJournalEntry(
      p: Omit<JournalEntry, 'id' | 'created_at' | 'updated_at'>,
    ): JournalEntry {
      const ts = now()
      const existing = getJournalEntry(p.date, p.vault_id)
      if (existing) {
        exec('UPDATE journal_entries SET title = ?, body = ?, updated_at = ? WHERE id = ?', [
          p.title,
          p.body,
          ts,
          existing.id,
        ])
        return rowToJournalEntry(
          queryRaw('SELECT * FROM journal_entries WHERE id = ?', [existing.id])[0]!,
        )
      }
      const id = crypto.randomUUID()
      exec(
        `INSERT INTO journal_entries (id, vault_id, title, body, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, p.vault_id, p.title, p.body, p.date, ts, ts],
      )
      return rowToJournalEntry(queryRaw('SELECT * FROM journal_entries WHERE id = ?', [id])[0]!)
    }

    // SEARCH
    function search(vault_id: string, query: string): SearchResult {
      if (!query.trim()) return { contacts: [], notes: [] }

      const q = `${query.trim()}*`

      const contacts = queryRaw(
        `SELECT c.* FROM contacts_fts fts
         JOIN contacts c ON c.id = fts.id
         WHERE c.vault_id = ? AND c.archived_at IS NULL AND contacts_fts MATCH ?
         ORDER BY rank LIMIT 20`,
        [vault_id, q],
      ).map(rowToContact)

      const noteRows = queryRaw(
        `SELECT n.*, c.id as c_id, c.first_name, c.last_name, c.nickname,
                c.vault_id as c_vault_id, c.avatar_url,
                c.is_starred, c.birthday, c.last_contacted_at,
                c.tags as c_tags, c.annotations as c_annotations,
                c.created_at as c_created_at, c.updated_at as c_updated_at,
                c.archived_at as c_archived_at, c.is_deceased,
                c.deceased_at, c.maiden_name, c.middle_name, c.pronouns,
                c.gender, c.how_we_met
         FROM notes_fts fts
         JOIN notes n ON n.id = fts.id
         JOIN contacts c ON c.id = n.contact_id
         WHERE c.vault_id = ? AND notes_fts MATCH ?
         ORDER BY rank LIMIT 20`,
        [vault_id, q],
      )

      const notes = noteRows.map((r) => ({
        ...rowToNote(r),
        contact: rowToContact({
          id: r.c_id as string,
          vault_id: r.c_vault_id as string,
          first_name: r.first_name as string,
          last_name: r.last_name as string,
          nickname: r.nickname as string,
          maiden_name: r.maiden_name as string,
          middle_name: r.middle_name as string,
          pronouns: r.pronouns as string,
          gender: r.gender as string,
          how_we_met: r.how_we_met as string,
          is_deceased: r.is_deceased as number,
          deceased_at: r.deceased_at as string | null,
          birthday: r.birthday as string | null,
          is_starred: r.is_starred as number,
          last_contacted_at: r.last_contacted_at as string | null,
          avatar_url: r.avatar_url as string | null,
          tags: r.c_tags as string,
          annotations: r.c_annotations as string,
          created_at: r.c_created_at as string,
          updated_at: r.c_updated_at as string,
          archived_at: r.c_archived_at as string | null,
        }),
      }))

      return { contacts, notes }
    }

    // DASHBOARD
    function getDashboard(vault_id: string): DashboardData {
      const upcoming_dates = getUpcomingReminders(vault_id, 30)
      const overdue_stay_in_touch = getOverdueStayInTouch(vault_id)
      const recent_interactions = getInteractions(vault_id, undefined, 10)

      const todayStr = new Date().toISOString().slice(0, 10)
      const allContacts = getContacts(vault_id)
      const upcoming_birthdays: DashboardData['upcoming_birthdays'] = []
      for (const contact of allContacts) {
        if (!contact.birthday) continue
        const [birthYearStr, month, day] = contact.birthday.split('-') as [string, string, string]
        const birthYear = Number(birthYearStr)
        const todayYear = Number(todayStr.slice(0, 4))
        let nextBirthday = `${todayYear}-${month}-${day}`
        if (nextBirthday < todayStr) nextBirthday = `${todayYear + 1}-${month}-${day}`
        const days_away = Math.round(
          (new Date(nextBirthday).getTime() - new Date(todayStr).getTime()) / 86400000,
        )
        if (days_away <= 30) {
          const nextYear = Number(nextBirthday.slice(0, 4))
          upcoming_birthdays.push({
            contact,
            days_away,
            turning_age: birthYear > 1800 ? nextYear - birthYear : null,
          })
        }
      }
      upcoming_birthdays.sort((a, b) => a.days_away - b.days_away)

      return { upcoming_dates, upcoming_birthdays, overdue_stay_in_touch, recent_interactions }
    }

    // EXPORT
    function exportVault(vault_id: string): HalcyonExport {
      const vault = rowToVault(queryRaw('SELECT * FROM vaults WHERE id = ?', [vault_id])[0]!)
      return {
        version: 1,
        exported_at: now(),
        vault,
        contacts: queryRaw('SELECT * FROM contacts WHERE vault_id = ?', [vault_id]).map(
          rowToContact,
        ),
        contact_fields: queryRaw(
          'SELECT cf.* FROM contact_fields cf JOIN contacts c ON c.id = cf.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToContactField),
        contact_field_types: queryRaw('SELECT * FROM contact_field_types WHERE vault_id = ?', [
          vault_id,
        ]).map(rowToContactFieldType),
        addresses: queryRaw(
          'SELECT a.* FROM addresses a JOIN contacts c ON c.id = a.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToAddress),
        address_types: queryRaw('SELECT * FROM address_types WHERE vault_id = ?', [vault_id]).map(
          (r) =>
            ({
              id: r.id as string,
              vault_id: r.vault_id as string,
              name: r.name as string,
            }) as AddressType,
        ),
        relationships: queryRaw(
          'SELECT r.* FROM relationships r JOIN contacts c ON c.id = r.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToRelationship),
        relationship_types: queryRaw('SELECT * FROM relationship_types WHERE vault_id = ?', [
          vault_id,
        ]).map(rowToRelationshipType),
        companies: queryRaw('SELECT * FROM companies WHERE vault_id = ?', [vault_id]).map(
          rowToCompany,
        ),
        occupations: queryRaw(
          'SELECT o.* FROM occupations o JOIN contacts c ON c.id = o.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToOccupation),
        pets: queryRaw(
          'SELECT p.* FROM pets p JOIN contacts c ON c.id = p.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToPet),
        tags: queryRaw('SELECT * FROM tags WHERE vault_id = ?', [vault_id]).map(rowToTag),
        groups: queryRaw('SELECT * FROM groups WHERE vault_id = ?', [vault_id]).map(rowToGroup),
        interactions: queryRaw('SELECT * FROM interactions WHERE vault_id = ?', [vault_id]).map(
          rowToInteraction,
        ),
        notes: queryRaw(
          'SELECT n.* FROM notes n JOIN contacts c ON c.id = n.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToNote),
        life_events: queryRaw(
          'SELECT le.* FROM life_events le JOIN contacts c ON c.id = le.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToLifeEvent),
        life_event_types: queryRaw('SELECT * FROM life_event_types WHERE vault_id = ?', [
          vault_id,
        ]).map(rowToLifeEventType),
        reminders: queryRaw(
          'SELECT r.* FROM reminders r JOIN contacts c ON c.id = r.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToReminder),
        stay_in_touch: queryRaw(
          'SELECT s.* FROM stay_in_touch s JOIN contacts c ON c.id = s.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToStayInTouch),
        tasks: queryRaw(
          'SELECT t.* FROM tasks t JOIN contacts c ON c.id = t.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToTask),
        gift_notes: queryRaw(
          'SELECT g.* FROM gift_notes g JOIN contacts c ON c.id = g.contact_id WHERE c.vault_id = ?',
          [vault_id],
        ).map(rowToGiftNote),
        journal_entries: queryRaw('SELECT * FROM journal_entries WHERE vault_id = ?', [
          vault_id,
        ]).map(rowToJournalEntry),
      }
    }

    // ─── Message handler ──────────────────────────────────────────────────────

    self.addEventListener('message', (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      let result: unknown
      try {
        switch (req.type) {
          // Vaults
          case 'GET_VAULTS':
            result = getVaults()
            break
          case 'CREATE_VAULT':
            result = createVault(req.payload)
            break
          case 'UPDATE_VAULT':
            result = updateVault(req.payload)
            break
          case 'DELETE_VAULT':
            deleteVault(req.payload.id)
            result = null
            break

          // Contacts
          case 'GET_CONTACTS':
            result = getContacts(req.payload.vault_id)
            break
          case 'GET_CONTACT':
            result = getContact(req.payload.id)
            break
          case 'GET_CONTACT_DETAIL':
            result = getContactDetail(req.payload.id)
            break
          case 'CREATE_CONTACT':
            result = createContact(req.payload)
            break
          case 'UPDATE_CONTACT':
            result = updateContact(req.payload)
            break
          case 'ARCHIVE_CONTACT':
            archiveContact(req.payload.id)
            result = null
            break
          case 'UNARCHIVE_CONTACT':
            unarchiveContact(req.payload.id)
            result = null
            break
          case 'TOGGLE_STAR_CONTACT':
            result = toggleStarContact(req.payload.id)
            break

          // Contact field types
          case 'GET_CONTACT_FIELD_TYPES':
            result = getContactFieldTypes(req.payload.vault_id)
            break
          case 'CREATE_CONTACT_FIELD_TYPE':
            result = createContactFieldType(req.payload)
            break
          case 'UPDATE_CONTACT_FIELD_TYPE':
            result = updateContactFieldType(req.payload)
            break
          case 'DELETE_CONTACT_FIELD_TYPE':
            exec('DELETE FROM contact_field_types WHERE id = ?', [req.payload.id])
            result = null
            break

          // Contact fields
          case 'CREATE_CONTACT_FIELD':
            result = createContactField(req.payload)
            break
          case 'UPDATE_CONTACT_FIELD':
            result = updateContactField(req.payload)
            break
          case 'DELETE_CONTACT_FIELD':
            exec('DELETE FROM contact_fields WHERE id = ?', [req.payload.id])
            result = null
            break

          // Addresses
          case 'GET_ADDRESS_TYPES':
            result = getAddressTypes(req.payload.vault_id)
            break
          case 'CREATE_ADDRESS_TYPE':
            exec('INSERT INTO address_types (id, vault_id, name) VALUES (?, ?, ?)', [
              crypto.randomUUID(),
              req.payload.vault_id,
              req.payload.name,
            ])
            result = null
            break
          case 'CREATE_ADDRESS':
            result = createAddress(req.payload)
            break
          case 'UPDATE_ADDRESS':
            result = updateAddress(req.payload)
            break
          case 'DELETE_ADDRESS':
            exec('DELETE FROM addresses WHERE id = ?', [req.payload.id])
            result = null
            break

          // Relationship types
          case 'GET_RELATIONSHIP_TYPES':
            result = getRelationshipTypes(req.payload.vault_id)
            break
          case 'CREATE_RELATIONSHIP_TYPE':
            result = createRelationshipType(req.payload)
            break
          case 'UPDATE_RELATIONSHIP_TYPE':
            if (req.payload.name !== undefined)
              exec('UPDATE relationship_types SET name = ? WHERE id = ?', [
                req.payload.name,
                req.payload.id,
              ])
            if (req.payload.name_reverse !== undefined)
              exec('UPDATE relationship_types SET name_reverse = ? WHERE id = ?', [
                req.payload.name_reverse,
                req.payload.id,
              ])
            result = rowToRelationshipType(
              queryRaw('SELECT * FROM relationship_types WHERE id = ?', [req.payload.id])[0]!,
            )
            break
          case 'DELETE_RELATIONSHIP_TYPE':
            exec('DELETE FROM relationship_types WHERE id = ?', [req.payload.id])
            result = null
            break
          case 'CREATE_RELATIONSHIP':
            result = createRelationship(req.payload)
            break
          case 'DELETE_RELATIONSHIP':
            exec('DELETE FROM relationships WHERE id = ?', [req.payload.id])
            result = null
            break

          // Companies
          case 'GET_COMPANIES':
            result = getCompanies(req.payload.vault_id)
            break
          case 'GET_COMPANY':
            result = getCompany(req.payload.id)
            break
          case 'GET_COMPANY_CONTACTS': {
            const rows = queryRaw(
              'SELECT c.* FROM contacts c JOIN occupations o ON o.contact_id = c.id WHERE o.company_id = ? AND c.archived_at IS NULL GROUP BY c.id',
              [req.payload.company_id],
            )
            result = rows.map(rowToContact)
            break
          }
          case 'CREATE_COMPANY':
            result = createCompany(req.payload)
            break
          case 'UPDATE_COMPANY':
            result = updateCompany(req.payload)
            break
          case 'DELETE_COMPANY':
            exec('DELETE FROM companies WHERE id = ?', [req.payload.id])
            result = null
            break

          // Occupations
          case 'GET_OCCUPATIONS':
            result = getOccupations(req.payload.contact_id)
            break
          case 'CREATE_OCCUPATION':
            result = createOccupation(req.payload)
            break
          case 'UPDATE_OCCUPATION':
            result = updateOccupation(req.payload)
            break
          case 'DELETE_OCCUPATION':
            exec('DELETE FROM occupations WHERE id = ?', [req.payload.id])
            result = null
            break

          // Pets
          case 'GET_PETS':
            result = getPets(req.payload.contact_id)
            break
          case 'CREATE_PET':
            result = createPet(req.payload)
            break
          case 'UPDATE_PET':
            result = updatePet(req.payload)
            break
          case 'DELETE_PET':
            exec('DELETE FROM pets WHERE id = ?', [req.payload.id])
            result = null
            break

          // Tags
          case 'GET_TAGS':
            result = getTags(req.payload.vault_id)
            break
          case 'CREATE_TAG':
            result = createTag(req.payload)
            break
          case 'UPDATE_TAG':
            result = updateTag(req.payload)
            break
          case 'DELETE_TAG':
            exec('DELETE FROM tags WHERE id = ?', [req.payload.id])
            result = null
            break
          case 'SET_CONTACT_TAGS':
            setContactTags(req.payload.contact_id, req.payload.tag_ids)
            result = null
            break

          // Groups
          case 'GET_GROUPS':
            result = getGroups(req.payload.vault_id)
            break
          case 'GET_GROUP':
            result = rowToGroup(queryRaw('SELECT * FROM groups WHERE id = ?', [req.payload.id])[0]!)
            break
          case 'CREATE_GROUP':
            result = createGroup(req.payload)
            break
          case 'UPDATE_GROUP':
            result = updateGroup(req.payload)
            break
          case 'DELETE_GROUP':
            exec('DELETE FROM groups WHERE id = ?', [req.payload.id])
            result = null
            break
          case 'ADD_TO_GROUP':
            exec('INSERT OR IGNORE INTO group_contacts VALUES (?, ?)', [
              req.payload.group_id,
              req.payload.contact_id,
            ])
            result = null
            break
          case 'REMOVE_FROM_GROUP':
            exec('DELETE FROM group_contacts WHERE group_id = ? AND contact_id = ?', [
              req.payload.group_id,
              req.payload.contact_id,
            ])
            result = null
            break
          case 'GET_GROUP_CONTACTS':
            result = getGroupContacts(req.payload.group_id)
            break

          // Interactions
          case 'GET_INTERACTIONS':
            result = getInteractions(
              req.payload.vault_id,
              req.payload.contact_id,
              req.payload.limit,
            )
            break
          case 'GET_INTERACTION':
            result = {
              ...rowToInteraction(
                queryRaw('SELECT * FROM interactions WHERE id = ?', [req.payload.id])[0]!,
              ),
              contacts: getInteractionContacts(req.payload.id),
            }
            break
          case 'CREATE_INTERACTION':
            result = createInteraction(req.payload)
            break
          case 'UPDATE_INTERACTION':
            result = updateInteraction(req.payload)
            break
          case 'DELETE_INTERACTION':
            deleteInteraction(req.payload.id)
            result = null
            break

          // Notes
          case 'GET_NOTES':
            result = getNotes(req.payload.contact_id)
            break
          case 'CREATE_NOTE':
            result = createNote(req.payload)
            break
          case 'UPDATE_NOTE':
            result = updateNote(req.payload)
            break
          case 'DELETE_NOTE':
            exec('DELETE FROM notes WHERE id = ?', [req.payload.id])
            syncNoteFts({ id: req.payload.id } as Note)
            result = null
            break
          case 'TOGGLE_PIN_NOTE':
            result = togglePinNote(req.payload.id)
            break

          // Life event types
          case 'GET_LIFE_EVENT_TYPES':
            result = getLifeEventTypes(req.payload.vault_id)
            break
          case 'CREATE_LIFE_EVENT_TYPE':
            result = createLifeEventType(req.payload)
            break

          // Life events
          case 'GET_LIFE_EVENTS':
            result = getLifeEvents(req.payload.contact_id)
            break
          case 'CREATE_LIFE_EVENT':
            result = createLifeEvent(req.payload)
            break
          case 'UPDATE_LIFE_EVENT':
            result = updateLifeEvent(req.payload)
            break
          case 'DELETE_LIFE_EVENT':
            exec('DELETE FROM life_events WHERE id = ?', [req.payload.id])
            result = null
            break

          // Reminders
          case 'GET_REMINDERS':
            result = getReminders(req.payload.contact_id)
            break
          case 'GET_UPCOMING_REMINDERS':
            result = getUpcomingReminders(req.payload.vault_id, req.payload.days)
            break
          case 'CREATE_REMINDER':
            result = createReminder(req.payload)
            break
          case 'UPDATE_REMINDER':
            result = updateReminder(req.payload)
            break
          case 'DONE_REMINDER':
            result = doneReminder(req.payload.id)
            break
          case 'DELETE_REMINDER':
            exec('DELETE FROM reminders WHERE id = ?', [req.payload.id])
            result = null
            break

          // Stay-in-touch
          case 'GET_STAY_IN_TOUCH':
            result = getStayInTouch(req.payload.contact_id)
            break
          case 'GET_OVERDUE_STAY_IN_TOUCH':
            result = getOverdueStayInTouch(req.payload.vault_id)
            break
          case 'SET_STAY_IN_TOUCH':
            result = setStayInTouch(req.payload.contact_id, req.payload.frequency_days)
            break
          case 'REMOVE_STAY_IN_TOUCH':
            removeStayInTouch(req.payload.contact_id)
            result = null
            break
          case 'MARK_CONTACTED':
            markContacted(req.payload.contact_id)
            result = null
            break

          // Tasks
          case 'GET_TASKS':
            result = getTasks(req.payload.contact_id)
            break
          case 'CREATE_TASK':
            result = createTask(req.payload)
            break
          case 'UPDATE_TASK':
            result = updateTask(req.payload)
            break
          case 'TOGGLE_TASK':
            result = toggleTask(req.payload.id)
            break
          case 'DELETE_TASK':
            exec('DELETE FROM tasks WHERE id = ?', [req.payload.id])
            result = null
            break

          // Gift notes
          case 'GET_GIFT_NOTES':
            result = getGiftNotes(req.payload.contact_id)
            break
          case 'CREATE_GIFT_NOTE':
            result = createGiftNote(req.payload)
            break
          case 'UPDATE_GIFT_NOTE':
            result = updateGiftNote(req.payload)
            break
          case 'MARK_GIFT_GIVEN':
            result = markGiftGiven(req.payload.id)
            break
          case 'DELETE_GIFT_NOTE':
            exec('DELETE FROM gift_notes WHERE id = ?', [req.payload.id])
            result = null
            break

          // Journal
          case 'GET_JOURNAL_ENTRIES':
            result = getJournalEntries(req.payload.vault_id)
            break
          case 'GET_JOURNAL_ENTRY':
            result = getJournalEntry(req.payload.date, req.payload.vault_id)
            break
          case 'UPSERT_JOURNAL_ENTRY':
            result = upsertJournalEntry(req.payload)
            break
          case 'DELETE_JOURNAL_ENTRY':
            exec('DELETE FROM journal_entries WHERE id = ?', [req.payload.id])
            result = null
            break

          // Search
          case 'SEARCH':
            result = search(req.payload.vault_id, req.payload.query)
            break

          // Dashboard
          case 'GET_DASHBOARD':
            result = getDashboard(req.payload.vault_id)
            break

          // Export
          case 'EXPORT_VAULT':
            result = exportVault(req.payload.vault_id)
            break

          default:
            req satisfies never
            throw new Error('Unknown request type')
        }

        self.postMessage({ id: req.id, ok: true, data: result } satisfies WorkerResponse)
      } catch (err) {
        self.postMessage({
          id: req.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies WorkerResponse)
      }
    })

    self.postMessage({ type: 'READY' })
  } catch (err) {
    self.postMessage({
      type: 'INIT_ERROR',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})()
