# Halcyon — Personal Relationship Manager

> "Peaceful, prosperous." A calm space where your relationships live.

Halcyon is an offline-first Personal Relationship Manager (PRM) built as a standalone PWA + native app. It is the anti-CRM: no leads, no pipelines, no analytics. Just people you care about, with the context you need to show up for them.

---

## Vision

The core loop: **add a person → log what happens in your relationship → get reminded to reach out → open the app with full context before every interaction.**

Primary pain solved: **losing context**. Before a call or meeting you can't remember what you talked about last time, what's going on in their life, or what you promised. Halcyon is your memory.

---

## Tech Stack

Identical to Habitat, separate app/repo, separate SQLite database file.

| Layer | Technology |
|---|---|
| Framework | Nuxt 4 (SPA mode, `ssr: false`) |
| UI | @nuxt/ui v4 · Tailwind CSS v4 |
| Color theme | Violet primary · Zinc neutral · System dark/light auto |
| DB (web) | SQLite WASM + OPFS (Web Worker, Web Locks) |
| DB (native) | @capacitor-community/sqlite |
| Native | Capacitor 8 (iOS + Android) |
| Notifications | @capacitor/local-notifications |
| Test (unit) | Vitest + happy-dom |
| Test (e2e) | Playwright |
| Lint/format | Biome |
| Type checking | tsgo + nuxt typecheck |

Worker architecture is identical to Habitat: `database.worker.ts` (SQLite WASM engine) ↔ `database.client.ts` plugin (UUID message bus) ↔ `useDatabase()` composable. Native uses `db-native.ts` mirror.

---

## Architecture

```
Pages → useDatabase() composable
      → database.client.ts plugin (UUID bus)  [web]
      → database.worker.ts (SQLite WASM + OPFS)

      → db-native.ts (Capacitor SQLite)        [native]
```

Shared: `WorkerRequest` / `WorkerResponse<T>` message union types.

---

## Data Model

### Schema Overview

```
vaults
  ├── contacts
  │    ├── contact_fields          (custom key-value: phone, email, social)
  │    ├── contact_field_types     (user-defined field type registry)
  │    ├── addresses
  │    ├── address_types
  │    ├── relationships           (contact ↔ contact, typed)
  │    ├── relationship_types
  │    ├── occupations             (contact → company)
  │    ├── pets
  │    ├── tags                    (many-to-many via contact_tags)
  │    ├── notes                   (standalone freeform notes)
  │    ├── interactions            (calls, conversations, activities, meetings)
  │    │    └── interaction_contacts  (multi-contact linkage)
  │    ├── life_events
  │    ├── life_event_types
  │    ├── reminders               (date-based yearly + one-off)
  │    ├── stay_in_touch           (cadence per contact, reset on interaction)
  │    ├── tasks
  │    └── gift_notes              (simple text gift ideas)
  ├── groups
  │    └── group_contacts
  ├── companies
  │    └── contacts (via occupations)
  └── journal_entries

applied_defaults                  (seed idempotency)
```

### Core Tables (SQL)

