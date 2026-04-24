import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { WorkerRequest, WorkerResponse } from '~/types/database'

await (async () => {
  // ─── Exclusive lock ───────────────────────────────────────────────────────
  async function tryAcquireDbLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
      const got = await new Promise<boolean>((resolve) => {
        void navigator.locks.request('hearth-db', { ifAvailable: true }, (lock) => {
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

  const hasLock = await tryAcquireDbLock()
  if (!hasLock) {
    self.postMessage({ type: 'LOCK_UNAVAILABLE' })
    return
  }

  try {
    // ─── Init SQLite WASM ─────────────────────────────────────────────────
    // @ts-expect-error — sqlite-wasm types omit optional config
    const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} })

    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/hearth',
      clearOnInit: false,
    })
    const db = new poolUtil.OpfsSAHPoolDb('/hearth.db')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')

    // ─── Schema ───────────────────────────────────────────────────────────
    db.exec(`
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
        icon       TEXT NOT NULL DEFAULT 'i-heroicons-building-library',
        is_active  INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        id         TEXT PRIMARY KEY,
        parent_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
        name       TEXT NOT NULL,
        icon       TEXT NOT NULL DEFAULT 'i-heroicons-tag',
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
        updated_at               TEXT NOT NULL
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
    `)

    // ─── Migrations (increment user_version when adding columns) ─────────
    const version = db.selectValue('PRAGMA user_version') as number
    if (version < 1) {
      db.exec('PRAGMA user_version = 1')
    }
    if (version < 2) {
      db.exec('PRAGMA user_version = 2')
    }
    if (version < 3) {
      db.exec(`
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
      `)
      db.exec('PRAGMA user_version = 3')
    }

    // ─── Seed data ────────────────────────────────────────────────────────
    const seedApplied = db.selectValue("SELECT 1 FROM applied_defaults WHERE key = 'seed_v1'")

    if (!seedApplied) {
      const now = new Date().toISOString()
      const today = new Date().toISOString().slice(0, 10)

      // Date helpers
      function daysAgo(n: number): string {
        const d = new Date()
        d.setDate(d.getDate() - n)
        return d.toISOString().slice(0, 10)
      }

      // Users
      db.exec(
        [
          `INSERT OR IGNORE INTO users VALUES ('u1','Alex',NULL,'owner','🔥','#f59e0b',1,'${now}')`,
          `INSERT OR IGNORE INTO users VALUES ('u2','Sam',NULL,'partner','🌊','#6366f1',0,'${now}')`,
        ].join(';'),
      )

      // Accounts
      db.exec(
        [
          `INSERT OR IGNORE INTO accounts VALUES ('a1','u1','Joint Checking','checking',4250.00,'USD','#f59e0b','i-heroicons-building-library',1,'${now}')`,
          `INSERT OR IGNORE INTO accounts VALUES ('a2','u1','Savings','savings',12400.00,'USD','#22c55e','i-heroicons-banknotes',1,'${now}')`,
          `INSERT OR IGNORE INTO accounts VALUES ('a3','u1','Visa Credit','credit',-890.00,'USD','#818cf8','i-heroicons-credit-card',1,'${now}')`,
          `INSERT OR IGNORE INTO accounts VALUES ('a4','u2','Sam Checking','checking',1820.00,'USD','#6366f1','i-heroicons-building-library',1,'${now}')`,
        ].join(';'),
      )

      // Categories (parent categories)
      db.exec(
        [
          `INSERT OR IGNORE INTO categories VALUES ('c1',NULL,'Food','🍔','#f59e0b',10)`,
          `INSERT OR IGNORE INTO categories VALUES ('c2',NULL,'Transport','🚗','#6366f1',20)`,
          `INSERT OR IGNORE INTO categories VALUES ('c3',NULL,'Bills','💡','#22c55e',30)`,
          `INSERT OR IGNORE INTO categories VALUES ('c4',NULL,'Shopping','🛍️','#ec4899',40)`,
          `INSERT OR IGNORE INTO categories VALUES ('c5',NULL,'Health','❤️','#ef4444',50)`,
          `INSERT OR IGNORE INTO categories VALUES ('c6',NULL,'Entertainment','🎬','#a855f7',60)`,
          `INSERT OR IGNORE INTO categories VALUES ('c7',NULL,'Income','💰','#22c55e',70)`,
          `INSERT OR IGNORE INTO categories VALUES ('c8',NULL,'Savings','🏦','#0ea5e9',80)`,
        ].join(';'),
      )

      // Sub-categories
      db.exec(
        [
          `INSERT OR IGNORE INTO categories VALUES ('c1a','c1','Groceries','🛒','#f59e0b',1)`,
          `INSERT OR IGNORE INTO categories VALUES ('c1b','c1','Dining Out','🍽️','#fb923c',2)`,
          `INSERT OR IGNORE INTO categories VALUES ('c1c','c1','Coffee','☕','#a16207',3)`,
          `INSERT OR IGNORE INTO categories VALUES ('c2a','c2','Gas','⛽','#6366f1',1)`,
          `INSERT OR IGNORE INTO categories VALUES ('c2b','c2','Parking','🅿️','#818cf8',2)`,
          `INSERT OR IGNORE INTO categories VALUES ('c2c','c2','Public Transit','🚌','#a5b4fc',3)`,
          `INSERT OR IGNORE INTO categories VALUES ('c3a','c3','Internet','📡','#22c55e',1)`,
          `INSERT OR IGNORE INTO categories VALUES ('c3b','c3','Phone','📱','#16a34a',2)`,
          `INSERT OR IGNORE INTO categories VALUES ('c3c','c3','Utilities','🔌','#86efac',3)`,
          `INSERT OR IGNORE INTO categories VALUES ('c3d','c3','Rent / Mortgage','🏠','#4ade80',4)`,
          `INSERT OR IGNORE INTO categories VALUES ('c4a','c4','Amazon','📦','#ec4899',1)`,
          `INSERT OR IGNORE INTO categories VALUES ('c4b','c4','Clothing','👕','#f472b6',2)`,
          `INSERT OR IGNORE INTO categories VALUES ('c5a','c5','Pharmacy','💊','#ef4444',1)`,
          `INSERT OR IGNORE INTO categories VALUES ('c5b','c5','Gym','🏋️','#f87171',2)`,
          `INSERT OR IGNORE INTO categories VALUES ('c6a','c6','Streaming','📺','#a855f7',1)`,
          `INSERT OR IGNORE INTO categories VALUES ('c6b','c6','Games','🎮','#c084fc',2)`,
          `INSERT OR IGNORE INTO categories VALUES ('c7a','c7','Salary','💼','#22c55e',1)`,
          `INSERT OR IGNORE INTO categories VALUES ('c7b','c7','Freelance','💻','#4ade80',2)`,
        ].join(';'),
      )

      // Transactions — last 60 days of realistic household data
      const txns = [
        // Income
        [
          't001',
          daysAgo(30),
          5200.0,
          'a1',
          'u1',
          'income',
          'c7a',
          'Paycheck — Mid Month',
          'ACME Corp',
          0,
        ],
        [
          't002',
          daysAgo(14),
          5200.0,
          'a1',
          'u1',
          'income',
          'c7a',
          'Paycheck — End Month',
          'ACME Corp',
          0,
        ],
        [
          't003',
          daysAgo(45),
          5200.0,
          'a1',
          'u1',
          'income',
          'c7a',
          'Paycheck — Previous',
          'ACME Corp',
          0,
        ],
        [
          't004',
          daysAgo(28),
          2800.0,
          'a4',
          'u2',
          'income',
          'c7a',
          'Paycheck — Sam',
          'Designhaus',
          0,
        ],
        [
          't005',
          daysAgo(2),
          450.0,
          'a1',
          'u1',
          'income',
          'c7b',
          'Freelance invoice',
          'Client Project',
          0,
        ],
        // Food — groceries
        ['t010', daysAgo(1), -87.43, 'a1', 'u1', 'expense', 'c1a', 'Weekly shop', 'Whole Foods', 0],
        [
          't011',
          daysAgo(4),
          -63.2,
          'a1',
          'u2',
          'expense',
          'c1a',
          "Trader Joe's run",
          "Trader Joe's",
          0,
        ],
        ['t012', daysAgo(8), -94.16, 'a1', 'u1', 'expense', 'c1a', 'Costco haul', 'Costco', 0],
        [
          't013',
          daysAgo(15),
          -71.88,
          'a1',
          'u2',
          'expense',
          'c1a',
          'Weekly groceries',
          'Safeway',
          0,
        ],
        ['t014', daysAgo(22), -88.5, 'a1', 'u1', 'expense', 'c1a', 'Whole Foods', 'Whole Foods', 0],
        [
          't015',
          daysAgo(35),
          -79.34,
          'a1',
          'u2',
          'expense',
          'c1a',
          'Grocery run',
          'Whole Foods',
          0,
        ],
        // Food — dining
        [
          't020',
          daysAgo(2),
          -48.0,
          'a3',
          'u1',
          'expense',
          'c1b',
          'Date night',
          "Rosie's Bistro",
          0,
        ],
        [
          't021',
          daysAgo(5),
          -22.5,
          'a3',
          'u2',
          'expense',
          'c1b',
          'Lunch with coworkers',
          'Sweetgreen',
          0,
        ],
        [
          't022',
          daysAgo(11),
          -67.8,
          'a3',
          'u1',
          'expense',
          'c1b',
          'Birthday dinner',
          'Ocean Prime',
          0,
        ],
        [
          't023',
          daysAgo(18),
          -31.4,
          'a3',
          'u2',
          'expense',
          'c1b',
          'Thai takeout',
          'Thai Orchid',
          0,
        ],
        // Coffee
        ['t030', today, -6.5, 'a3', 'u1', 'expense', 'c1c', 'Morning coffee', 'Blue Bottle', 0],
        ['t031', daysAgo(1), -5.75, 'a3', 'u2', 'expense', 'c1c', 'Latte', 'Philz Coffee', 0],
        ['t032', daysAgo(3), -6.0, 'a3', 'u1', 'expense', 'c1c', 'Coffee', 'Blue Bottle', 0],
        [
          't033',
          daysAgo(5),
          -12.5,
          'a3',
          'u2',
          'expense',
          'c1c',
          'Coffee + muffin',
          'Philz Coffee',
          0,
        ],
        // Bills
        [
          't040',
          daysAgo(20),
          -60.0,
          'a1',
          'u1',
          'expense',
          'c3a',
          'Monthly internet',
          'Comcast',
          1,
        ],
        [
          't041',
          daysAgo(20),
          -85.0,
          'a1',
          'u1',
          'expense',
          'c3b',
          'Phone plan (2 lines)',
          'T-Mobile',
          1,
        ],
        ['t042', daysAgo(20), -142.6, 'a1', 'u1', 'expense', 'c3c', 'Electric + gas', 'PG&E', 1],
        [
          't043',
          daysAgo(1),
          -2400.0,
          'a1',
          'u1',
          'expense',
          'c3d',
          'Rent — March',
          'Property Mgmt',
          1,
        ],
        // Transport
        ['t050', daysAgo(3), -58.4, 'a3', 'u1', 'expense', 'c2a', 'Gas fill-up', 'Shell', 0],
        [
          't051',
          daysAgo(10),
          -12.0,
          'a3',
          'u2',
          'expense',
          'c2b',
          'Downtown parking',
          'ParkWhiz',
          0,
        ],
        ['t052', daysAgo(15), -55.2, 'a3', 'u1', 'expense', 'c2a', 'Gas', 'Chevron', 0],
        // Shopping
        ['t060', daysAgo(6), -43.18, 'a3', 'u1', 'expense', 'c4a', 'Amazon order', 'Amazon', 0],
        ['t061', daysAgo(12), -89.99, 'a3', 'u2', 'expense', 'c4b', 'New jeans', 'Madewell', 0],
        ['t062', daysAgo(19), -27.5, 'a3', 'u1', 'expense', 'c4a', 'Amazon order', 'Amazon', 0],
        // Entertainment
        ['t070', daysAgo(8), -15.99, 'a3', 'u1', 'expense', 'c6a', 'Netflix', 'Netflix', 1],
        ['t071', daysAgo(8), -14.99, 'a3', 'u1', 'expense', 'c6a', 'Spotify', 'Spotify', 1],
        ['t072', daysAgo(8), -19.99, 'a3', 'u1', 'expense', 'c6a', 'HBO Max', 'HBO Max', 1],
        // Health
        [
          't080',
          daysAgo(9),
          -34.5,
          'a3',
          'u2',
          'expense',
          'c5a',
          'Prescription',
          'CVS Pharmacy',
          0,
        ],
        ['t081', daysAgo(16), -55.0, 'a3', 'u1', 'expense', 'c5b', 'Monthly gym', 'Equinox', 0],
        ['t082', daysAgo(22), -18.0, 'a3', 'u2', 'expense', 'c5a', 'Vitamins', 'Walgreens', 0],
      ]

      for (const t of txns) {
        const [
          id,
          date,
          amount,
          account_id,
          user_id,
          type,
          category_id,
          description,
          merchant,
          is_private,
        ] = t
        db.exec(
          `INSERT OR IGNORE INTO transactions VALUES (
            '${id}','${date}',${amount},'USD','${account_id}',
            '${user_id}','${type}','${category_id}',
            '${String(description).replace(/'/g, "''")}',
            '${String(merchant).replace(/'/g, "''")}',
            ${is_private},0,NULL,NULL,'${now}','${now}'
          )`,
        )
      }

      // Envelopes
      db.exec(
        [
          `INSERT OR IGNORE INTO envelopes VALUES ('e1','Food','🍔','#f59e0b',600,'monthly','household','["c1","c1a","c1b","c1c"]',1,'${now}')`,
          `INSERT OR IGNORE INTO envelopes VALUES ('e2','Transport','🚗','#6366f1',300,'monthly','personal','["c2","c2a","c2b","c2c"]',1,'${now}')`,
          `INSERT OR IGNORE INTO envelopes VALUES ('e3','Bills','💡','#22c55e',3000,'monthly','household','["c3","c3a","c3b","c3c","c3d"]',0,'${now}')`,
          `INSERT OR IGNORE INTO envelopes VALUES ('e4','Shopping','🛍️','#ec4899',200,'monthly','personal','["c4","c4a","c4b"]',1,'${now}')`,
          `INSERT OR IGNORE INTO envelopes VALUES ('e5','Entertainment','🎬','#a855f7',100,'monthly','household','["c6","c6a","c6b"]',1,'${now}')`,
          `INSERT OR IGNORE INTO envelopes VALUES ('e6','Health','❤️','#ef4444',150,'monthly','personal','["c5","c5a","c5b"]',1,'${now}')`,
        ].join(';'),
      )

      // Savings goals
      db.exec(
        [
          `INSERT OR IGNORE INTO savings_goals VALUES ('g1','Vacation Fund','✈️','#0ea5e9',3000,800,'2026-08-01','household','${now}')`,
          `INSERT OR IGNORE INTO savings_goals VALUES ('g2','Emergency Fund','🛡️','#22c55e',10000,4200,NULL,'household','${now}')`,
          `INSERT OR IGNORE INTO savings_goals VALUES ('g3','New Laptop','💻','#a855f7',2500,750,'2026-06-01','personal','${now}')`,
        ].join(';'),
      )

      // IOU splits — Sam owes Alex for the Whole Foods trip (t010)
      db.exec(
        [
          `INSERT OR IGNORE INTO iou_splits VALUES ('iou1','t010','u1','u2',43.72,0,NULL,'${now}')`,
          `INSERT OR IGNORE INTO iou_splits VALUES ('iou2','t011','u2','u1',31.60,0,NULL,'${now}')`,
        ].join(';'),
      )

      // Chores
      db.exec(
        [
          `INSERT OR IGNORE INTO chores VALUES ('ch1','Take out trash','🗑️','#6366f1','weekly','household',NULL,'${now}')`,
          `INSERT OR IGNORE INTO chores VALUES ('ch2','Vacuum','🧹','#f59e0b','weekly','household','u2','${now}')`,
          `INSERT OR IGNORE INTO chores VALUES ('ch3','Groceries','🛒','#22c55e','weekly','household','u1','${now}')`,
          `INSERT OR IGNORE INTO chores VALUES ('ch4','Pay bills','💳','#ec4899','monthly','household',NULL,'${now}')`,
        ].join(';'),
      )

      db.exec(`INSERT OR IGNORE INTO applied_defaults VALUES ('seed_v1')`)
    }

    self.postMessage({ type: 'READY' })

    // ─── Message handler ─────────────────────────────────────────────────
    self.addEventListener('message', (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      void handleRequest(req).then(
        (result) =>
          self.postMessage({ id: req.id, ok: true, data: result } satisfies WorkerResponse),
        (err) =>
          self.postMessage({
            id: req.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies WorkerResponse),
      )
    })

    // ─── Period key helper ────────────────────────────────────────────────
    /**
     * Coerce a value to a type SQLite WASM's bind() accepts.
     * Arrays and plain objects are JSON-serialised; booleans become 0/1;
     * undefined becomes null.  Strings/numbers/bigint/null pass through.
     */
    function toBindVal(v: unknown): string | number | bigint | null {
      if (v === null || v === undefined) return null
      if (typeof v === 'boolean') return v ? 1 : 0
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return v
      return JSON.stringify(v) // arrays, plain objects → JSON string
    }

    /** Bind wrapper — sqlite-wasm's BindingSpec types are overly strict */
    // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm BindingSpec workaround
    const B = (values: any[]): any => ({ bind: values })

    function chorePeriodKey(frequency: string, date: string): string {
      const d = new Date(date)
      if (frequency === 'daily') return date.slice(0, 10)
      if (frequency === 'monthly') return date.slice(0, 7)
      // weekly: ISO week
      const jan4 = new Date(d.getFullYear(), 0, 4)
      const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7)
      return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
    }

    // ─── Request handler ──────────────────────────────────────────────────
    async function handleRequest(req: WorkerRequest): Promise<unknown> {
      const now = () => new Date().toISOString()
      const uuid = () => crypto.randomUUID()
      const currentPeriod = () => new Date().toISOString().slice(0, 7)

      switch (req.type) {
        // ── Users ────────────────────────────────────────────────────────
        case 'GET_USERS':
          return db.selectObjects('SELECT * FROM users ORDER BY is_current DESC, created_at')

        case 'GET_CURRENT_USER':
          return db.selectObject('SELECT * FROM users WHERE is_current = 1 LIMIT 1') ?? null

        case 'CREATE_USER': {
          const p = req.payload
          const id = uuid()
          db.exec(
            `INSERT INTO users VALUES (?,?,?,?,?,?,?,?)`,
            B([id, p.name, p.email ?? null, p.role, p.avatar_emoji, p.color, p.is_current, now()]),
          )
          return db.selectObject('SELECT * FROM users WHERE id = ?', B([id]))
        }

        case 'UPDATE_USER': {
          const { id, ...fields } = req.payload
          const sets = Object.keys(fields)
            .map((k) => `${k} = ?`)
            .join(', ')
          db.exec(
            `UPDATE users SET ${sets} WHERE id = ?`,
            B([...Object.values(fields).map(toBindVal), id]),
          )
          return db.selectObject('SELECT * FROM users WHERE id = ?', B([id]))
        }

        case 'DELETE_USER':
          db.exec('DELETE FROM users WHERE id = ?', B([req.payload.id]))
          return null

        // ── Accounts ─────────────────────────────────────────────────────
        case 'GET_ACCOUNTS':
          return db.selectObjects('SELECT * FROM accounts WHERE is_active = 1 ORDER BY created_at')

        case 'GET_ACCOUNTS_FOR_USER':
          return db.selectObjects(
            'SELECT * FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at',
            B([req.payload.user_id]),
          )

        case 'CREATE_ACCOUNT': {
          const p = req.payload
          const id = uuid()
          db.exec(
            `INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?,?)`,
            B([id, p.user_id, p.name, p.type, p.balance, p.currency, p.color, p.icon, 1, now()]),
          )
          return db.selectObject('SELECT * FROM accounts WHERE id = ?', B([id]))
        }

        case 'UPDATE_ACCOUNT': {
          const { id, ...fields } = req.payload
          const sets = Object.keys(fields)
            .map((k) => `${k} = ?`)
            .join(', ')
          db.exec(
            `UPDATE accounts SET ${sets} WHERE id = ?`,
            B([...Object.values(fields).map(toBindVal), id]),
          )
          return db.selectObject('SELECT * FROM accounts WHERE id = ?', B([id]))
        }

        case 'DELETE_ACCOUNT':
          db.exec('UPDATE accounts SET is_active = 0 WHERE id = ?', B([req.payload.id]))
          return null

        // ── Categories ───────────────────────────────────────────────────
        case 'GET_CATEGORIES':
          return db.selectObjects('SELECT * FROM categories ORDER BY sort_order, name')

        case 'GET_CATEGORY_TREE': {
          const all = db.selectObjects(
            'SELECT * FROM categories ORDER BY sort_order, name',
          ) as Array<{
            id: string
            parent_id: string | null
            name: string
            icon: string
            color: string
            sort_order: number
          }>
          const parents = all.filter((c) => !c.parent_id)
          return parents.map((p) => ({
            ...p,
            children: all.filter((c) => c.parent_id === p.id),
          }))
        }

        // ── Transactions ─────────────────────────────────────────────────
        case 'GET_TRANSACTIONS': {
          const limit = req.payload.limit ?? 50
          const offset = req.payload.offset ?? 0
          return db.selectObjects(
            `
            SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
                   u.name as user_name, u.avatar_emoji as user_avatar, a.name as account_name
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN accounts a ON t.account_id = a.id
            ORDER BY t.date DESC, t.created_at DESC
            LIMIT ? OFFSET ?
          `,
            B([limit, offset]),
          )
        }

        case 'GET_TRANSACTIONS_FOR_PERIOD': {
          const { period, user_id } = req.payload
          const start = `${period}-01`
          const end = `${period}-31`
          const query = user_id
            ? `SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
                      u.name as user_name, u.avatar_emoji as user_avatar, a.name as account_name
               FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               LEFT JOIN users u ON t.user_id = u.id
               LEFT JOIN accounts a ON t.account_id = a.id
               WHERE t.date BETWEEN '${start}' AND '${end}' AND t.user_id = '${user_id}'
               ORDER BY t.date DESC, t.created_at DESC`
            : `SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
                      u.name as user_name, u.avatar_emoji as user_avatar, a.name as account_name
               FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               LEFT JOIN users u ON t.user_id = u.id
               LEFT JOIN accounts a ON t.account_id = a.id
               WHERE t.date BETWEEN '${start}' AND '${end}'
               ORDER BY t.date DESC, t.created_at DESC`
          return db.selectObjects(query)
        }

        case 'GET_TRANSACTION':
          return (
            db.selectObject(
              `
            SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
                   u.name as user_name, u.avatar_emoji as user_avatar, a.name as account_name
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN accounts a ON t.account_id = a.id
            WHERE t.id = ?
          `,
              B([req.payload.id]),
            ) ?? null
          )

        case 'CREATE_TRANSACTION': {
          const p = req.payload
          const id = uuid()
          const ts = now()
          db.exec(
            `INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            B([
              id,
              p.date,
              p.amount,
              p.currency ?? 'USD',
              p.account_id ?? null,
              p.user_id ?? null,
              p.type,
              p.category_id ?? null,
              p.description ?? '',
              p.merchant ?? '',
              p.is_private ?? 0,
              p.is_recurring ?? 0,
              p.transfer_to_account_id ?? null,
              p.split_id ?? null,
              ts,
              ts,
            ]),
          )
          return db.selectObject('SELECT * FROM transactions WHERE id = ?', B([id]))
        }

        case 'UPDATE_TRANSACTION': {
          const { id, ...fields } = req.payload
          fields.updated_at = now()
          const sets = Object.keys(fields)
            .map((k) => `${k} = ?`)
            .join(', ')
          db.exec(
            `UPDATE transactions SET ${sets} WHERE id = ?`,
            B([...Object.values(fields).map(toBindVal), id]),
          )
          return db.selectObject('SELECT * FROM transactions WHERE id = ?', B([id]))
        }

        case 'DELETE_TRANSACTION':
          db.exec('DELETE FROM transactions WHERE id = ?', B([req.payload.id]))
          return null

        // ── Envelopes ────────────────────────────────────────────────────
        case 'GET_ENVELOPES':
          return db.selectObjects('SELECT * FROM envelopes ORDER BY created_at')

        case 'GET_ENVELOPES_WITH_SPENDING': {
          const period = req.payload.period
          const start = `${period}-01`
          const end = `${period}-31`
          const envelopes = db.selectObjects(
            'SELECT * FROM envelopes ORDER BY created_at',
          ) as Array<{
            id: string
            name: string
            icon: string
            color: string
            budget_amount: number
            period: string
            scope: string
            category_ids: string
            rollover: number
            created_at: string
          }>

          return envelopes.map((env) => {
            const catIds = JSON.parse(env.category_ids) as string[]
            if (catIds.length === 0) {
              return {
                ...env,
                spent: 0,
                rolled_over: 0,
                remaining: env.budget_amount,
                percent_used: 0,
                is_overspent: false,
              }
            }
            const placeholders = catIds.map(() => '?').join(',')
            const spent =
              (db.selectValue(
                `SELECT ABS(COALESCE(SUM(amount), 0)) FROM transactions
               WHERE type = 'expense' AND category_id IN (${placeholders})
               AND date BETWEEN ? AND ?`,
                B([...catIds.map(toBindVal), start, end]),
              ) as number) ?? 0

            const prevPeriod = db.selectObject(
              'SELECT rolled_over FROM envelope_periods WHERE envelope_id = ? AND period = ?',
              B([env.id, period]),
            ) as { rolled_over: number } | undefined

            const rolledOver = prevPeriod?.rolled_over ?? 0
            const effectiveBudget = env.budget_amount + (env.rollover ? rolledOver : 0)
            const remaining = effectiveBudget - spent
            const percentUsed =
              effectiveBudget > 0 ? Math.min((spent / effectiveBudget) * 100, 200) : 0

            return {
              ...env,
              spent,
              rolled_over: rolledOver,
              remaining,
              percent_used: percentUsed,
              is_overspent: remaining < 0,
            }
          })
        }

        case 'GET_ENVELOPE_WITH_SPENDING': {
          const { id, period } = req.payload
          const env = db.selectObject('SELECT * FROM envelopes WHERE id = ?', B([id])) as
            | {
                budget_amount: number
                category_ids: string
                rollover: number
              }
            | undefined
          if (!env) return null
          const start = `${period}-01`
          const end = `${period}-31`
          const catIds = JSON.parse(env.category_ids) as string[]
          const spent =
            catIds.length === 0
              ? 0
              : ((db.selectValue(
                  `SELECT ABS(COALESCE(SUM(amount), 0)) FROM transactions
             WHERE type = 'expense' AND category_id IN (${catIds.map(() => '?').join(',')})
             AND date BETWEEN ? AND ?`,
                  B([...catIds.map(toBindVal), start, end]),
                ) as number) ?? 0)
          const remaining = env.budget_amount - spent
          return {
            ...env,
            spent,
            remaining,
            percent_used: env.budget_amount > 0 ? (spent / env.budget_amount) * 100 : 0,
            is_overspent: remaining < 0,
          }
        }

        case 'CREATE_ENVELOPE': {
          const p = req.payload
          const id = uuid()
          db.exec(
            `INSERT INTO envelopes VALUES (?,?,?,?,?,?,?,?,?,?)`,
            B([
              id,
              p.name,
              p.icon,
              p.color,
              p.budget_amount,
              p.period ?? 'monthly',
              p.scope ?? 'personal',
              toBindVal(p.category_ids) ?? '[]',
              p.rollover ?? 1,
              now(),
            ]),
          )
          return db.selectObject('SELECT * FROM envelopes WHERE id = ?', B([id]))
        }

        case 'UPDATE_ENVELOPE': {
          const { id, ...fields } = req.payload
          const sets = Object.keys(fields)
            .map((k) => `${k} = ?`)
            .join(', ')
          db.exec(
            `UPDATE envelopes SET ${sets} WHERE id = ?`,
            B([...Object.values(fields).map(toBindVal), id]),
          )
          return db.selectObject('SELECT * FROM envelopes WHERE id = ?', B([id]))
        }

        case 'DELETE_ENVELOPE':
          db.exec('DELETE FROM envelopes WHERE id = ?', B([req.payload.id]))
          return null

        // ── Savings Goals ─────────────────────────────────────────────────
        case 'GET_SAVINGS_GOALS':
          return db.selectObjects('SELECT * FROM savings_goals ORDER BY created_at')

        case 'CREATE_SAVINGS_GOAL': {
          const p = req.payload
          const id = uuid()
          db.exec(
            `INSERT INTO savings_goals VALUES (?,?,?,?,?,?,?,?,?)`,
            B([
              id,
              p.name,
              p.icon,
              p.color,
              p.target_amount,
              p.current_amount ?? 0,
              p.target_date ?? null,
              p.scope ?? 'personal',
              now(),
            ]),
          )
          return db.selectObject('SELECT * FROM savings_goals WHERE id = ?', B([id]))
        }

        case 'UPDATE_SAVINGS_GOAL': {
          const { id, ...fields } = req.payload
          const sets = Object.keys(fields)
            .map((k) => `${k} = ?`)
            .join(', ')
          db.exec(
            `UPDATE savings_goals SET ${sets} WHERE id = ?`,
            B([...Object.values(fields).map(toBindVal), id]),
          )
          return db.selectObject('SELECT * FROM savings_goals WHERE id = ?', B([id]))
        }

        case 'DELETE_SAVINGS_GOAL':
          db.exec('DELETE FROM savings_goals WHERE id = ?', B([req.payload.id]))
          return null

        // ── IOU Splits ────────────────────────────────────────────────────
        case 'GET_IOU_SPLITS':
          return db.selectObjects('SELECT * FROM iou_splits ORDER BY created_at DESC')

        case 'GET_IOU_BALANCES': {
          const splits = db.selectObjects(`
            SELECT s.*, uf.name as from_name, uf.avatar_emoji as from_avatar,
                   ut.name as to_name, ut.avatar_emoji as to_avatar
            FROM iou_splits s
            LEFT JOIN users uf ON s.from_user_id = uf.id
            LEFT JOIN users ut ON s.to_user_id = ut.id
            WHERE s.is_settled = 0
          `) as Array<{
            from_user_id: string
            to_user_id: string
            amount: number
            from_name: string
            from_avatar: string
            to_name: string
            to_avatar: string
          }>

          // Aggregate net balances per user pair
          const balanceMap = new Map<string, number>()
          const metaMap = new Map<
            string,
            { from_name: string; from_avatar: string; to_name: string; to_avatar: string }
          >()

          for (const s of splits) {
            const key = [s.from_user_id, s.to_user_id].sort().join('|')
            const isForward = s.from_user_id < s.to_user_id
            const current = balanceMap.get(key) ?? 0
            balanceMap.set(key, current + (isForward ? s.amount : -s.amount))
            metaMap.set(key, {
              from_name: s.from_name,
              from_avatar: s.from_avatar,
              to_name: s.to_name,
              to_avatar: s.to_avatar,
            })
          }

          return Array.from(balanceMap.entries())
            .filter(([, amt]) => Math.abs(amt) > 0.01)
            .map(([key, netAmount]) => {
              const [uid1, uid2] = key.split('|')
              const meta = metaMap.get(key)!
              return {
                from_user_id: uid1,
                to_user_id: uid2,
                from_user_name: meta.from_name,
                to_user_name: meta.to_name,
                from_user_avatar: meta.from_avatar,
                to_user_avatar: meta.to_avatar,
                net_amount: netAmount,
              }
            })
        }

        case 'CREATE_IOU_SPLIT': {
          const p = req.payload
          const id = uuid()
          db.exec(
            `INSERT INTO iou_splits VALUES (?,?,?,?,?,?,?,?)`,
            B([
              id,
              p.transaction_id ?? null,
              p.from_user_id,
              p.to_user_id,
              p.amount,
              0,
              null,
              now(),
            ]),
          )
          return db.selectObject('SELECT * FROM iou_splits WHERE id = ?', B([id]))
        }

        case 'SETTLE_IOU': {
          const { from_user_id, to_user_id } = req.payload
          db.exec(
            `UPDATE iou_splits SET is_settled = 1, settled_at = ?
             WHERE is_settled = 0 AND (
               (from_user_id = ? AND to_user_id = ?) OR
               (from_user_id = ? AND to_user_id = ?)
             )`,
            B([now(), from_user_id, to_user_id, to_user_id, from_user_id]),
          )
          return null
        }

        // ── Dashboard ─────────────────────────────────────────────────────
        case 'GET_DASHBOARD_SUMMARY': {
          const period = req.payload.period || currentPeriod()
          const start = `${period}-01`
          const end = `${period}-31`

          const spent =
            (db.selectValue(
              `SELECT ABS(COALESCE(SUM(amount), 0)) FROM transactions
             WHERE type = 'expense' AND date BETWEEN ? AND ?`,
              B([start, end]),
            ) as number) ?? 0

          const income =
            (db.selectValue(
              `SELECT COALESCE(SUM(amount), 0) FROM transactions
             WHERE type = 'income' AND date BETWEEN ? AND ?`,
              B([start, end]),
            ) as number) ?? 0

          const envelopes = db.selectObjects(
            'SELECT * FROM envelopes ORDER BY created_at',
          ) as Array<{
            id: string
            name: string
            icon: string
            color: string
            budget_amount: number
            period: string
            scope: string
            category_ids: string
            rollover: number
            created_at: string
          }>

          const budgetTotal = envelopes.reduce((sum, e) => sum + e.budget_amount, 0)

          const envelopesWithSpending = envelopes.map((env) => {
            const catIds = JSON.parse(env.category_ids) as string[]
            if (catIds.length === 0)
              return {
                ...env,
                spent: 0,
                rolled_over: 0,
                remaining: env.budget_amount,
                percent_used: 0,
                is_overspent: false,
              }
            const envSpent =
              (db.selectValue(
                `SELECT ABS(COALESCE(SUM(amount), 0)) FROM transactions
               WHERE type = 'expense' AND category_id IN (${catIds.map(() => '?').join(',')})
               AND date BETWEEN ? AND ?`,
                B([...catIds.map(toBindVal), start, end]),
              ) as number) ?? 0
            const remaining = env.budget_amount - envSpent
            return {
              ...env,
              spent: envSpent,
              rolled_over: 0,
              remaining,
              percent_used: env.budget_amount > 0 ? (envSpent / env.budget_amount) * 100 : 0,
              is_overspent: remaining < 0,
            }
          })

          const budgetRemaining = budgetTotal - spent

          const recentTxns = db.selectObjects(`
            SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
                   u.name as user_name, u.avatar_emoji as user_avatar, a.name as account_name
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN accounts a ON t.account_id = a.id
            WHERE t.is_private = 0
            ORDER BY t.date DESC, t.created_at DESC
            LIMIT 8
          `)

          const goals = db.selectObjects('SELECT * FROM savings_goals ORDER BY created_at')

          // IOU balances (reuse logic from GET_IOU_BALANCES)
          const splits = db.selectObjects(`
            SELECT s.*, uf.name as from_name, uf.avatar_emoji as from_avatar,
                   ut.name as to_name, ut.avatar_emoji as to_avatar
            FROM iou_splits s
            LEFT JOIN users uf ON s.from_user_id = uf.id
            LEFT JOIN users ut ON s.to_user_id = ut.id
            WHERE s.is_settled = 0
          `) as Array<{
            from_user_id: string
            to_user_id: string
            amount: number
            from_name: string
            from_avatar: string
            to_name: string
            to_avatar: string
          }>

          const balanceMap = new Map<string, number>()
          const metaMap = new Map<
            string,
            { from_name: string; from_avatar: string; to_name: string; to_avatar: string }
          >()
          for (const s of splits) {
            const key = [s.from_user_id, s.to_user_id].sort().join('|')
            const isForward = s.from_user_id < s.to_user_id
            balanceMap.set(key, (balanceMap.get(key) ?? 0) + (isForward ? s.amount : -s.amount))
            metaMap.set(key, {
              from_name: s.from_name,
              from_avatar: s.from_avatar,
              to_name: s.to_name,
              to_avatar: s.to_avatar,
            })
          }
          const iouBalances = Array.from(balanceMap.entries())
            .filter(([, amt]) => Math.abs(amt) > 0.01)
            .map(([key, netAmount]) => {
              const [uid1, uid2] = key.split('|')
              const meta = metaMap.get(key)!
              return {
                from_user_id: uid1,
                to_user_id: uid2,
                from_user_name: meta.from_name,
                to_user_name: meta.to_name,
                from_user_avatar: meta.from_avatar,
                to_user_avatar: meta.to_avatar,
                net_amount: netAmount,
              }
            })

          return {
            spent_this_month: spent,
            income_this_month: income,
            budget_total: budgetTotal,
            budget_remaining: budgetRemaining,
            envelopes: envelopesWithSpending,
            recent_transactions: recentTxns,
            savings_goals: goals,
            iou_balances: iouBalances,
          }
        }

        // ── Utilities ─────────────────────────────────────────────────────
        case 'GET_DB_INFO': {
          const txCount = db.selectValue('SELECT COUNT(*) FROM transactions') as number
          const userCount = db.selectValue('SELECT COUNT(*) FROM users') as number
          const accountCount = db.selectValue('SELECT COUNT(*) FROM accounts') as number
          const envCount = db.selectValue('SELECT COUNT(*) FROM envelopes') as number
          return {
            size_bytes: 0,
            transaction_count: txCount,
            user_count: userCount,
            account_count: accountCount,
            envelope_count: envCount,
          }
        }

        case 'EXPORT_DB':
          // @ts-expect-error export() exists at runtime but missing from OpfsSAHPoolDatabase types
          return db.export()

        case 'EXPORT_JSON': {
          return {
            version: '1.0',
            exported_at: now(),
            users: db.selectObjects('SELECT * FROM users'),
            accounts: db.selectObjects('SELECT * FROM accounts'),
            categories: db.selectObjects('SELECT * FROM categories'),
            transactions: db.selectObjects('SELECT * FROM transactions'),
            envelopes: db.selectObjects('SELECT * FROM envelopes'),
            envelope_periods: db.selectObjects('SELECT * FROM envelope_periods'),
            iou_splits: db.selectObjects('SELECT * FROM iou_splits'),
            savings_goals: db.selectObjects('SELECT * FROM savings_goals'),
            chores: db.selectObjects('SELECT * FROM chores'),
          }
        }

        case 'NUKE_OPFS':
          db.close()
          await poolUtil.removeVfs()
          return null

        // ── Chores ───────────────────────────────────────────────────────
        case 'GET_CHORES_WITH_STATUS': {
          const { date } = req.payload
          const chores = db.selectObjects('SELECT * FROM chores ORDER BY created_at') as Array<{
            id: string
            frequency: string
          }>
          return chores.map((c) => {
            const pk = chorePeriodKey(c.frequency, date)
            const row = db.selectObject(
              `
              SELECT cc.completed_at, cc.id IS NOT NULL AS is_done,
                     u_done.name AS completed_by_name, u_done.avatar_emoji AS completed_by_avatar,
                     u_assigned.name AS assigned_to_name, u_assigned.avatar_emoji AS assigned_to_avatar
              FROM chores ch
              LEFT JOIN chore_completions cc ON cc.chore_id = ch.id AND cc.period_key = ?
              LEFT JOIN users u_done ON u_done.id = cc.user_id
              LEFT JOIN users u_assigned ON u_assigned.id = ch.assigned_to
              WHERE ch.id = ?
            `,
              B([pk, c.id]),
            ) as
              | {
                  completed_at: string | null
                  is_done: number | null
                  completed_by_name: string | null
                  completed_by_avatar: string | null
                  assigned_to_name: string | null
                  assigned_to_avatar: string | null
                }
              | undefined
            return {
              ...c,
              is_done: Boolean(row?.is_done),
              completed_at: row?.completed_at ?? null,
              completed_by_name: row?.completed_by_name ?? null,
              completed_by_avatar: row?.completed_by_avatar ?? null,
              assigned_to_name: row?.assigned_to_name ?? null,
              assigned_to_avatar: row?.assigned_to_avatar ?? null,
              period_key: pk,
            }
          })
        }

        case 'CREATE_CHORE': {
          const p = req.payload
          const id = uuid()
          db.exec(
            `INSERT INTO chores VALUES (?,?,?,?,?,?,?,?)`,
            B([id, p.name, p.icon, p.color, p.frequency, p.scope, p.assigned_to ?? null, now()]),
          )
          return db.selectObject('SELECT * FROM chores WHERE id = ?', B([id]))
        }

        case 'UPDATE_CHORE': {
          const { id, ...fields } = req.payload
          const sets = Object.keys(fields)
            .map((k) => `${k} = ?`)
            .join(', ')
          db.exec(
            `UPDATE chores SET ${sets} WHERE id = ?`,
            B([...Object.values(fields).map(toBindVal), id]),
          )
          return db.selectObject('SELECT * FROM chores WHERE id = ?', B([id]))
        }

        case 'DELETE_CHORE':
          db.exec('DELETE FROM chores WHERE id = ?', B([req.payload.id]))
          return null

        case 'COMPLETE_CHORE': {
          const { chore_id, user_id, date } = req.payload
          const chore = db.selectObject(
            'SELECT frequency FROM chores WHERE id = ?',
            B([chore_id]),
          ) as { frequency: string } | undefined
          if (!chore) throw new Error('Chore not found')
          const pk = chorePeriodKey(chore.frequency, date)
          const id = uuid()
          const ts = now()
          db.exec(
            `INSERT OR IGNORE INTO chore_completions VALUES (?,?,?,?,?,?)`,
            B([id, chore_id, user_id, ts, pk, ts]),
          )
          return null
        }

        case 'UNCOMPLETE_CHORE': {
          const { chore_id, date } = req.payload
          const chore = db.selectObject(
            'SELECT frequency FROM chores WHERE id = ?',
            B([chore_id]),
          ) as { frequency: string } | undefined
          if (!chore) throw new Error('Chore not found')
          const pk = chorePeriodKey(chore.frequency, date)
          db.exec(
            'DELETE FROM chore_completions WHERE chore_id = ? AND period_key = ?',
            B([chore_id, pk]),
          )
          return null
        }

        // ── Merchant Mappings ─────────────────────────────────────────────
        case 'GET_MERCHANT_MAPPINGS': {
          return db.selectObjects('SELECT * FROM merchant_mappings ORDER BY use_count DESC')
        }

        case 'GET_MERCHANT_MAPPING': {
          const m = req.payload.merchant.toLowerCase().trim()
          return (
            db.selectObject('SELECT * FROM merchant_mappings WHERE merchant = ?', B([m])) ?? null
          )
        }

        case 'UPSERT_MERCHANT_MAPPING': {
          const { merchant, category_id, account_id } = req.payload
          const normalized = merchant.toLowerCase().trim()
          const id = uuid()
          const ts = now()
          db.exec(
            `INSERT INTO merchant_mappings (id, merchant, category_id, account_id, use_count, last_used_at, created_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)
             ON CONFLICT(merchant) DO UPDATE SET
               category_id  = excluded.category_id,
               account_id   = excluded.account_id,
               use_count    = use_count + 1,
               last_used_at = excluded.last_used_at`,
            B([id, normalized, category_id, account_id ?? null, ts, ts]),
          )
          return db.selectObject(
            'SELECT * FROM merchant_mappings WHERE merchant = ?',
            B([normalized]),
          )
        }

        case 'GET_RECENT_ACCOUNT_BY_TYPE': {
          const { type } = req.payload
          return (
            db.selectObject(
              `SELECT account_id, COUNT(*) as cnt
               FROM transactions WHERE type = ?
               GROUP BY account_id ORDER BY cnt DESC LIMIT 1`,
              B([type]),
            ) ?? null
          )
        }

        default:
          throw new Error(`Unknown request type: ${(req as WorkerRequest).type}`)
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'INIT_ERROR',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})()
