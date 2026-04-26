import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import * as shared from '~/lib/db-shared'
import type { CheckinQuestion, DbAdapter, WorkerRequestBody } from '~/types/database'

// ─── Connection singleton ─────────────────────────────────────────────────────

const sqliteConn = new SQLiteConnection(CapacitorSQLite)
let _db: SQLiteDBConnection | null = null

function db(): SQLiteDBConnection {
  if (!_db) throw new Error('Native DB not initialized')
  return _db
}

// ─── Low-level helpers ────────────────────────────────────────────────────────

async function queryRaw(sql: string, bind?: unknown[]): Promise<Record<string, unknown>[]> {
  const result = await db().query(sql, bind as (string | number | null)[] | undefined)
  return (result.values ?? []) as Record<string, unknown>[]
}

async function exec(sql: string, bind?: unknown[]): Promise<void> {
  const s = sql.trim().toUpperCase()
  if (s === 'BEGIN') {
    await db().beginTransaction()
    return
  }
  if (s === 'COMMIT') {
    await db().commitTransaction()
    return
  }
  if (s === 'ROLLBACK') {
    await db().rollbackTransaction()
    return
  }
  if (bind && bind.length > 0) {
    await db().run(sql, bind as (string | number | boolean | null)[], false)
  } else {
    await db().execute(sql, false)
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

async function runSchema(): Promise<void> {
  await db().execute('PRAGMA foreign_keys = ON', false)
  await db().execute(
    `
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
      id           TEXT PRIMARY KEY,
      template_id  TEXT NOT NULL REFERENCES checkin_templates(id) ON DELETE CASCADE,
      date         TEXT NOT NULL,
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
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'sparkles',
      color TEXT NOT NULL DEFAULT '#6366f1',
      is_system INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bored_activities (
      id TEXT PRIMARY KEY, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL REFERENCES bored_categories(id) ON DELETE CASCADE,
      estimated_minutes INTEGER, tags TEXT NOT NULL DEFAULT '[]',
      annotations TEXT NOT NULL DEFAULT '{}',
      is_recurring INTEGER NOT NULL DEFAULT 0, recurrence_rule TEXT,
      is_done INTEGER NOT NULL DEFAULT 0, done_at TEXT,
      done_count INTEGER NOT NULL DEFAULT 0, last_done_at TEXT,
      archived_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bored_activities_category ON bored_activities(category_id);
    CREATE TABLE IF NOT EXISTS todos (
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
    );
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
    CREATE INDEX IF NOT EXISTS idx_todos_is_done ON todos(is_done);
  `,
    false,
  )
}

// ─── Migrations ───────────────────────────────────────────────────────────────

async function runMigrations(): Promise<void> {
  const rows = await queryRaw('PRAGMA user_version')
  let userVersion = (rows[0]?.['user_version'] as number) ?? 0

  // Schema squashed at v10. Add future migrations at key 11+.
  const migrations: Record<number, string[]> = {
    11: [
      `CREATE TABLE IF NOT EXISTS bored_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'sparkles', color TEXT NOT NULL DEFAULT '#6366f1', is_system INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS bored_activities (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category_id TEXT NOT NULL REFERENCES bored_categories(id) ON DELETE CASCADE, estimated_minutes INTEGER, tags TEXT NOT NULL DEFAULT '[]', annotations TEXT NOT NULL DEFAULT '{}', is_recurring INTEGER NOT NULL DEFAULT 0, recurrence_rule TEXT, is_done INTEGER NOT NULL DEFAULT 0, done_at TEXT, done_count INTEGER NOT NULL DEFAULT 0, last_done_at TEXT, archived_at TEXT, created_at TEXT NOT NULL)`,
      'CREATE INDEX IF NOT EXISTS idx_bored_activities_category ON bored_activities(category_id)',
      `CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_date TEXT, priority TEXT NOT NULL DEFAULT 'medium', estimated_minutes INTEGER, is_done INTEGER NOT NULL DEFAULT 0, done_at TEXT, done_count INTEGER NOT NULL DEFAULT 0, last_done_at TEXT, tags TEXT NOT NULL DEFAULT '[]', annotations TEXT NOT NULL DEFAULT '{}', is_recurring INTEGER NOT NULL DEFAULT 0, recurrence_rule TEXT, show_in_bored INTEGER NOT NULL DEFAULT 0, bored_category_id TEXT REFERENCES bored_categories(id) ON DELETE SET NULL, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
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
      await exec(sql)
    }
    await db().execute(`PRAGMA user_version = ${v}`, false)
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
      await exec(`UPDATE habits SET icon = '${key}' WHERE icon = '${cls}'`)
      await exec(`UPDATE bored_categories SET icon = '${key}' WHERE icon = '${cls}'`)
    }
    await db().execute('PRAGMA user_version = 15', false)
    userVersion = 15
  }

  if (userVersion === 0) await db().execute('PRAGMA user_version = 15', false)
}

// ─── Default seeds ────────────────────────────────────────────────────────────

async function seedDefaults(): Promise<void> {
  type Seed = { key: string; apply: () => Promise<void> }

  async function insertTemplate(
    title: string,
    schedule_type: string,
    days_active: number[] | null,
    qs: Omit<CheckinQuestion, 'id' | 'template_id' | 'archived_at'>[],
  ): Promise<void> {
    const tid = crypto.randomUUID()
    await exec(
      'INSERT INTO checkin_templates (id,title,schedule_type,days_active) VALUES (?,?,?,?)',
      [tid, title, schedule_type, days_active != null ? JSON.stringify(days_active) : null],
    )
    for (const q of qs) {
      await exec(
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
      apply: async () => {
        const rows = await queryRaw(
          "SELECT id FROM checkin_templates WHERE title = 'Morning Check-in' AND archived_at IS NULL",
        )
        for (const t of rows) {
          const qs = await queryRaw(
            'SELECT id, prompt FROM checkin_questions WHERE template_id = ?',
            [t['id']],
          )
          if (!qs.some((q) => q['prompt'] === 'What did you dream about?')) {
            await exec(
              'UPDATE checkin_questions SET display_order = display_order + 1 WHERE template_id = ? AND display_order >= 1',
              [t['id']],
            )
            await exec(
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
      apply: async () => {
        const id = 'bored-cat-reading'
        const now2 = new Date().toISOString()
        await exec(
          'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
          [id, 'Things to Read', 'book-open', '#3b82f6', 1, 0, now2],
        )
        for (const [title, description, mins] of [
          ['Read 10 pages of current book', 'Pick up wherever you left off.', 20],
          ['Catch up on saved articles', 'Clear your reading list a bit.', 15],
          ['Wikipedia rabbit hole', 'Start on any topic and follow curiosity.', 30],
        ] as [string, string, number][]) {
          await exec(
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
      apply: async () => {
        const id = 'bored-cat-chores'
        const now2 = new Date().toISOString()
        await exec(
          'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
          [id, 'Chores', 'home', '#f59e0b', 1, 1, now2],
        )
        for (const [title, description, mins] of [
          ['Clean one small area', 'A drawer, a shelf, a corner — pick one.', 15],
          ['Do laundry', "Throw in a load or fold what's waiting.", 45],
          ['Organize one drawer', 'Just one. It always feels satisfying.', 20],
        ] as [string, string, number][]) {
          await exec(
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
      apply: async () => {
        const id = 'bored-cat-contacts'
        const now2 = new Date().toISOString()
        await exec(
          'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
          [id, 'People to Contact', 'chat-circle', '#10b981', 1, 2, now2],
        )
        for (const [title, description, mins] of [
          [
            "Text a friend you haven't spoken to lately",
            'A simple "hey, how are you?" goes a long way.',
            5,
          ],
          ['Send an appreciation message', 'Tell someone you appreciate them.', 5],
          ['Catch up with family', 'Call or message a family member.', 15],
        ] as [string, string, number][]) {
          await exec(
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
      apply: async () => {
        const id = 'bored-cat-learning'
        const now2 = new Date().toISOString()
        await exec(
          'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
          [id, 'Things to Learn', 'graduation', '#8b5cf6', 1, 3, now2],
        )
        for (const [title, description, mins] of [
          ['Watch a YouTube tutorial', "Pick a skill you've been curious about.", 20],
          [
            'Practice a skill for 15 min',
            "Music, language, coding — whatever you're building.",
            15,
          ],
          ['Read documentation or a how-to', 'Level up something you already use.', 20],
        ] as [string, string, number][]) {
          await exec(
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
      apply: async () => {
        const id = 'bored-cat-idle'
        const now2 = new Date().toISOString()
        await exec(
          'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
          [id, 'Idle Quests', 'sparkles', '#f97316', 1, 4, now2],
        )
        for (const [title, description, mins] of [
          ['Take a 10-min walk', 'No destination needed. Just move.', 10],
          ['Stretch or light yoga', 'Even 5 minutes resets the body.', 10],
          ['Doodle without overthinking', 'Pen and paper, no expectations.', 15],
          ['Listen to a new album', 'Pick something outside your usual taste.', 30],
        ] as [string, string, number][]) {
          await exec(
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
    const already = await queryRaw('SELECT key FROM applied_defaults WHERE key = ?', [key])
    if (already.length === 0) {
      await apply()
      await exec('INSERT INTO applied_defaults (key, applied_at) VALUES (?,?)', [key, now])
    }
  }
}

// ─── NativeDbAdapter ──────────────────────────────────────────────────────────
// Wraps the async Capacitor SQLite API to satisfy the DbAdapter interface
// shared with the web worker path.

class NativeDbAdapter implements DbAdapter {
  async queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]> {
    return queryRaw(sql, bind) as Promise<T[]>
  }

  async queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null> {
    const rows = await queryRaw(sql, bind)
    return rows.length > 0 ? (rows[0] as T) : null
  }

  async exec(sql: string, bind?: unknown[]): Promise<void> {
    return exec(sql, bind)
  }
}

const adapter = new NativeDbAdapter()

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initNativeDb(): Promise<void> {
  _db = await sqliteConn.createConnection('habitat', false, 'no-encryption', 1, false)
  await _db.open()
  await runSchema()
  await runMigrations()
  await seedDefaults()
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchNative(req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'GET_HABITS':
      return shared.getHabits(adapter)
    case 'CREATE_HABIT':
      return shared.createHabit(adapter, req.payload)
    case 'UPDATE_HABIT':
      return shared.updateHabit(adapter, req.payload)
    case 'ARCHIVE_HABIT':
      return shared.archiveHabit(adapter, req.payload.id)
    case 'DELETE_HABIT':
      return shared.deleteHabit(adapter, req.payload.id)
    case 'GET_ARCHIVED_HABITS':
      return shared.getArchivedHabits(adapter)
    case 'GET_COMPLETIONS_FOR_DATE':
      return shared.getCompletionsForDate(adapter, req.payload.date)
    case 'GET_COMPLETIONS_FOR_HABIT':
      return shared.getCompletionsForHabit(
        adapter,
        req.payload.habit_id,
        req.payload.from,
        req.payload.to,
      )
    case 'GET_COMPLETIONS_FOR_DATE_RANGE':
      return shared.getCompletionsForDateRange(adapter, req.payload.from, req.payload.to)
    case 'GET_ALL_COMPLETIONS':
      return shared.getAllCompletions(adapter)
    case 'TOGGLE_COMPLETION':
      return shared.toggleCompletion(
        adapter,
        req.payload.habit_id,
        req.payload.date,
        req.payload.tags,
        req.payload.annotations,
      )
    case 'GET_STREAK':
      return shared.getStreak(adapter, req.payload.habit_id)
    case 'DELETE_ALL_HABITS':
      return shared.deleteAllHabits(adapter)
    case 'PAUSE_HABIT':
      return shared.pauseHabit(adapter, req.payload.id, req.payload.until)
    case 'PAUSE_ALL_HABITS':
      return shared.pauseAllHabits(adapter, req.payload.until)
    case 'GET_HABIT_LOGS_FOR_DATE':
      return shared.getHabitLogsForDate(adapter, req.payload.date)
    case 'GET_HABIT_LOGS_FOR_HABIT':
      return shared.getHabitLogsForHabit(
        adapter,
        req.payload.habit_id,
        req.payload.from,
        req.payload.to,
      )
    case 'GET_HABIT_LOGS_FOR_DATE_RANGE':
      return shared.getHabitLogsForDateRange(adapter, req.payload.from, req.payload.to)
    case 'LOG_HABIT_VALUE':
      return shared.logHabitValue(
        adapter,
        req.payload.habit_id,
        req.payload.date,
        req.payload.value,
        req.payload.notes,
      )
    case 'DELETE_HABIT_LOG':
      return shared.deleteHabitLog(adapter, req.payload.id)
    case 'GET_SCHEDULE_FOR_HABIT':
      return shared.getScheduleForHabit(adapter, req.payload.habit_id)
    case 'UPDATE_HABIT_SCHEDULE':
      return shared.updateHabitSchedule(adapter, req.payload)
    case 'GET_CHECKIN_ENTRY':
      return shared.getCheckinEntry(adapter, req.payload.date)
    case 'UPSERT_CHECKIN_ENTRY':
      return shared.upsertCheckinEntry(adapter, req.payload.date, req.payload.content)
    case 'DELETE_CHECKIN_ENTRY':
      return shared.deleteCheckinEntry(adapter, req.payload.id)
    case 'GET_CHECKIN_ENTRIES':
      return shared.getCheckinEntries(adapter, req.payload.from, req.payload.to)
    case 'DELETE_ALL_CHECKIN_ENTRIES':
      return shared.deleteAllCheckinEntries(adapter)
    case 'GET_CHECKIN_TEMPLATES':
      return shared.getCheckinTemplates(adapter)
    case 'GET_CHECKIN_TEMPLATE':
      return shared.getCheckinTemplate(adapter, req.payload.id)
    case 'CREATE_CHECKIN_TEMPLATE':
      return shared.createCheckinTemplate(adapter, req.payload)
    case 'UPDATE_CHECKIN_TEMPLATE':
      return shared.updateCheckinTemplate(adapter, req.payload)
    case 'DELETE_CHECKIN_TEMPLATE':
      return shared.deleteCheckinTemplate(adapter, req.payload.id)
    case 'DELETE_ALL_CHECKIN_DATA':
      return shared.deleteAllCheckinData(adapter)
    case 'GET_CHECKIN_QUESTIONS':
      return shared.getCheckinQuestions(adapter, req.payload.template_id)
    case 'CREATE_CHECKIN_QUESTION':
      return shared.createCheckinQuestion(adapter, req.payload)
    case 'UPDATE_CHECKIN_QUESTION':
      return shared.updateCheckinQuestion(adapter, req.payload)
    case 'DELETE_CHECKIN_QUESTION':
      return shared.deleteCheckinQuestion(adapter, req.payload.id)
    case 'GET_CHECKIN_RESPONSES':
      return shared.getCheckinResponses(adapter, req.payload.template_id, req.payload.date)
    case 'UPSERT_CHECKIN_RESPONSE':
      return shared.upsertCheckinResponse(
        adapter,
        req.payload.question_id,
        req.payload.logged_date,
        req.payload.value_numeric,
        req.payload.value_text,
      )
    case 'DELETE_CHECKIN_RESPONSE':
      return shared.deleteCheckinResponse(adapter, req.payload.id)
    case 'TOGGLE_CHECKIN_COMPLETION':
      return shared.toggleCheckinCompletion(adapter, req.payload.template_id, req.payload.date)
    case 'GET_CHECKIN_COMPLETIONS_FOR_DATE':
      return shared.getCheckinCompletionsForDate(adapter, req.payload.date)
    case 'GET_CHECKIN_RESPONSE_DATES':
      return shared.getCheckinResponseDates(adapter)
    case 'GET_CHECKIN_HISTORY':
      return shared.getCheckinHistory(
        adapter,
        req.payload.from,
        req.payload.to,
        req.payload.template_id,
      )
    case 'GET_CHECKIN_SUMMARY_FOR_DATE':
      return shared.getCheckinSummaryForDate(adapter, req.payload.date)
    case 'GET_SCRIBBLES':
      return shared.getScribbles(adapter)
    case 'GET_SCRIBBLES_FOR_DATE':
      return shared.getScribblesForDate(adapter, req.payload.date)
    case 'CREATE_SCRIBBLE':
      return shared.createScribble(adapter, req.payload)
    case 'UPDATE_SCRIBBLE':
      return shared.updateScribble(adapter, req.payload)
    case 'DELETE_SCRIBBLE':
      return shared.deleteScribble(adapter, req.payload.id)
    case 'DELETE_ALL_SCRIBBLES':
      return shared.deleteAllScribbles(adapter)
    case 'GET_ALL_REMINDERS':
      return shared.getAllReminders(adapter)
    case 'GET_REMINDERS_FOR_HABIT':
      return shared.getRemindersForHabit(adapter, req.payload.habit_id)
    case 'CREATE_REMINDER':
      return shared.createReminder(
        adapter,
        req.payload.habit_id,
        req.payload.trigger_time,
        req.payload.days_active,
      )
    case 'DELETE_REMINDER':
      return shared.deleteReminder(adapter, req.payload.id)
    case 'GET_ALL_CHECKIN_REMINDERS':
      return shared.getAllCheckinReminders(adapter)
    case 'GET_CHECKIN_REMINDERS_FOR_TEMPLATE':
      return shared.getCheckinRemindersForTemplate(adapter, req.payload.template_id)
    case 'CREATE_CHECKIN_REMINDER':
      return shared.createCheckinReminder(
        adapter,
        req.payload.template_id,
        req.payload.trigger_time,
        req.payload.days_active,
      )
    case 'DELETE_CHECKIN_REMINDER':
      return shared.deleteCheckinReminder(adapter, req.payload.id)
    case 'IS_DEFAULT_APPLIED':
      return shared.isDefaultApplied(adapter, req.payload.key)
    case 'MARK_DEFAULT_APPLIED':
      return shared.markDefaultApplied(adapter, req.payload.key)
    case 'CLEAR_APPLIED_DEFAULTS':
      return shared.clearAppliedDefaults(adapter)
    case 'GET_DB_INFO':
      return shared.getDbInfo(adapter)
    case 'INTEGRITY_CHECK':
      return shared.integrityCheck(adapter)
    case 'EXPORT_JSON_DATA':
      return shared.exportJsonData(adapter, req.payload)
    case 'IMPORT_JSON':
      return shared.importJson(adapter, req.payload)
    case 'GET_BORED_CATEGORIES':
      return shared.getBoredCategories(adapter)
    case 'CREATE_BORED_CATEGORY':
      return shared.createBoredCategory(adapter, req.payload)
    case 'UPDATE_BORED_CATEGORY':
      return shared.updateBoredCategory(adapter, req.payload)
    case 'DELETE_BORED_CATEGORY':
      return shared.deleteBoredCategory(adapter, req.payload.id)
    case 'GET_BORED_ACTIVITIES':
      return shared.getBoredActivities(adapter)
    case 'GET_BORED_ACTIVITIES_FOR_CATEGORY':
      return shared.getBoredActivitiesForCategory(adapter, req.payload.category_id)
    case 'CREATE_BORED_ACTIVITY':
      return shared.createBoredActivity(adapter, req.payload)
    case 'UPDATE_BORED_ACTIVITY':
      return shared.updateBoredActivity(adapter, req.payload)
    case 'DELETE_BORED_ACTIVITY':
      return shared.deleteBoredActivity(adapter, req.payload.id)
    case 'ARCHIVE_BORED_ACTIVITY':
      return shared.archiveBoredActivity(adapter, req.payload.id)
    case 'MARK_BORED_ACTIVITY_DONE':
      return shared.markBoredActivityDone(adapter, req.payload.id)
    case 'GET_BORED_ORACLE':
      return shared.getBoredOracle(
        adapter,
        req.payload.excluded_category_ids,
        req.payload.max_minutes,
      )
    case 'DELETE_ALL_BORED_DATA':
      return shared.deleteAllBoredData(adapter)
    case 'GET_TODOS':
      return shared.getTodos(adapter)
    case 'CREATE_TODO':
      return shared.createTodo(adapter, req.payload)
    case 'UPDATE_TODO':
      return shared.updateTodo(adapter, req.payload)
    case 'DELETE_TODO':
      return shared.deleteTodo(adapter, req.payload.id)
    case 'ARCHIVE_TODO':
      return shared.archiveTodo(adapter, req.payload.id)
    case 'TOGGLE_TODO':
      return shared.toggleTodo(adapter, req.payload.id)
    case 'DELETE_ALL_TODOS':
      return shared.deleteAllTodos(adapter)
    case 'GET_CONTEXT_TAGS':
      return shared.getContextTags(adapter)
    case 'SEARCH_GLOBAL':
      return shared.searchGlobal(adapter, req.payload.query)
    case 'NUKE_OPFS':
      return null // no-op on native (no OPFS)
    case 'EXPORT_DB':
      throw new Error('EXPORT_DB not supported on native')
    default:
      throw new Error(`Unknown request type: ${(req as { type: string }).type}`)
  }
}