```sql
-- Vaults: isolated workspaces (personal / work / family)
CREATE TABLE vaults (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#7c3aed',
  icon        TEXT NOT NULL DEFAULT 'i-heroicons-home',
  created_at  TEXT NOT NULL
);

-- Contacts
CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,
  vault_id     TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL DEFAULT '',
  nickname     TEXT NOT NULL DEFAULT '',
  maiden_name  TEXT NOT NULL DEFAULT '',
  middle_name  TEXT NOT NULL DEFAULT '',
  pronouns     TEXT NOT NULL DEFAULT '',
  gender       TEXT NOT NULL DEFAULT '',
  how_we_met   TEXT NOT NULL DEFAULT '',
  is_deceased  INTEGER NOT NULL DEFAULT 0,  -- BOOLEAN
  deceased_at  TEXT,                         -- YYYY-MM-DD
  birthday     TEXT,                         -- YYYY-MM-DD
  is_starred   INTEGER NOT NULL DEFAULT 0,
  last_contacted_at TEXT,                    -- ISO timestamp (auto-updated)
  avatar_url   TEXT,
  notes_count  INTEGER NOT NULL DEFAULT 0,  -- denormalized for perf
  tags         TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  annotations  TEXT NOT NULL DEFAULT '{}',   -- JSON object
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT
);

-- Contact field types (user-defined: phone, email, whatsapp, twitter…)
CREATE TABLE contact_field_types (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,   -- "Phone", "Email", "WhatsApp"
  icon       TEXT NOT NULL DEFAULT 'i-heroicons-link',
  protocol   TEXT NOT NULL DEFAULT '',  -- "tel:", "mailto:", "https://wa.me/"
  is_default INTEGER NOT NULL DEFAULT 0
);

-- Contact fields (instances)
CREATE TABLE contact_fields (
  id         TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type_id    TEXT NOT NULL REFERENCES contact_field_types(id),
  value      TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',  -- "personal", "work"
  created_at TEXT NOT NULL
);

-- Addresses
CREATE TABLE address_types (
  id       TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name     TEXT NOT NULL   -- "Home", "Work", "Other"
);

CREATE TABLE addresses (
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

-- Relationship types (parent, child, partner, sibling, friend, colleague, …)
CREATE TABLE relationship_types (
  id           TEXT PRIMARY KEY,
  vault_id     TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,    -- "partner of"
  name_reverse TEXT NOT NULL,    -- "partner of" (symmetric) or "child of"
  is_symmetric INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE relationships (
  id         TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  related_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type_id    TEXT NOT NULL REFERENCES relationship_types(id),
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- Companies
CREATE TABLE companies (
  id          TEXT PRIMARY KEY,
  vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  website     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE occupations (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
  title       TEXT NOT NULL DEFAULT '',
  department  TEXT NOT NULL DEFAULT '',
  is_current  INTEGER NOT NULL DEFAULT 1,
  started_at  TEXT,  -- YYYY-MM-DD
  ended_at    TEXT,
  created_at  TEXT NOT NULL
);

-- Pets
CREATE TABLE pets (
  id         TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  species    TEXT NOT NULL DEFAULT '',  -- "dog", "cat", "bird"
  breed      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- Tags (vault-level registry; contact_tags is the junction)
CREATE TABLE tags (
  id       TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  color    TEXT NOT NULL DEFAULT '#7c3aed'
);

CREATE TABLE contact_tags (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

-- Groups
CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE group_contacts (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, contact_id)
);

-- Interactions (calls, conversations, activities, meetings)
CREATE TABLE interactions (
  id          TEXT PRIMARY KEY,
  vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- 'call' | 'conversation' | 'activity' | 'meeting'
  channel     TEXT,           -- for conversations: 'whatsapp' | 'sms' | 'email' | 'telegram' | 'facebook' | 'in-person'
  subject     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  happened_at TEXT NOT NULL,  -- ISO timestamp
  duration_minutes INTEGER,   -- for calls/meetings
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Multi-contact linkage for interactions
CREATE TABLE interaction_contacts (
  interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  contact_id     TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (interaction_id, contact_id)
);

-- Standalone notes (not tied to a specific interaction)
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Life events
CREATE TABLE life_event_types (
  id       TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,     -- "Got married", "Had a child", "Moved city"
  icon     TEXT NOT NULL DEFAULT 'i-heroicons-star',
  category TEXT NOT NULL DEFAULT 'personal'
);

CREATE TABLE life_events (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type_id     TEXT REFERENCES life_event_types(id) ON DELETE SET NULL,
  label       TEXT NOT NULL DEFAULT '',  -- override display name
  notes       TEXT NOT NULL DEFAULT '',
  happened_at TEXT,           -- YYYY-MM-DD (optional)
  yearly_reminder INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Reminders (date-based yearly + one-off)
CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  remind_at   TEXT NOT NULL,  -- YYYY-MM-DD
  is_yearly   INTEGER NOT NULL DEFAULT 0,
  is_done     INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  created_at  TEXT NOT NULL
);

-- Stay-in-touch cadence
CREATE TABLE stay_in_touch (
  id                  TEXT PRIMARY KEY,
  contact_id          TEXT NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
  frequency_days      INTEGER NOT NULL,  -- e.g. 30
  last_contacted_at   TEXT,              -- ISO timestamp, updated on any interaction
  next_remind_at      TEXT NOT NULL,     -- computed: last_contacted_at + frequency_days
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Tasks per contact
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  due_at      TEXT,           -- YYYY-MM-DD
  is_done     INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Gift notes (simple: just ideas per contact)
CREATE TABLE gift_notes (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  idea        TEXT NOT NULL,
  occasion    TEXT NOT NULL DEFAULT '',
  is_given    INTEGER NOT NULL DEFAULT 0,
  given_at    TEXT,
  created_at  TEXT NOT NULL
);

-- Journal (simple freeform diary)
CREATE TABLE journal_entries (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  date       TEXT NOT NULL,  -- YYYY-MM-DD
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed idempotency (mirrors Habitat pattern)
CREATE TABLE applied_defaults (
  key TEXT PRIMARY KEY
);
```

