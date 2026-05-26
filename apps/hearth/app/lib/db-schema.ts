import type { MigrationExec, SchemaConfig, Seed } from '@palladium/core'
import { MIGRATION_V7_SQL } from '~/lib/migrations/v7-multi-currency'
import { MIGRATION_V8_SQL } from '~/lib/migrations/v8-icons-lucide'

export const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT,
    role         TEXT NOT NULL DEFAULT 'owner',
    avatar_emoji TEXT NOT NULL DEFAULT '🏠',
    color        TEXT NOT NULL DEFAULT '#f59e0b',
    is_current   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'checking',
    balance    REAL NOT NULL DEFAULT 0,
    currency   TEXT NOT NULL DEFAULT 'USD',
    color      TEXT NOT NULL DEFAULT '#f59e0b',
    icon       TEXT NOT NULL DEFAULT 'i-lucide-landmark',
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT 'i-lucide-tag',
    color      TEXT NOT NULL DEFAULT '#94a3b8',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id                       TEXT PRIMARY KEY,
    date                     TEXT NOT NULL,
    amount                   REAL NOT NULL,
    currency                 TEXT NOT NULL DEFAULT 'USD',
    account_id               TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    user_id                  TEXT REFERENCES users(id) ON DELETE SET NULL,
    type                     TEXT NOT NULL DEFAULT 'expense',
    category_id              TEXT REFERENCES categories(id) ON DELETE SET NULL,
    description              TEXT NOT NULL DEFAULT '',
    merchant                 TEXT NOT NULL DEFAULT '',
    is_private               INTEGER NOT NULL DEFAULT 0,
    is_recurring             INTEGER NOT NULL DEFAULT 0,
    transfer_to_account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    split_id                 TEXT,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL,
    source                   TEXT NOT NULL DEFAULT 'manual',
    home_amount              REAL,
    exchange_rate            REAL
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);

  CREATE TABLE IF NOT EXISTS envelopes (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    icon           TEXT NOT NULL DEFAULT '📦',
    color          TEXT NOT NULL DEFAULT '#f59e0b',
    budget_amount  REAL NOT NULL DEFAULT 0,
    period         TEXT NOT NULL DEFAULT 'monthly',
    scope          TEXT NOT NULL DEFAULT 'personal',
    category_ids   TEXT NOT NULL DEFAULT '[]',
    rollover       INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS envelope_periods (
    id          TEXT PRIMARY KEY,
    envelope_id TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
    period      TEXT NOT NULL,
    spent       REAL NOT NULL DEFAULT 0,
    rolled_over REAL NOT NULL DEFAULT 0,
    UNIQUE(envelope_id, period)
  );

  CREATE TABLE IF NOT EXISTS iou_splits (
    id              TEXT PRIMARY KEY,
    transaction_id  TEXT REFERENCES transactions(id) ON DELETE CASCADE,
    from_user_id    TEXT NOT NULL,
    to_user_id      TEXT NOT NULL,
    amount          REAL NOT NULL,
    is_settled      INTEGER NOT NULL DEFAULT 0,
    settled_at      TEXT,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS savings_goals (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    icon           TEXT NOT NULL DEFAULT '🎯',
    color          TEXT NOT NULL DEFAULT '#f59e0b',
    target_amount  REAL NOT NULL,
    current_amount REAL NOT NULL DEFAULT 0,
    target_date    TEXT,
    scope          TEXT NOT NULL DEFAULT 'personal',
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applied_defaults (
    key TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS chores (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT '✅',
    color       TEXT NOT NULL DEFAULT '#f59e0b',
    frequency   TEXT NOT NULL DEFAULT 'weekly',
    scope       TEXT NOT NULL DEFAULT 'household',
    assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chore_completions (
    id           TEXT PRIMARY KEY,
    chore_id     TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL,
    period_key   TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS merchant_mappings (
    id           TEXT PRIMARY KEY,
    merchant     TEXT NOT NULL UNIQUE,
    category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
    account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    use_count    INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_merchant_mappings_merchant
    ON merchant_mappings(merchant);

  CREATE TABLE IF NOT EXISTS recurring_patterns (
    id              TEXT PRIMARY KEY,
    merchant        TEXT NOT NULL,
    type            TEXT NOT NULL CHECK(type IN ('expense', 'income', 'transfer')),
    interval        TEXT NOT NULL CHECK("interval" IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual')),
    average_amount  REAL NOT NULL,
    last_occurrence TEXT NOT NULL,
    next_expected   TEXT NOT NULL,
    confidence      REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'detected' CHECK(status IN ('detected', 'confirmed', 'dismissed')),
    category_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
    account_id      TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    transaction_ids TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS receipt_images (
    id             TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    image_data     BLOB NOT NULL,
    mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
    file_size      INTEGER NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS exchange_rates (
    base   TEXT NOT NULL,
    target TEXT NOT NULL,
    rate   REAL NOT NULL,
    date   TEXT NOT NULL,
    PRIMARY KEY(base, target, date)
  );
`

// ─── Default seed: create initial user + account ─────────────────────────────

const SEEDS: Seed[] = [
  {
    key: 'default-user-account',
    apply: async (exec: MigrationExec) => {
      const existingUser = await exec<{ id: string }>('SELECT id FROM users LIMIT 1')
      const existingAccount = await exec<{ id: string }>('SELECT id FROM accounts LIMIT 1')
      if (existingUser.length > 0 && existingAccount.length > 0) return

      const now = new Date().toISOString()
      let userId = existingUser[0]?.id
      if (!userId) {
        userId = crypto.randomUUID()
        await exec(
          'INSERT INTO users (id, name, role, avatar_emoji, color, is_current, created_at) VALUES (?,?,?,?,?,?,?)',
          [userId, 'Me', 'owner', '🏠', '#f59e0b', 1, now],
        )
      }
      if (existingAccount.length === 0) {
        await exec(
          'INSERT INTO accounts (id, user_id, name, type, balance, currency, color, icon, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [
            crypto.randomUUID(),
            userId,
            'Cash',
            'checking',
            0,
            'USD',
            '#f59e0b',
            'i-lucide-wallet',
            1,
            now,
          ],
        )
      }
    },
  },
]

// ─── Schema config ───────────────────────────────────────────────────────────

export const SCHEMA_CONFIG: SchemaConfig = {
  schema: SCHEMA_DDL,
  version: 9,
  migrations: {
    7: MIGRATION_V7_SQL,
    8: MIGRATION_V8_SQL,
    9: [
      async (exec: MigrationExec) => {
        await exec(
          'CREATE TABLE IF NOT EXISTS _palladium_seeds (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
        )
        const existing = await exec<{ key: string }>('SELECT key FROM applied_defaults')
        for (const row of existing) {
          await exec('INSERT OR IGNORE INTO _palladium_seeds (key, applied_at) VALUES (?, ?)', [
            row.key,
            new Date().toISOString(),
          ])
        }
      },
    ],
  },
  seeds: SEEDS,
}
