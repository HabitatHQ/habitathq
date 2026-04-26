import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import * as shared from '~/lib/db-shared'
import type { CheckinQuestion, DbAdapter, WorkerRequest, WorkerResponse } from '~/types/database'

// Wrapped in an async IIFE so we can return early (e.g. lock unavailable)
// without leaking unguarded top-level awaits.
await (async () => {
  // ─── Exclusive lock ───────────────────────────────────────────────────────────
  // OPFS createSyncAccessHandle is only available in *dedicated* workers — there
  // is no multi-tab SharedWorker workaround. We use the Web Locks API to detect
  // when another tab already owns the DB and bail out gracefully instead of
  // crashing with a cryptic NoModificationAllowedError.
  //
  // We retry up to 3 times with 1 s gaps because the COI service-worker and the
  // vite-pwa autoUpdate handler can both trigger page reloads in quick succession.
  // The old worker's lock releases the instant that worker is terminated, but the
  // new page can start fast enough to race it. A genuine second-tab conflict still
  // fails after ~2 s of retries.

  async function tryAcquireDbLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
      const got = await new Promise<boolean>((resolve) => {
        void navigator.locks.request('habitat-db', { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false)
            return Promise.resolve()
          }
          resolve(true)
          return new Promise(() => {}) // hold until this worker terminates
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
    // ─── DB init ──────────────────────────────────────────────────────────────────

    // Suppress sqlite-wasm's verbose console output and COOP/COEP probe warnings
    // @ts-expect-error — sqlite-wasm types omit the optional config argument
    const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} })

    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/habitat',
      clearOnInit: false,
    })
    const db = new poolUtil.OpfsSAHPoolDb('/habitat.db')
    db.exec('PRAGMA foreign_keys = ON')

    // ─── Schema ───────────────────────────────────────────────────────────────────
    //
    // CREATE TABLE IF NOT EXISTS is a no-op for existing tables, so we always
    // declare the full target schema here. For existing DBs missing new columns
    // we fall through to the ALTER TABLE migrations below.

    db.exec(`
  CREATE TABLE IF NOT EXISTS habits (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    color        TEXT NOT NULL DEFAULT '#6366f1',
    icon         TEXT NOT NULL DEFAULT 'star',
    frequency    TEXT NOT NULL DEFAULT 'daily',
    created_at   TEXT NOT NULL,
    archived_at  TEXT,
    tags         TEXT NOT NULL DEFAULT '[]',
    annotations  TEXT NOT NULL DEFAULT '{}',
    type         TEXT NOT NULL DEFAULT 'BOOLEAN',
    target_value REAL NOT NULL DEFAULT 1,
    paused_until TEXT
  );

  CREATE TABLE IF NOT EXISTS completions (
    id           TEXT PRIMARY KEY,
    habit_id     TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    tags         TEXT NOT NULL DEFAULT '[]',
    annotations  TEXT NOT NULL DEFAULT '{}',
    UNIQUE(habit_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_completions_date     ON completions(date);
  CREATE INDEX IF NOT EXISTS idx_completions_habit_id ON completions(habit_id);

  CREATE TABLE IF NOT EXISTS habit_schedules (
    id              TEXT PRIMARY KEY,
    habit_id        TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    schedule_type   TEXT NOT NULL DEFAULT 'DAILY',
    frequency_count INTEGER,
    days_of_week    TEXT,
    due_time        TEXT,
    start_date      TEXT,
    end_date        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_schedules_habit_id ON habit_schedules(habit_id);

  CREATE TABLE IF NOT EXISTS habit_logs (
    id         TEXT PRIMARY KEY,
    habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    logged_at  TEXT NOT NULL,
    value      REAL NOT NULL DEFAULT 1,
    notes      TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_habit_logs_date     ON habit_logs(date);
  CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_id ON habit_logs(habit_id);

  CREATE TABLE IF NOT EXISTS checkin_entries (
    id         TEXT PRIMARY KEY,
    entry_date TEXT UNIQUE NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_checkin_entries_date ON checkin_entries(entry_date);

  CREATE TABLE IF NOT EXISTS checkin_templates (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    schedule_type TEXT NOT NULL DEFAULT 'DAILY',
    days_active   TEXT,
    archived_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS checkin_questions (
    id            TEXT PRIMARY KEY,
    template_id   TEXT NOT NULL REFERENCES checkin_templates(id) ON DELETE CASCADE,
    prompt        TEXT NOT NULL,
    response_type TEXT NOT NULL DEFAULT 'TEXT',
    display_order INTEGER NOT NULL DEFAULT 0,
    archived_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_checkin_questions_template ON checkin_questions(template_id);

  CREATE TABLE IF NOT EXISTS checkin_completions (
    id          TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES checkin_templates(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    UNIQUE(template_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_checkin_completions_date ON checkin_completions(date);

  CREATE TABLE IF NOT EXISTS checkin_responses (
    id            TEXT PRIMARY KEY,
    question_id   TEXT NOT NULL REFERENCES checkin_questions(id) ON DELETE CASCADE,
    logged_date   TEXT NOT NULL,
    value_numeric REAL,
    value_text    TEXT,
    UNIQUE(question_id, logged_date)
  );

  CREATE INDEX IF NOT EXISTS idx_checkin_responses_date     ON checkin_responses(logged_date);
  CREATE INDEX IF NOT EXISTS idx_checkin_responses_question ON checkin_responses(question_id);

  CREATE TABLE IF NOT EXISTS applied_defaults (
    key        TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scribbles (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    annotations TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_scribbles_updated ON scribbles(updated_at);

  CREATE TABLE IF NOT EXISTS reminders (
    id           TEXT PRIMARY KEY,
    habit_id     TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    trigger_time TEXT NOT NULL,
    days_active  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_habit_id ON reminders(habit_id);

  CREATE TABLE IF NOT EXISTS checkin_reminders (
    id           TEXT PRIMARY KEY,
    template_id  TEXT NOT NULL REFERENCES checkin_templates(id) ON DELETE CASCADE,
    trigger_time TEXT NOT NULL,
    days_active  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_checkin_reminders_template ON checkin_reminders(template_id);

  CREATE TABLE IF NOT EXISTS bored_categories (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT 'sparkles',
    color      TEXT NOT NULL DEFAULT '#6366f1',
    is_system  INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bored_activities (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    category_id       TEXT NOT NULL REFERENCES bored_categories(id) ON DELETE CASCADE,
    estimated_minutes INTEGER,
    tags              TEXT NOT NULL DEFAULT '[]',
    annotations       TEXT NOT NULL DEFAULT '{}',
    is_recurring      INTEGER NOT NULL DEFAULT 0,
    recurrence_rule   TEXT,
    is_done           INTEGER NOT NULL DEFAULT 0,
    done_at           TEXT,
    done_count        INTEGER NOT NULL DEFAULT 0,
    last_done_at      TEXT,
    archived_at       TEXT,
    created_at        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bored_activities_category ON bored_activities(category_id);

  CREATE TABLE IF NOT EXISTS todos (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    due_date          TEXT,
    priority          TEXT NOT NULL DEFAULT 'medium',
    estimated_minutes INTEGER,
    is_done           INTEGER NOT NULL DEFAULT 0,
    done_at           TEXT,
    done_count        INTEGER NOT NULL DEFAULT 0,
    last_done_at      TEXT,
    tags              TEXT NOT NULL DEFAULT '[]',
    annotations       TEXT NOT NULL DEFAULT '{}',
    is_recurring      INTEGER NOT NULL DEFAULT 0,
    recurrence_rule   TEXT,
    show_in_bored     INTEGER NOT NULL DEFAULT 0,
    bored_category_id TEXT REFERENCES bored_categories(id) ON DELETE SET NULL,
    archived_at       TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
  CREATE INDEX IF NOT EXISTS idx_todos_is_done  ON todos(is_done);
`)

    // ─── Migrations ───────────────────────────────────────────────────────────────
    //
    // Each migration is keyed by its target version number and runs exactly once.
    // PRAGMA user_version persists in the database file and tracks which migrations
    // have been applied. New migrations: add a new entry and increment the key.

    function runMigrations(): void {
      const rows: Record<string, unknown>[] = []
      db.exec({
        sql: 'PRAGMA user_version',
        rowMode: 'object',
        // @ts-expect-error — sqlite-wasm types don't model rowMode:'object' callback
        callback: (row: Record<string, unknown>) => rows.push({ ...row }),
      })
      let userVersion = (rows[0]?.['user_version'] as number) ?? 0

      // Schema squashed at v10 (includes all tables via CREATE TABLE IF NOT EXISTS above).
      // Add future migrations here at key 11+.
      const migrations: Record<number, string[]> = {
        11: [
          `CREATE TABLE IF NOT EXISTS bored_categories (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'sparkles',
        color TEXT NOT NULL DEFAULT '#6366f1',
        is_system INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
          `CREATE TABLE IF NOT EXISTS bored_activities (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL REFERENCES bored_categories(id) ON DELETE CASCADE,
        estimated_minutes INTEGER, tags TEXT NOT NULL DEFAULT '[]',
        annotations TEXT NOT NULL DEFAULT '{}',
        is_recurring INTEGER NOT NULL DEFAULT 0, recurrence_rule TEXT,
        is_done INTEGER NOT NULL DEFAULT 0, done_at TEXT,
        done_count INTEGER NOT NULL DEFAULT 0, last_done_at TEXT,
        archived_at TEXT, created_at TEXT NOT NULL
      )`,
          'CREATE INDEX IF NOT EXISTS idx_bored_activities_category ON bored_activities(category_id)',
          `CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', due_date TEXT,
        priority TEXT NOT NULL DEFAULT 'medium', estimated_minutes INTEGER,
        is_done INTEGER NOT NULL DEFAULT 0, done_at TEXT,
        done_count INTEGER NOT NULL DEFAULT 0, last_done_at TEXT,
        tags TEXT NOT NULL DEFAULT '[]', annotations TEXT NOT NULL DEFAULT '{}',
        is_recurring INTEGER NOT NULL DEFAULT 0, recurrence_rule TEXT,
        show_in_bored INTEGER NOT NULL DEFAULT 0,
        bored_category_id TEXT REFERENCES bored_categories(id) ON DELETE SET NULL,
        archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
          'CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date)',
          'CREATE INDEX IF NOT EXISTS idx_todos_is_done ON todos(is_done)',
        ],
        12: [
          'ALTER TABLE checkin_templates ADD COLUMN archived_at TEXT',
          'ALTER TABLE checkin_questions ADD COLUMN archived_at TEXT',
        ],
        13: [
          `CREATE TABLE IF NOT EXISTS checkin_completions (
            id TEXT PRIMARY KEY,
            template_id TEXT NOT NULL REFERENCES checkin_templates(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            UNIQUE(template_id, date)
          )`,
          'CREATE INDEX IF NOT EXISTS idx_checkin_completions_date ON checkin_completions(date)',
        ],
        14: [
          `UPDATE habits SET icon = REPLACE(icon, 'i-heroicons-', 'i-lucide-') WHERE icon LIKE 'i-heroicons-%'`,
          `UPDATE bored_categories SET icon = REPLACE(icon, 'i-heroicons-', 'i-lucide-') WHERE icon LIKE 'i-heroicons-%'`,
        ],
      }

      for (let v = userVersion + 1; v in migrations; v++) {
        for (const sql of migrations[v]!) {
          db.exec(sql)
        }
        db.exec(`PRAGMA user_version = ${v}`)
        userVersion = v
      }

      // v15: Replace i-lucide-* class strings with registry keys
      if (userVersion > 0 && userVersion <= 14) {
        const iconMap: [string, string][] = [
          ['star', 'i-lucide-star'],
          ['heart', 'i-lucide-heart'],
          ['fire', 'i-lucide-flame'],
          ['bolt', 'i-lucide-zap'],
          ['sparkles', 'i-lucide-sparkles'],
          ['light-bulb', 'i-lucide-lightbulb'],
          ['beaker', 'i-lucide-flask-conical'],
          ['face-smile', 'i-lucide-laugh'],
          ['scale', 'i-lucide-scale'],
          ['thumbs-up', 'i-lucide-thumbs-up'],
          ['infinity-icon', 'i-lucide-infinity'],
          ['home', 'i-lucide-house'],
          ['plus', 'i-lucide-plus'],
          ['check', 'i-lucide-check'],
          ['trash', 'i-lucide-trash-2'],
          ['pencil', 'i-lucide-pencil'],
          ['play', 'i-lucide-play'],
          ['pause', 'i-lucide-pause'],
          ['stop', 'i-lucide-square'],
          ['microphone', 'i-lucide-mic'],
          ['camera', 'i-lucide-camera'],
          ['check-circle', 'i-lucide-circle-check'],
          ['shield-check', 'i-lucide-shield-check'],
          ['document-text', 'i-lucide-file-text'],
          ['book-open', 'i-lucide-book-open'],
          ['clipboard-document-list', 'i-lucide-clipboard-list'],
          ['tag', 'i-lucide-tag'],
          ['calendar', 'i-lucide-calendar'],
          ['calendar-days', 'i-lucide-calendar-days'],
          ['clock', 'i-lucide-clock'],
          ['bell', 'i-lucide-bell'],
          ['chart-bar', 'i-lucide-chart-bar'],
          ['sun', 'i-lucide-sun'],
          ['moon', 'i-lucide-moon'],
          ['cog-6-tooth', 'i-lucide-settings'],
          ['archive-box', 'i-lucide-archive'],
          ['arrow-down-tray', 'i-lucide-download'],
          ['arrow-up-tray', 'i-lucide-upload'],
          ['barbell', 'i-lucide-dumbbell'],
          ['running', 'i-lucide-person-standing'],
          ['cycling', 'i-lucide-bike'],
          ['heartbeat', 'i-lucide-heart-pulse'],
          ['sneaker', 'i-lucide-footprints'],
          ['yoga', 'i-lucide-accessibility'],
          ['stretching', 'i-lucide-move'],
          ['trophy', 'i-lucide-trophy'],
          ['medal', 'i-lucide-medal'],
          ['basketball', 'i-lucide-circle-dot'],
          ['activity', 'i-lucide-activity'],
          ['waves', 'i-lucide-waves'],
          ['weight', 'i-lucide-weight'],
          ['cooking-pot', 'i-lucide-cooking-pot'],
          ['coffee', 'i-lucide-coffee'],
          ['wine', 'i-lucide-wine'],
          ['apple', 'i-lucide-apple'],
          ['water-drop', 'i-lucide-droplets'],
          ['bowl-food', 'i-lucide-soup'],
          ['beer', 'i-lucide-beer'],
          ['leaf', 'i-lucide-leaf'],
          ['utensils', 'i-lucide-utensils'],
          ['salad', 'i-lucide-salad'],
          ['egg', 'i-lucide-egg-fried'],
          ['reading', 'i-lucide-book-open-text'],
          ['brain', 'i-lucide-brain'],
          ['graduation', 'i-lucide-graduation-cap'],
          ['puzzle', 'i-lucide-puzzle'],
          ['lightbulb', 'i-lucide-lamp'],
          ['writing', 'i-lucide-pen-tool'],
          ['translate', 'i-lucide-languages'],
          ['headphones', 'i-lucide-headphones'],
          ['notebook', 'i-lucide-notebook-pen'],
          ['library', 'i-lucide-library'],
          ['podcast', 'i-lucide-podcast'],
          ['bed', 'i-lucide-bed'],
          ['bathtub', 'i-lucide-bath'],
          ['flower-lotus', 'i-lucide-flower-2'],
          ['smiley', 'i-lucide-smile'],
          ['sunrise', 'i-lucide-sunrise'],
          ['moon-stars', 'i-lucide-moon-star'],
          ['tooth', 'i-lucide-cross'],
          ['eye-care', 'i-lucide-eye'],
          ['pill', 'i-lucide-pill'],
          ['shower', 'i-lucide-shower-head'],
          ['sofa-relax', 'i-lucide-sofa'],
          ['briefcase', 'i-lucide-briefcase'],
          ['code', 'i-lucide-code'],
          ['rocket', 'i-lucide-rocket'],
          ['target', 'i-lucide-target'],
          ['timer', 'i-lucide-timer'],
          ['calendar-check', 'i-lucide-calendar-check'],
          ['clipboard', 'i-lucide-clipboard'],
          ['chart-up', 'i-lucide-trending-up'],
          ['list-checks', 'i-lucide-list-checks'],
          ['hourglass', 'i-lucide-hourglass'],
          ['alarm', 'i-lucide-alarm-clock'],
          ['guitar', 'i-lucide-guitar'],
          ['music-notes', 'i-lucide-music'],
          ['paint-brush', 'i-lucide-paintbrush'],
          ['camera-ph', 'i-lucide-aperture'],
          ['game-controller', 'i-lucide-gamepad-2'],
          ['potted-plant', 'i-lucide-sprout'],
          ['scissors', 'i-lucide-scissors'],
          ['palette', 'i-lucide-shapes'],
          ['film', 'i-lucide-film'],
          ['drama', 'i-lucide-drama'],
          ['mic-vocal', 'i-lucide-mic-vocal'],
          ['users', 'i-lucide-users'],
          ['phone-call', 'i-lucide-phone'],
          ['chat-circle', 'i-lucide-message-circle'],
          ['envelope', 'i-lucide-mail'],
          ['hand-heart', 'i-lucide-heart-handshake'],
          ['handshake', 'i-lucide-handshake'],
          ['baby', 'i-lucide-baby'],
          ['gift', 'i-lucide-gift'],
          ['party', 'i-lucide-party-popper'],
          ['piggy-bank', 'i-lucide-piggy-bank'],
          ['wallet', 'i-lucide-wallet'],
          ['coin', 'i-lucide-coins'],
          ['receipt', 'i-lucide-receipt'],
          ['banknote', 'i-lucide-banknote'],
          ['hand-coins', 'i-lucide-hand-coins'],
          ['tree', 'i-lucide-tree-pine'],
          ['mountains', 'i-lucide-mountain'],
          ['tent', 'i-lucide-tent'],
          ['dog', 'i-lucide-dog'],
          ['paw-print', 'i-lucide-paw-print'],
          ['compass', 'i-lucide-compass'],
          ['fish', 'i-lucide-fish'],
          ['umbrella', 'i-lucide-umbrella'],
          ['plane', 'i-lucide-plane'],
          ['backpack', 'i-lucide-backpack'],
          ['map-pin', 'i-lucide-map-pin'],
          ['stethoscope', 'i-lucide-stethoscope'],
          ['thermometer', 'i-lucide-thermometer'],
          ['syringe', 'i-lucide-syringe'],
        ]
        for (const [key, cls] of iconMap) {
          db.exec(`UPDATE habits SET icon = '${key}' WHERE icon = '${cls}'`)
          db.exec(`UPDATE bored_categories SET icon = '${key}' WHERE icon = '${cls}'`)
        }
        db.exec('PRAGMA user_version = 15')
        userVersion = 15
      }

      // Ensure fresh installs (user_version = 0) are stamped at the current baseline.
      if (userVersion === 0) db.exec('PRAGMA user_version = 15')
    }

    runMigrations()

    // ─── Default seeds ────────────────────────────────────────────────────────────
    //
    // Each seed has a stable `key`. Once applied, the key is inserted into
    // `applied_defaults` and never re-seeded — even if the user deletes the data.

    function seedDefaults(): void {
      type Seed = { key: string; apply: () => void }

      function insertTemplate(
        title: string,
        schedule_type: string,
        days_active: number[] | null,
        qs: Omit<CheckinQuestion, 'id' | 'template_id' | 'archived_at'>[],
      ): void {
        const tid = crypto.randomUUID()
        exec(
          'INSERT INTO checkin_templates (id,title,schedule_type,days_active) VALUES (?,?,?,?)',
          [tid, title, schedule_type, days_active != null ? JSON.stringify(days_active) : null],
        )
        for (const q of qs) {
          exec(
            'INSERT INTO checkin_questions (id,template_id,prompt,response_type,display_order) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), tid, q.prompt, q.response_type, q.display_order],
          )
        }
      }

      const seeds: Seed[] = [
        {
          key: 'checkin_template:morning_checkin',
          apply: () =>
            insertTemplate('Morning Check-in', 'DAILY', null, [
              { prompt: 'How did you sleep?', response_type: 'SCALE', display_order: 0 },
              { prompt: 'What did you dream about?', response_type: 'TEXT', display_order: 1 },
              {
                prompt: 'How is your energy level right now?',
                response_type: 'SCALE',
                display_order: 2,
              },
              {
                prompt: "What's your main intention for today?",
                response_type: 'TEXT',
                display_order: 3,
              },
              {
                prompt: 'Are you feeling anxious or stressed?',
                response_type: 'BOOLEAN',
                display_order: 4,
              },
            ]),
        },
        {
          key: 'checkin_template:morning_dream_update',
          apply: () => {
            const rows = queryRaw(
              "SELECT id FROM checkin_templates WHERE title = 'Morning Check-in' AND archived_at IS NULL",
            )
            for (const t of rows) {
              const qs = queryRaw(
                'SELECT id, prompt FROM checkin_questions WHERE template_id = ?',
                [t['id']],
              )
              if (!qs.some((q) => q['prompt'] === 'What did you dream about?')) {
                // Shift existing orders
                exec(
                  'UPDATE checkin_questions SET display_order = display_order + 1 WHERE template_id = ? AND display_order >= 1',
                  [t['id']],
                )
                // Insert new question
                exec(
                  'INSERT INTO checkin_questions (id, template_id, prompt, response_type, display_order) VALUES (?,?,?,?,?)',
                  [crypto.randomUUID(), t['id'], 'What did you dream about?', 'TEXT', 1],
                )
              }
            }
          },
        },
        {
          key: 'checkin_template:evening_reflection',
          apply: () =>
            insertTemplate('Evening Reflection', 'DAILY', null, [
              { prompt: 'Overall mood today (1–10)?', response_type: 'SCALE', display_order: 0 },
              { prompt: 'What went well today?', response_type: 'TEXT', display_order: 1 },
              { prompt: 'What could have gone better?', response_type: 'TEXT', display_order: 2 },
              {
                prompt: 'Did you complete your main intention?',
                response_type: 'BOOLEAN',
                display_order: 3,
              },
            ]),
        },
        {
          key: 'checkin_template:weekly_review',
          apply: () =>
            insertTemplate(
              'Weekly Review',
              'WEEKLY',
              [0],
              [
                {
                  prompt: 'How would you rate this week overall (1–10)?',
                  response_type: 'SCALE',
                  display_order: 0,
                },
                { prompt: 'What were your biggest wins?', response_type: 'TEXT', display_order: 1 },
                {
                  prompt: 'Which habit are you most proud of?',
                  response_type: 'TEXT',
                  display_order: 2,
                },
                {
                  prompt: 'What will you focus on next week?',
                  response_type: 'TEXT',
                  display_order: 3,
                },
              ],
            ),
        },
        {
          key: 'bored:cat:reading',
          apply: () => {
            const id = 'bored-cat-reading'
            const now2 = new Date().toISOString()
            exec(
              'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
              [id, 'Things to Read', 'book-open', '#3b82f6', 1, 0, now2],
            )
            const acts = [
              ['Read 10 pages of current book', 'Pick up wherever you left off.', 20],
              ['Catch up on saved articles', 'Clear your reading list a bit.', 15],
              ['Wikipedia rabbit hole', 'Start on any topic and follow curiosity.', 30],
            ]
            for (const [title, description, mins] of acts) {
              exec(
                'INSERT OR IGNORE INTO bored_activities (id,title,description,category_id,estimated_minutes,tags,annotations,is_recurring,is_done,done_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [
                  crypto.randomUUID(),
                  title,
                  description,
                  id,
                  mins,
                  '[]',
                  '{}',
                  0,
                  0,
                  0,
                  new Date().toISOString(),
                ],
              )
            }
          },
        },
        {
          key: 'bored:cat:chores',
          apply: () => {
            const id = 'bored-cat-chores'
            const now2 = new Date().toISOString()
            exec(
              'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
              [id, 'Chores', 'home', '#f59e0b', 1, 1, now2],
            )
            const acts = [
              ['Clean one small area', 'A drawer, a shelf, a corner — pick one.', 15],
              ['Do laundry', "Throw in a load or fold what's waiting.", 45],
              ['Organize one drawer', 'Just one. It always feels satisfying.', 20],
            ]
            for (const [title, description, mins] of acts) {
              exec(
                'INSERT OR IGNORE INTO bored_activities (id,title,description,category_id,estimated_minutes,tags,annotations,is_recurring,is_done,done_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [
                  crypto.randomUUID(),
                  title,
                  description,
                  id,
                  mins,
                  '[]',
                  '{}',
                  0,
                  0,
                  0,
                  new Date().toISOString(),
                ],
              )
            }
          },
        },
        {
          key: 'bored:cat:contacts',
          apply: () => {
            const id = 'bored-cat-contacts'
            const now2 = new Date().toISOString()
            exec(
              'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
              [id, 'People to Contact', 'chat-circle', '#10b981', 1, 2, now2],
            )
            const acts = [
              [
                "Text a friend you haven't spoken to lately",
                'A simple "hey, how are you?" goes a long way.',
                5,
              ],
              ['Send an appreciation message', 'Tell someone you appreciate them.', 5],
              ['Catch up with family', 'Call or message a family member.', 15],
            ]
            for (const [title, description, mins] of acts) {
              exec(
                'INSERT OR IGNORE INTO bored_activities (id,title,description,category_id,estimated_minutes,tags,annotations,is_recurring,is_done,done_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [
                  crypto.randomUUID(),
                  title,
                  description,
                  id,
                  mins,
                  '[]',
                  '{}',
                  0,
                  0,
                  0,
                  new Date().toISOString(),
                ],
              )
            }
          },
        },
        {
          key: 'bored:cat:learning',
          apply: () => {
            const id = 'bored-cat-learning'
            const now2 = new Date().toISOString()
            exec(
              'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
              [id, 'Things to Learn', 'graduation', '#8b5cf6', 1, 3, now2],
            )
            const acts = [
              ['Watch a YouTube tutorial', "Pick a skill you've been curious about.", 20],
              [
                'Practice a skill for 15 min',
                "Music, language, coding — whatever you're building.",
                15,
              ],
              ['Read documentation or a how-to', 'Level up something you already use.', 20],
            ]
            for (const [title, description, mins] of acts) {
              exec(
                'INSERT OR IGNORE INTO bored_activities (id,title,description,category_id,estimated_minutes,tags,annotations,is_recurring,is_done,done_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [
                  crypto.randomUUID(),
                  title,
                  description,
                  id,
                  mins,
                  '[]',
                  '{}',
                  0,
                  0,
                  0,
                  new Date().toISOString(),
                ],
              )
            }
          },
        },
        {
          key: 'bored:cat:idle',
          apply: () => {
            const id = 'bored-cat-idle'
            const now2 = new Date().toISOString()
            exec(
              'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
              [id, 'Idle Quests', 'sparkles', '#f97316', 1, 4, now2],
            )
            const acts = [
              ['Take a 10-min walk', 'No destination needed. Just move.', 10],
              ['Stretch or light yoga', 'Even 5 minutes resets the body.', 10],
              ['Doodle without overthinking', 'Pen and paper, no expectations.', 15],
              ['Listen to a new album', 'Pick something outside your usual taste.', 30],
            ]
            for (const [title, description, mins] of acts) {
              exec(
                'INSERT OR IGNORE INTO bored_activities (id,title,description,category_id,estimated_minutes,tags,annotations,is_recurring,is_done,done_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [
                  crypto.randomUUID(),
                  title,
                  description,
                  id,
                  mins,
                  '[]',
                  '{}',
                  0,
                  0,
                  0,
                  new Date().toISOString(),
                ],
              )
            }
          },
        },
      ]

      const now = new Date().toISOString()
      for (const { key, apply } of seeds) {
        const already = queryRaw('SELECT key FROM applied_defaults WHERE key = ?', [key])
        if (already.length === 0) {
          apply()
          exec('INSERT INTO applied_defaults (key, applied_at) VALUES (?,?)', [key, now])
        }
      }
    }

    seedDefaults()

    // ─── DB export ────────────────────────────────────────────────────────────────

    /** Serialize the live database to a Uint8Array using the sqlite3_serialize C API.
     *  OpfsSAHPoolDb does not expose OO1's serialize(), so we go through wasm directly.
     *  sqlite3_serialize returns a heap-allocated buffer; we copy it into a JS
     *  Uint8Array and then free the buffer.
     */
    function exportDbBytes(): Uint8Array {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (sqlite3 as any).wasm
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (sqlite3 as any).capi
      const savedStack = w.pstack.pointer
      try {
        const pSize = w.pstack.alloc(8) // sqlite3_int64* for the byte count output
        const pData = c.sqlite3_serialize(db.pointer, 'main', pSize, 0)
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

    // ─── Low-level helpers ────────────────────────────────────────────────────────

    /** Run a SELECT and collect plain object rows. */
    function queryRaw(sql: string, bind?: unknown[]): Record<string, unknown>[] {
      const rows: Record<string, unknown>[] = []
      db.exec({
        sql,
        ...(bind !== undefined && { bind }),
        rowMode: 'object',
        // @ts-expect-error — sqlite-wasm types don't model rowMode:'object' callback signature
        callback: (row: Record<string, unknown>) => rows.push({ ...row }),
      })
      return rows
    }

    /** Run an INSERT / UPDATE / DELETE / PRAGMA. */
    function exec(sql: string, bind?: unknown[]): void {
      // @ts-expect-error — sqlite-wasm bind type narrower than unknown[]
      db.exec({ sql, ...(bind !== undefined && { bind }) })
    }

    // ─── WorkerDbAdapter ─────────────────────────────────────────────────────────
    // Wraps the synchronous wa-sqlite API in Promise.resolve() to satisfy the
    // async DbAdapter interface shared with the native (Capacitor) path.

    class WorkerDbAdapter implements DbAdapter {
      async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
        return Promise.resolve(queryRaw(sql, bind) as T[])
      }

      async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
        const rows = queryRaw(sql, bind)
        return Promise.resolve(rows.length > 0 ? (rows[0] as T) : null)
      }

      async exec(sql: string, bind?: unknown[]): Promise<void> {
        return Promise.resolve(exec(sql, bind))
      }
    }

    const adapter = new WorkerDbAdapter()

    // ─── Message loop ─────────────────────────────────────────────────────────────

    self.addEventListener('message', async (e: MessageEvent) => {
      const req = e.data as WorkerRequest
      let result: unknown
      try {
        switch (req.type) {
          case 'GET_HABITS':
            result = await shared.getHabits(adapter)
            break
          case 'CREATE_HABIT':
            result = await shared.createHabit(adapter, req.payload)
            break
          case 'UPDATE_HABIT':
            result = await shared.updateHabit(adapter, req.payload)
            break
          case 'ARCHIVE_HABIT':
            result = await shared.archiveHabit(adapter, req.payload.id)
            break
          case 'DELETE_HABIT':
            result = await shared.deleteHabit(adapter, req.payload.id)
            break
          case 'GET_COMPLETIONS_FOR_DATE':
            result = await shared.getCompletionsForDate(adapter, req.payload.date)
            break
          case 'GET_COMPLETIONS_FOR_HABIT':
            result = await shared.getCompletionsForHabit(
              adapter,
              req.payload.habit_id,
              req.payload.from,
              req.payload.to,
            )
            break
          case 'GET_COMPLETIONS_FOR_DATE_RANGE':
            result = await shared.getCompletionsForDateRange(
              adapter,
              req.payload.from,
              req.payload.to,
            )
            break
          case 'TOGGLE_COMPLETION':
            result = await shared.toggleCompletion(
              adapter,
              req.payload.habit_id,
              req.payload.date,
              req.payload.tags,
              req.payload.annotations,
            )
            break
          case 'GET_STREAK':
            result = await shared.getStreak(adapter, req.payload.habit_id)
            break
          case 'GET_ARCHIVED_HABITS':
            result = await shared.getArchivedHabits(adapter)
            break
          case 'GET_ALL_COMPLETIONS':
            result = await shared.getAllCompletions(adapter)
            break
          case 'DELETE_ALL_HABITS':
            result = await shared.deleteAllHabits(adapter)
            break
          case 'DELETE_ALL_CHECKIN_ENTRIES':
            result = await shared.deleteAllCheckinEntries(adapter)
            break
          case 'DELETE_ALL_CHECKIN_DATA':
            result = await shared.deleteAllCheckinData(adapter)
            break
          case 'DELETE_ALL_SCRIBBLES':
            result = await shared.deleteAllScribbles(adapter)
            break
          case 'CLEAR_APPLIED_DEFAULTS':
            result = await shared.clearAppliedDefaults(adapter)
            break
          case 'GET_DB_INFO':
            result = await shared.getDbInfo(adapter)
            break
          case 'INTEGRITY_CHECK':
            result = await shared.integrityCheck(adapter)
            break
          case 'IS_DEFAULT_APPLIED':
            result = await shared.isDefaultApplied(adapter, req.payload.key)
            break
          case 'MARK_DEFAULT_APPLIED':
            result = await shared.markDefaultApplied(adapter, req.payload.key)
            break
          case 'EXPORT_DB':
            result = exportDbBytes()
            break
          case 'EXPORT_JSON_DATA':
            result = await shared.exportJsonData(adapter, req.payload)
            break
          case 'IMPORT_JSON':
            result = await shared.importJson(adapter, req.payload)
            break
          case 'GET_HABIT_LOGS_FOR_DATE':
            result = await shared.getHabitLogsForDate(adapter, req.payload.date)
            break
          case 'GET_HABIT_LOGS_FOR_HABIT':
            result = await shared.getHabitLogsForHabit(
              adapter,
              req.payload.habit_id,
              req.payload.from,
              req.payload.to,
            )
            break
          case 'GET_HABIT_LOGS_FOR_DATE_RANGE':
            result = await shared.getHabitLogsForDateRange(
              adapter,
              req.payload.from,
              req.payload.to,
            )
            break
          case 'LOG_HABIT_VALUE':
            result = await shared.logHabitValue(
              adapter,
              req.payload.habit_id,
              req.payload.date,
              req.payload.value,
              req.payload.notes,
            )
            break
          case 'DELETE_HABIT_LOG':
            result = await shared.deleteHabitLog(adapter, req.payload.id)
            break
          case 'GET_SCHEDULE_FOR_HABIT':
            result = await shared.getScheduleForHabit(adapter, req.payload.habit_id)
            break
          case 'UPDATE_HABIT_SCHEDULE':
            result = await shared.updateHabitSchedule(adapter, req.payload)
            break
          case 'PAUSE_HABIT':
            result = await shared.pauseHabit(adapter, req.payload.id, req.payload.until)
            break
          case 'PAUSE_ALL_HABITS':
            result = await shared.pauseAllHabits(adapter, req.payload.until)
            break
          case 'GET_CHECKIN_ENTRY':
            result = await shared.getCheckinEntry(adapter, req.payload.date)
            break
          case 'UPSERT_CHECKIN_ENTRY':
            result = await shared.upsertCheckinEntry(adapter, req.payload.date, req.payload.content)
            break
          case 'DELETE_CHECKIN_ENTRY':
            result = await shared.deleteCheckinEntry(adapter, req.payload.id)
            break
          case 'GET_CHECKIN_ENTRIES':
            result = await shared.getCheckinEntries(adapter, req.payload.from, req.payload.to)
            break
          case 'GET_CHECKIN_TEMPLATES':
            result = await shared.getCheckinTemplates(adapter)
            break
          case 'CREATE_CHECKIN_TEMPLATE':
            result = await shared.createCheckinTemplate(adapter, req.payload)
            break
          case 'UPDATE_CHECKIN_TEMPLATE':
            result = await shared.updateCheckinTemplate(adapter, req.payload)
            break
          case 'DELETE_CHECKIN_TEMPLATE':
            result = await shared.deleteCheckinTemplate(adapter, req.payload.id)
            break
          case 'GET_CHECKIN_QUESTIONS':
            result = await shared.getCheckinQuestions(adapter, req.payload.template_id)
            break
          case 'CREATE_CHECKIN_QUESTION':
            result = await shared.createCheckinQuestion(adapter, req.payload)
            break
          case 'UPDATE_CHECKIN_QUESTION':
            result = await shared.updateCheckinQuestion(adapter, req.payload)
            break
          case 'DELETE_CHECKIN_QUESTION':
            result = await shared.deleteCheckinQuestion(adapter, req.payload.id)
            break
          case 'GET_CHECKIN_RESPONSES':
            result = await shared.getCheckinResponses(
              adapter,
              req.payload.template_id,
              req.payload.date,
            )
            break
          case 'UPSERT_CHECKIN_RESPONSE':
            result = await shared.upsertCheckinResponse(
              adapter,
              req.payload.question_id,
              req.payload.logged_date,
              req.payload.value_numeric,
              req.payload.value_text,
            )
            break
          case 'DELETE_CHECKIN_RESPONSE':
            result = await shared.deleteCheckinResponse(adapter, req.payload.id)
            break
          case 'TOGGLE_CHECKIN_COMPLETION':
            result = await shared.toggleCheckinCompletion(
              adapter,
              req.payload.template_id,
              req.payload.date,
            )
            break
          case 'GET_CHECKIN_COMPLETIONS_FOR_DATE':
            result = await shared.getCheckinCompletionsForDate(adapter, req.payload.date)
            break
          case 'GET_SCRIBBLES':
            result = await shared.getScribbles(adapter)
            break
          case 'CREATE_SCRIBBLE':
            result = await shared.createScribble(adapter, req.payload)
            break
          case 'UPDATE_SCRIBBLE':
            result = await shared.updateScribble(adapter, req.payload)
            break
          case 'DELETE_SCRIBBLE':
            result = await shared.deleteScribble(adapter, req.payload.id)
            break
          case 'GET_ALL_REMINDERS':
            result = await shared.getAllReminders(adapter)
            break
          case 'GET_REMINDERS_FOR_HABIT':
            result = await shared.getRemindersForHabit(adapter, req.payload.habit_id)
            break
          case 'CREATE_REMINDER':
            result = await shared.createReminder(
              adapter,
              req.payload.habit_id,
              req.payload.trigger_time,
              req.payload.days_active,
            )
            break
          case 'DELETE_REMINDER':
            result = await shared.deleteReminder(adapter, req.payload.id)
            break
          case 'GET_ALL_CHECKIN_REMINDERS':
            result = await shared.getAllCheckinReminders(adapter)
            break
          case 'GET_CHECKIN_REMINDERS_FOR_TEMPLATE':
            result = await shared.getCheckinRemindersForTemplate(adapter, req.payload.template_id)
            break
          case 'CREATE_CHECKIN_REMINDER':
            result = await shared.createCheckinReminder(
              adapter,
              req.payload.template_id,
              req.payload.trigger_time,
              req.payload.days_active,
            )
            break
          case 'DELETE_CHECKIN_REMINDER':
            result = await shared.deleteCheckinReminder(adapter, req.payload.id)
            break
          case 'GET_CHECKIN_TEMPLATE':
            result = await shared.getCheckinTemplate(adapter, req.payload.id)
            break
          case 'GET_CHECKIN_RESPONSE_DATES':
            result = await shared.getCheckinResponseDates(adapter)
            break
          case 'GET_CHECKIN_HISTORY':
            result = await shared.getCheckinHistory(
              adapter,
              req.payload.from,
              req.payload.to,
              req.payload.template_id,
            )
            break
          case 'GET_CHECKIN_SUMMARY_FOR_DATE':
            result = await shared.getCheckinSummaryForDate(adapter, req.payload.date)
            break
          case 'GET_SCRIBBLES_FOR_DATE':
            result = await shared.getScribblesForDate(adapter, req.payload.date)
            break
          case 'GET_BORED_CATEGORIES':
            result = await shared.getBoredCategories(adapter)
            break
          case 'CREATE_BORED_CATEGORY':
            result = await shared.createBoredCategory(adapter, req.payload)
            break
          case 'UPDATE_BORED_CATEGORY':
            result = await shared.updateBoredCategory(adapter, req.payload)
            break
          case 'DELETE_BORED_CATEGORY':
            result = await shared.deleteBoredCategory(adapter, req.payload.id)
            break
          case 'GET_BORED_ACTIVITIES':
            result = await shared.getBoredActivities(adapter)
            break
          case 'GET_BORED_ACTIVITIES_FOR_CATEGORY':
            result = await shared.getBoredActivitiesForCategory(adapter, req.payload.category_id)
            break
          case 'CREATE_BORED_ACTIVITY':
            result = await shared.createBoredActivity(adapter, req.payload)
            break
          case 'UPDATE_BORED_ACTIVITY':
            result = await shared.updateBoredActivity(adapter, req.payload)
            break
          case 'DELETE_BORED_ACTIVITY':
            result = await shared.deleteBoredActivity(adapter, req.payload.id)
            break
          case 'ARCHIVE_BORED_ACTIVITY':
            result = await shared.archiveBoredActivity(adapter, req.payload.id)
            break
          case 'MARK_BORED_ACTIVITY_DONE':
            result = await shared.markBoredActivityDone(adapter, req.payload.id)
            break
          case 'GET_BORED_ORACLE':
            result = await shared.getBoredOracle(
              adapter,
              req.payload.excluded_category_ids,
              req.payload.max_minutes,
            )
            break
          case 'DELETE_ALL_BORED_DATA':
            result = await shared.deleteAllBoredData(adapter)
            break
          case 'GET_TODOS':
            result = await shared.getTodos(adapter)
            break
          case 'CREATE_TODO':
            result = await shared.createTodo(adapter, req.payload)
            break
          case 'UPDATE_TODO':
            result = await shared.updateTodo(adapter, req.payload)
            break
          case 'DELETE_TODO':
            result = await shared.deleteTodo(adapter, req.payload.id)
            break
          case 'ARCHIVE_TODO':
            result = await shared.archiveTodo(adapter, req.payload.id)
            break
          case 'TOGGLE_TODO':
            result = await shared.toggleTodo(adapter, req.payload.id)
            break
          case 'DELETE_ALL_TODOS':
            result = await shared.deleteAllTodos(adapter)
            break
          case 'GET_CONTEXT_TAGS':
            result = await shared.getContextTags(adapter)
            break
          case 'SEARCH_GLOBAL':
            result = await shared.searchGlobal(adapter, req.payload.query)
            break
          case 'NUKE_OPFS': {
            const root = await navigator.storage.getDirectory()
            // biome-ignore lint/suspicious/noTsIgnore: tsgo and vue-tsc disagree on FileSystemDirectoryHandle iterability
            // @ts-ignore — async-iterable at runtime but not in all lib.dom typings
            for await (const [name] of root) {
              await root.removeEntry(name, { recursive: true }).catch(() => {})
            }
            result = null
            break
          }
          default:
            throw new Error(`Unknown request type: ${(req as WorkerRequest).type}`)
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