### Indexes

```sql
CREATE INDEX idx_contacts_vault     ON contacts(vault_id);
CREATE INDEX idx_contacts_name      ON contacts(last_name, first_name);
CREATE INDEX idx_contact_fields     ON contact_fields(contact_id);
CREATE INDEX idx_interactions_vault ON interactions(vault_id, happened_at DESC);
CREATE INDEX idx_interaction_contacts ON interaction_contacts(contact_id);
CREATE INDEX idx_notes_contact      ON notes(contact_id, updated_at DESC);
CREATE INDEX idx_reminders_date     ON reminders(remind_at);
CREATE INDEX idx_stay_in_touch_next ON stay_in_touch(next_remind_at);
CREATE INDEX idx_journal_vault_date ON journal_entries(vault_id, date DESC);
CREATE INDEX idx_life_events        ON life_events(contact_id);
CREATE INDEX idx_occupations        ON occupations(contact_id);
CREATE INDEX idx_companies_vault    ON companies(vault_id);
```

---

## Features

### Vaults
- Create / rename / delete vaults
- Vault selector in settings or switcher UI
- 3+ vaults: Personal, Work, Family (shared in future)
- Schema designed for future real-time sync (all entities have `vault_id`)

### Contacts
- Add / edit / archive contacts
- No required fields beyond first name
- Custom contact field types (phone, email, WhatsApp, Twitter, LinkedIn, …)
- Multiple addresses with type labels
- Birthday auto-generates yearly reminder
- Tags (filter) + Groups (clusters)
- Starred / favorite contacts
- Deceased flag with memorial date
- `last_contacted_at` auto-updated on any logged interaction

### Relationships
- Rich typed graph: partner, parent, child, sibling, friend, colleague, mentor, …
- User-configurable relationship types per vault
- Bidirectional display: contact A → B creates reverse display on B

### Companies
- Full entity with own list page
- Name, website, description, tags
- All employees listed on company page (via occupations)
- Contact → company link via occupations (title, department, is_current, dates)

### Pets
- First-class per contact: name, species, breed

### Interactions
- Types: `call`, `conversation`, `activity`, `meeting`
- Conversations carry a channel: WhatsApp, SMS, email, Telegram, Facebook, in-person
- Multi-contact: tag multiple contacts in one activity/meeting
- Interaction-level notes
- `happened_at` timestamp (defaults to now, editable)
- Logging any interaction auto-updates `last_contacted_at` and resets stay-in-touch clock

### Notes (standalone)
- Freeform notes per contact, not tied to interactions
- Pin important notes
- Full-text searchable

### Life Events
- User-configurable event types: "Got married", "Had a child", "Got promoted", …
- Optional date, optional yearly reminder

### Reminders
- **Date-based yearly**: tied to YYYY-MM-DD, repeats annually (birthdays, anniversaries)
- **One-off**: custom date + title (e.g. "Follow up after surgery March 15")
- Delivered via Capacitor Local Notifications

