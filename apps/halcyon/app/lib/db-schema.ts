import type { DbAdapter } from '~/types/database'

export const CURRENT_USER_VERSION = 1

export const SCHEMA_DDL = `
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
`

export async function runMigrations(db: DbAdapter): Promise<void> {
  const rows = await db.queryAll<{ user_version: number }>('PRAGMA user_version')
  const version = rows[0]?.user_version ?? 0

  if (version < 1) {
    await db.exec("INSERT OR IGNORE INTO applied_defaults (key) VALUES ('schema_v1')")
    await db.exec('PRAGMA user_version = 1')
  }
}

export async function seedDefaults(db: DbAdapter): Promise<void> {
  const exists = await db.queryAll('SELECT 1 FROM applied_defaults WHERE key = ?', [
    'default_vault',
  ])
  if (exists.length > 0) return

  const vaultId = crypto.randomUUID()
  const ts = new Date().toISOString()
  await db.exec(
    `INSERT INTO vaults (id, name, description, color, icon, created_at)
     VALUES (?, 'Personal', '', '#7c3aed', 'i-heroicons-user', ?)`,
    [vaultId, ts],
  )

  // Default field types
  const fieldTypes = [
    { name: 'Phone', icon: 'i-heroicons-phone', protocol: 'tel:' },
    { name: 'Email', icon: 'i-heroicons-envelope', protocol: 'mailto:' },
    { name: 'Website', icon: 'i-heroicons-globe-alt', protocol: '' },
    { name: 'WhatsApp', icon: 'i-heroicons-chat-bubble-oval-left', protocol: 'https://wa.me/' },
    { name: 'Twitter', icon: 'i-heroicons-at-symbol', protocol: 'https://twitter.com/' },
    { name: 'LinkedIn', icon: 'i-heroicons-briefcase', protocol: 'https://linkedin.com/in/' },
    { name: 'Instagram', icon: 'i-heroicons-camera', protocol: 'https://instagram.com/' },
  ]
  for (const t of fieldTypes) {
    await db.exec(
      `INSERT INTO contact_field_types (id, vault_id, name, icon, protocol, is_default)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [crypto.randomUUID(), vaultId, t.name, t.icon, t.protocol],
    )
  }

  // Default relationship types
  const relTypes = [
    { name: 'partner of', name_reverse: 'partner of', symmetric: 1 },
    { name: 'parent of', name_reverse: 'child of', symmetric: 0 },
    { name: 'child of', name_reverse: 'parent of', symmetric: 0 },
    { name: 'sibling of', name_reverse: 'sibling of', symmetric: 1 },
    { name: 'friend of', name_reverse: 'friend of', symmetric: 1 },
    { name: 'colleague of', name_reverse: 'colleague of', symmetric: 1 },
    { name: 'mentor of', name_reverse: 'mentee of', symmetric: 0 },
    { name: 'mentee of', name_reverse: 'mentor of', symmetric: 0 },
  ]
  for (const t of relTypes) {
    await db.exec(
      `INSERT INTO relationship_types (id, vault_id, name, name_reverse, is_symmetric, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), vaultId, t.name, t.name_reverse, t.symmetric, ts],
    )
  }

  // Default address types
  for (const name of ['Home', 'Work', 'Other']) {
    await db.exec('INSERT INTO address_types (id, vault_id, name) VALUES (?, ?, ?)', [
      crypto.randomUUID(),
      vaultId,
      name,
    ])
  }

  // Default life event types
  const eventTypes = [
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
  for (const t of eventTypes) {
    await db.exec(
      'INSERT INTO life_event_types (id, vault_id, name, icon, category) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), vaultId, t.name, t.icon, t.category],
    )
  }

  await db.exec("INSERT INTO applied_defaults (key) VALUES ('default_vault')")
}
