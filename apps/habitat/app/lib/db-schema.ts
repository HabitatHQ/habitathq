import type { MigrationExec, SchemaConfig, Seed } from '@palladium/core'
import type { CheckinQuestion } from '~/types/database'

export const SCHEMA_DDL = `
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
    paused_until TEXT,
    why          TEXT NOT NULL DEFAULT ''
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
    id             TEXT PRIMARY KEY,
    template_id    TEXT NOT NULL REFERENCES checkin_templates(id) ON DELETE CASCADE,
    prompt         TEXT NOT NULL,
    response_type  TEXT NOT NULL DEFAULT 'TEXT',
    display_order  INTEGER NOT NULL DEFAULT 0,
    desired_answer INTEGER DEFAULT 1,
    archived_at    TEXT
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

  CREATE TABLE IF NOT EXISTS voice_notes (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    mime_type  TEXT NOT NULL,
    duration   REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS image_notes (
    id         TEXT PRIMARY KEY,
    mime_type  TEXT NOT NULL,
    filename   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`

export const ICON_MAP: [string, string][] = [
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

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function insertTemplate(
  exec: MigrationExec,
  title: string,
  schedule_type: string,
  days_active: number[] | null,
  qs: (Omit<CheckinQuestion, 'id' | 'template_id' | 'archived_at' | 'desired_answer'> & {
    desired_answer?: number
  })[],
): Promise<void> {
  const tid = crypto.randomUUID()
  await exec(
    'INSERT INTO checkin_templates (id,title,schedule_type,days_active) VALUES (?,?,?,?)',
    [tid, title, schedule_type, days_active == null ? null : JSON.stringify(days_active)],
  )
  for (const q of qs) {
    await exec(
      'INSERT INTO checkin_questions (id,template_id,prompt,response_type,display_order,desired_answer) VALUES (?,?,?,?,?,?)',
      [crypto.randomUUID(), tid, q.prompt, q.response_type, q.display_order, q.desired_answer ?? 1],
    )
  }
}

async function insertBoredCategory(
  exec: MigrationExec,
  id: string,
  name: string,
  icon: string,
  color: string,
  sortOrder: number,
  activities: [string, string, number][],
): Promise<void> {
  const now = new Date().toISOString()
  await exec(
    'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
    [id, name, icon, color, 1, sortOrder, now],
  )
  for (const [title, description, mins] of activities) {
    await exec(
      'INSERT OR IGNORE INTO bored_activities (id,title,description,category_id,estimated_minutes,tags,annotations,is_recurring,is_done,done_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [crypto.randomUUID(), title, description, id, mins, '[]', '{}', 0, 0, 0, now],
    )
  }
}

// ─── Seeds ────────────────────────────────────────────────────────────────────

const SEEDS: Seed[] = [
  {
    key: 'checkin_template:morning_checkin',
    apply: (exec) =>
      insertTemplate(exec, 'Morning Check-in', 'DAILY', null, [
        { prompt: 'How did you sleep?', response_type: 'SCALE', display_order: 0 },
        { prompt: 'What did you dream about?', response_type: 'TEXT', display_order: 1 },
        { prompt: 'How is your energy level right now?', response_type: 'SCALE', display_order: 2 },
        {
          prompt: "What's your main intention for today?",
          response_type: 'TEXT',
          display_order: 3,
        },
        {
          prompt: 'Are you feeling anxious or stressed?',
          response_type: 'BOOLEAN',
          display_order: 4,
          desired_answer: 0,
        },
      ]),
  },
  {
    key: 'checkin_template:morning_dream_update',
    apply: async (exec) => {
      const rows = await exec<Record<string, unknown>>(
        "SELECT id FROM checkin_templates WHERE title = 'Morning Check-in' AND archived_at IS NULL",
      )
      for (const t of rows) {
        const qs = await exec<Record<string, unknown>>(
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
    apply: (exec) =>
      insertTemplate(exec, 'Evening Reflection', 'DAILY', null, [
        { prompt: 'Overall mood today (1\u201310)?', response_type: 'SCALE', display_order: 0 },
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
    apply: (exec) =>
      insertTemplate(
        exec,
        'Weekly Review',
        'WEEKLY',
        [0],
        [
          {
            prompt: 'How would you rate this week overall (1\u201310)?',
            response_type: 'SCALE',
            display_order: 0,
          },
          { prompt: 'What were your biggest wins?', response_type: 'TEXT', display_order: 1 },
          { prompt: 'Which habit are you most proud of?', response_type: 'TEXT', display_order: 2 },
          { prompt: 'What will you focus on next week?', response_type: 'TEXT', display_order: 3 },
        ],
      ),
  },
  {
    key: 'checkin_template:boolean_desired_answer',
    apply: async (exec) => {
      await exec(
        `UPDATE checkin_questions SET desired_answer = 0 WHERE prompt = 'Are you feeling anxious or stressed?' AND archived_at IS NULL`,
      )
    },
  },
  {
    key: 'bored:cat:reading',
    apply: (exec) =>
      insertBoredCategory(exec, 'bored-cat-reading', 'Things to Read', 'book-open', '#3b82f6', 0, [
        ['Read 10 pages of current book', 'Pick up wherever you left off.', 20],
        ['Catch up on saved articles', 'Clear your reading list a bit.', 15],
        ['Wikipedia rabbit hole', 'Start on any topic and follow curiosity.', 30],
      ]),
  },
  {
    key: 'bored:cat:chores',
    apply: (exec) =>
      insertBoredCategory(exec, 'bored-cat-chores', 'Chores', 'home', '#f59e0b', 1, [
        ['Clean one small area', 'A drawer, a shelf, a corner \u2014 pick one.', 15],
        ['Do laundry', "Throw in a load or fold what's waiting.", 45],
        ['Organize one drawer', 'Just one. It always feels satisfying.', 20],
      ]),
  },
  {
    key: 'bored:cat:contacts',
    apply: (exec) =>
      insertBoredCategory(
        exec,
        'bored-cat-contacts',
        'People to Contact',
        'chat-circle',
        '#10b981',
        2,
        [
          [
            "Text a friend you haven't spoken to lately",
            'A simple "hey, how are you?" goes a long way.',
            5,
          ],
          ['Send an appreciation message', 'Tell someone you appreciate them.', 5],
          ['Catch up with family', 'Call or message a family member.', 15],
        ],
      ),
  },
  {
    key: 'bored:cat:learning',
    apply: (exec) =>
      insertBoredCategory(
        exec,
        'bored-cat-learning',
        'Things to Learn',
        'graduation',
        '#8b5cf6',
        3,
        [
          ['Watch a YouTube tutorial', "Pick a skill you've been curious about.", 20],
          [
            'Practice a skill for 15 min',
            "Music, language, coding \u2014 whatever you're building.",
            15,
          ],
          ['Read documentation or a how-to', 'Level up something you already use.', 20],
        ],
      ),
  },
  {
    key: 'bored:cat:idle',
    apply: (exec) =>
      insertBoredCategory(exec, 'bored-cat-idle', 'Idle Quests', 'sparkles', '#f97316', 4, [
        ['Take a 10-min walk', 'No destination needed. Just move.', 10],
        ['Stretch or light yoga', 'Even 5 minutes resets the body.', 10],
        ['Doodle without overthinking', 'Pen and paper, no expectations.', 15],
        ['Listen to a new album', 'Pick something outside your usual taste.', 30],
      ]),
  },
]

// ─── Schema config ────────────────────────────────────────────────────────────

export const SCHEMA_CONFIG: SchemaConfig = {
  schema: SCHEMA_DDL,
  version: 21,
  migrations: {
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
    15: [
      async (exec: MigrationExec) => {
        for (const [key, cls] of ICON_MAP) {
          await exec('UPDATE habits SET icon = ? WHERE icon = ?', [key, cls])
          await exec('UPDATE bored_categories SET icon = ? WHERE icon = ?', [key, cls])
        }
      },
    ],
    16: [`ALTER TABLE habits ADD COLUMN why TEXT NOT NULL DEFAULT ''`],
    17: ['ALTER TABLE checkin_questions ADD COLUMN desired_answer INTEGER DEFAULT 1'],
    18: [
      async (exec: MigrationExec) => {
        await exec(
          'CREATE TABLE IF NOT EXISTS _palladium_seeds (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
        )
        const existing = await exec<{ key: string; applied_at: string }>(
          'SELECT key, applied_at FROM applied_defaults',
        )
        for (const row of existing) {
          await exec('INSERT OR IGNORE INTO _palladium_seeds (key, applied_at) VALUES (?, ?)', [
            row.key,
            row.applied_at,
          ])
        }
      },
    ],
    19: [
      `CREATE TABLE IF NOT EXISTS voice_notes (
        id TEXT PRIMARY KEY, mime_type TEXT NOT NULL,
        duration REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS image_notes (
        id TEXT PRIMARY KEY, mime_type TEXT NOT NULL,
        filename TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      )`,
    ],
    20: [
      async (exec: MigrationExec) => {
        const cols = await exec<{ name: string }>("PRAGMA table_info('voice_notes')")
        if (!cols.some((c) => c.name === 'title')) {
          await exec("ALTER TABLE voice_notes ADD COLUMN title TEXT NOT NULL DEFAULT ''")
        }
      },
    ],
    21: [
      // Canonicalize stored tags to trimmed-lowercase so tags are uniquely
      // keyed regardless of the case they were originally entered in. Mirrors
      // normalizeTag() in app/utils/tags.ts; kept inline so the migration is
      // self-contained. Also de-dupes case/whitespace variants within a row.
      async (exec: MigrationExec) => {
        const normalizeTagsJson = (raw: string): string | null => {
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            return null
          }
          if (!Array.isArray(parsed)) return null
          const seen = new Set<string>()
          const out: string[] = []
          for (const t of parsed) {
            if (typeof t !== 'string') continue
            const tag = t.trim().toLowerCase()
            if (!tag || seen.has(tag)) continue
            seen.add(tag)
            out.push(tag)
          }
          return JSON.stringify(out)
        }

        const taggedTables = ['habits', 'completions', 'todos', 'bored_activities', 'scribbles']
        for (const table of taggedTables) {
          const rows = await exec<{ id: string; tags: string }>(`SELECT id, tags FROM ${table}`)
          for (const row of rows) {
            const next = normalizeTagsJson(row.tags ?? '[]')
            if (next !== null && next !== row.tags) {
              await exec(`UPDATE ${table} SET tags = ? WHERE id = ?`, [next, row.id])
            }
          }
        }
      },
    ],
  },
  seeds: SEEDS,
}