### Stay-in-Touch Cadence
- Per-contact frequency: "remind me every N days"
- Clock resets when: any interaction is logged OR user manually marks "I reached out"
- Shows on dashboard as "overdue" list (people you've neglected past their cadence)

### Tasks
- Standalone per-contact to-do items
- Title, notes, optional due date, done toggle

### Gift Notes
- Simple: gift idea text, occasion, is_given flag

### Groups
- Named social clusters: "College Friends", "The Johnson Family"
- Own page listing all members
- Add/remove contacts from groups

### Journal
- Simple freeform diary: title + body + date
- Per-vault
- Searchable

### Dashboard
- Upcoming dates (birthdays + yearly reminders, next 30 days)
- Recent interactions (last 10 across all contacts in vault)
- Stay-in-touch overdue (contacts past their cadence)

### Search
- Full-text search: contact names + note bodies
- SQLite FTS5 via virtual table

### Import / Export
- Import: vCard (.vcf), JSContact (JSON)
- Export: JSON (full dump), vCard (.vcf), JSContact

---

## Routes

```
/                          → Dashboard
/contacts                  → Contact list (alpha, with search)
/contacts/new              → Add contact form
/contacts/[id]             → Contact detail (unified timeline)
/contacts/[id]/edit        → Edit contact
/contacts/[id]/interactions/new  → Log interaction
/companies                 → Company list
/companies/[id]            → Company detail + employees
/groups                    → Groups list
/groups/[id]               → Group detail + members
/journal                   → Journal entry list
/journal/[date]            → Journal entry for date
/search                    → Global search
/settings                  → App settings
/settings/vault            → Vault management
/settings/field-types      → Contact field type config
/settings/relationship-types → Relationship type config
```

---

## Navigation

Bottom nav (4 tabs):
1. **Home** — Dashboard
2. **Contacts** — Contact list
3. **Journal** — Diary
4. **Search** — Global full-text

---

## Contact Detail Page (Fixed But Smart)

Sections auto-hide when empty. Order:

1. Header (avatar, name, pronouns, tags, star, deceased badge)
2. Quick contact methods (fields: phone, email, social)
3. Addresses
4. Relationships (linked contacts)
5. Occupation (current company + title)
6. Stay-in-touch status + cadence setting
7. Timeline (unified: all interactions + notes + life events)
8. Standalone notes (pinned at top)
9. Reminders
10. Tasks
11. Life events
12. Pets
13. Gift notes

---

## Testing Strategy (Red/Green TDD)

### Unit Tests (Vitest)
- `tests/unit/helpers/` — pure utility functions
- `tests/unit/db/` — database worker message handlers (in-memory SQLite via mock)
- Pattern: write failing test → implement → pass

### E2E Tests (Playwright)
- `tests/e2e/` — critical user flows
- Core flows: add contact, log interaction, search, reminder creation

### Test File Naming
- `[feature]-helpers.test.ts` — utility functions
- `[feature].worker.test.ts` — worker message handler unit tests

---

## MVP Phasing

All features shipped from the start. Build order:

1. **Foundation**: project scaffold, DB worker + schema, vault management
2. **Contacts CRUD**: add/edit/archive/list/search contacts, custom fields
3. **Interaction logging**: calls, conversations, activities, meetings (multi-contact)
4. **Notes & Timeline**: standalone notes, unified timeline per contact
5. **Relationships + Companies + Pets**: graph, company pages, pet records
6. **Reminders + Stay-in-touch**: notifications, cadence logic
7. **Groups + Tags**: organization layer
8. **Life events + Tasks + Gift notes**: secondary entities
9. **Dashboard**: upcoming dates, recent activity, overdue cadence
10. **Journal**: diary entries
11. **Import/Export**: vCard, JSContact, JSON
12. **Search**: FTS5 full-text search

---

## File Structure (mirrors Habitat)

```
app/
  workers/
    database.worker.ts      ← SQLite WASM engine, schema v1, migrations, handlers
  lib/
    db-native.ts            ← Capacitor SQLite mirror
  plugins/
    database.client.ts      ← Worker lifecycle + UUID message bus
  composables/
    useDatabase.ts          ← All DB ops
    useAppSettings.ts       ← Feature flags + UI prefs
    useVault.ts             ← Active vault state
    useNotifications.ts     ← Reminder notifications
  types/
    database.ts             ← All entity types + WorkerRequest union
  utils/
    contact-helpers.ts      ← Pure contact utilities
    interaction-helpers.ts
    reminder-helpers.ts
    format.ts               ← Date/string formatting
  pages/
    index.vue               ← Dashboard
    contacts.vue            ← Pass-through <NuxtPage />
    contacts/
      index.vue             ← Contact list
      new.vue               ← Add form
      [id].vue              ← Contact detail
      [id]/
        edit.vue
        interactions/
          new.vue
    companies.vue
    companies/
      index.vue
      [id].vue
    groups/
      index.vue
      [id].vue
    journal.vue
    journal/
      index.vue
      [date].vue
    search.vue
    settings/
      index.vue
      vault.vue
      field-types.vue
      relationship-types.vue
  layouts/
    default.vue             ← Header + bottom nav
  app.config.ts             ← primary: violet, neutral: zinc
tests/
  unit/
    helpers/
      contact-helpers.test.ts
      interaction-helpers.test.ts
      reminder-helpers.test.ts
      format.test.ts
  e2e/
    contacts.spec.ts
    interactions.spec.ts
```
