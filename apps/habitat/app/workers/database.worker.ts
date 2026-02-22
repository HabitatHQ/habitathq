import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { WorkerRequest, WorkerResponse, Habit, Completion, HabitSchedule, HabitLog, HabitWithSchedule, CheckinEntry, CheckinTemplate, CheckinQuestion, CheckinResponse, Scribble, Reminder, CheckinReminder, HabitatExport, ExportSelection, CheckinDaySummary } from '~/types/database'

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
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000))
    const got = await new Promise<boolean>(resolve => {
      void navigator.locks.request(
        'habitat-db',
        { ifAvailable: true },
        (lock) => {
          if (!lock) { resolve(false); return Promise.resolve() }
          resolve(true)
          return new Promise(() => {}) // hold until this worker terminates
        },
      )
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

const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ directory: '/habitat', clearOnInit: false })
const db = new poolUtil.OpfsSAHPoolDb('/habitat.db')

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
    icon         TEXT NOT NULL DEFAULT 'i-heroicons-star',
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
    days_active   TEXT
  );

  CREATE TABLE IF NOT EXISTS checkin_questions (
    id            TEXT PRIMARY KEY,
    template_id   TEXT NOT NULL REFERENCES checkin_templates(id) ON DELETE CASCADE,
    prompt        TEXT NOT NULL,
    response_type TEXT NOT NULL DEFAULT 'TEXT',
    display_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_checkin_questions_template ON checkin_questions(template_id);

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
    // placeholder — next migration goes here at key 11
  }

  for (let v = userVersion + 1; v in migrations; v++) {
    for (const sql of migrations[v]!) {
      db.exec(sql)
    }
    db.exec(`PRAGMA user_version = ${v}`)
    userVersion = v
  }

  // Ensure fresh installs (user_version = 0) are stamped at the current baseline.
  if (userVersion === 0) db.exec('PRAGMA user_version = 10')
}

runMigrations()

// ─── Default seeds ────────────────────────────────────────────────────────────
//
// Each seed has a stable `key`. Once applied, the key is inserted into
// `applied_defaults` and never re-seeded — even if the user deletes the data.

function seedDefaults(): void {
  type Seed = { key: string; apply: () => void }

  const seeds: Seed[] = [
    {
      key: 'checkin_template:morning_checkin',
      apply: () => {
        const t = createCheckinTemplate({ title: 'Morning Check-in', schedule_type: 'DAILY', days_active: null })
        const qs: Omit<CheckinQuestion, 'id'>[] = [
          { template_id: t.id, prompt: 'How did you sleep?',                         response_type: 'SCALE', display_order: 0 },
          { template_id: t.id, prompt: 'How is your energy level right now?',         response_type: 'SCALE', display_order: 1 },
          { template_id: t.id, prompt: "What's your main intention for today?",       response_type: 'TEXT',  display_order: 2 },
          { template_id: t.id, prompt: 'Are you feeling anxious or stressed?',        response_type: 'BOOLEAN', display_order: 3 },
        ]
        for (const q of qs) createCheckinQuestion(q)
      },
    },
    {
      key: 'checkin_template:evening_reflection',
      apply: () => {
        const t = createCheckinTemplate({ title: 'Evening Reflection', schedule_type: 'DAILY', days_active: null })
        const qs: Omit<CheckinQuestion, 'id'>[] = [
          { template_id: t.id, prompt: 'Overall mood today (1–10)?',          response_type: 'SCALE', display_order: 0 },
          { template_id: t.id, prompt: 'What went well today?',               response_type: 'TEXT',  display_order: 1 },
          { template_id: t.id, prompt: 'What could have gone better?',        response_type: 'TEXT',  display_order: 2 },
          { template_id: t.id, prompt: 'Did you complete your main intention?', response_type: 'BOOLEAN', display_order: 3 },
        ]
        for (const q of qs) createCheckinQuestion(q)
      },
    },
    {
      key: 'checkin_template:weekly_review',
      apply: () => {
        // days_active [0] = Sunday
        const t = createCheckinTemplate({ title: 'Weekly Review', schedule_type: 'WEEKLY', days_active: [0] })
        const qs: Omit<CheckinQuestion, 'id'>[] = [
          { template_id: t.id, prompt: 'How would you rate this week overall (1–10)?', response_type: 'SCALE', display_order: 0 },
          { template_id: t.id, prompt: 'What were your biggest wins?',                 response_type: 'TEXT',  display_order: 1 },
          { template_id: t.id, prompt: 'Which habit are you most proud of?',           response_type: 'TEXT',  display_order: 2 },
          { template_id: t.id, prompt: 'What will you focus on next week?',            response_type: 'TEXT',  display_order: 3 },
        ]
        for (const q of qs) createCheckinQuestion(q)
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
    const pSize = w.pstack.alloc(8)  // sqlite3_int64* for the byte count output
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

// ─── JSON export ──────────────────────────────────────────────────────────────

function exportJsonData(sel: ExportSelection): HabitatExport {
  const habits = sel.habits
    ? queryRaw('SELECT * FROM habits ORDER BY created_at ASC').map(parseHabit)
    : []
  const completions = sel.completions ? getAllCompletions() : []
  const habit_logs = sel.habit_logs
    ? queryRaw('SELECT * FROM habit_logs ORDER BY logged_at ASC').map(parseHabitLog)
    : []
  const habit_schedules = sel.habit_schedules
    ? queryRaw('SELECT * FROM habit_schedules').map(parseHabitSchedule)
    : []
  const reminders = sel.reminders ? getAllReminders() : []
  const checkin_templates = sel.checkin_templates ? getCheckinTemplates() : []
  const checkin_questions = sel.checkin_questions
    ? queryRaw('SELECT * FROM checkin_questions ORDER BY template_id, display_order').map(parseCheckinQuestion)
    : []
  const checkin_responses = sel.checkin_responses
    ? queryRaw('SELECT * FROM checkin_responses ORDER BY logged_date ASC').map(parseCheckinResponse)
    : []
  const checkin_reminders = sel.checkin_reminders ? getAllCheckinReminders() : []
  const scribbles = sel.scribbles ? getScribbles() : []
  const checkin_entries = sel.checkin_entries
    ? queryRaw('SELECT * FROM checkin_entries ORDER BY entry_date ASC').map(parseCheckinEntry)
    : []
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    habits,
    completions,
    habit_logs,
    habit_schedules,
    reminders,
    checkin_templates,
    checkin_questions,
    checkin_responses,
    checkin_reminders,
    scribbles,
    checkin_entries,
  }
}

// ─── JSON import ──────────────────────────────────────────────────────────────

function importJsonV1Habits(data: HabitatExport): void {
  for (const h of (data.habits ?? [])) {
    exec(
      `INSERT OR IGNORE INTO habits
         (id, name, description, color, icon, frequency, created_at, archived_at, tags, annotations, type, target_value, paused_until)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [h.id, h.name, h.description, h.color, h.icon, h.frequency, h.created_at, h.archived_at ?? null,
       JSON.stringify(h.tags ?? []), JSON.stringify(h.annotations ?? {}),
       h.type ?? 'BOOLEAN', h.target_value ?? 1, h.paused_until ?? null],
    )
  }
  for (const c of (data.completions ?? [])) {
    exec(
      `INSERT OR IGNORE INTO completions (id, habit_id, date, completed_at, notes, tags, annotations)
       VALUES (?,?,?,?,?,?,?)`,
      [c.id, c.habit_id, c.date, c.completed_at, c.notes ?? '',
       JSON.stringify(c.tags ?? []), JSON.stringify(c.annotations ?? {})],
    )
  }
  for (const l of (data.habit_logs ?? [])) {
    exec(
      `INSERT OR IGNORE INTO habit_logs (id, habit_id, date, logged_at, value, notes)
       VALUES (?,?,?,?,?,?)`,
      [l.id, l.habit_id, l.date, l.logged_at, l.value, l.notes ?? ''],
    )
  }
  for (const s of (data.habit_schedules ?? [])) {
    exec(
      `INSERT OR IGNORE INTO habit_schedules
         (id, habit_id, schedule_type, frequency_count, days_of_week, due_time, start_date, end_date)
       VALUES (?,?,?,?,?,?,?,?)`,
      [s.id, s.habit_id, s.schedule_type ?? 'DAILY', s.frequency_count ?? null,
       s.days_of_week != null ? JSON.stringify(s.days_of_week) : null,
       s.due_time ?? null, s.start_date ?? null, s.end_date ?? null],
    )
  }
  for (const r of (data.reminders ?? [])) {
    exec(
      `INSERT OR IGNORE INTO reminders (id, habit_id, trigger_time, days_active) VALUES (?,?,?,?)`,
      [r.id, r.habit_id, r.trigger_time, r.days_active != null ? JSON.stringify(r.days_active) : null],
    )
  }
}

function importJsonV1Checkins(data: HabitatExport): void {
  for (const t of (data.checkin_templates ?? [])) {
    exec(
      `INSERT OR IGNORE INTO checkin_templates (id, title, schedule_type, days_active) VALUES (?,?,?,?)`,
      [t.id, t.title, t.schedule_type ?? 'DAILY', t.days_active != null ? JSON.stringify(t.days_active) : null],
    )
  }
  for (const q of (data.checkin_questions ?? [])) {
    exec(
      `INSERT OR IGNORE INTO checkin_questions (id, template_id, prompt, response_type, display_order)
       VALUES (?,?,?,?,?)`,
      [q.id, q.template_id, q.prompt, q.response_type ?? 'TEXT', q.display_order ?? 0],
    )
  }
  for (const r of (data.checkin_responses ?? [])) {
    exec(
      `INSERT OR IGNORE INTO checkin_responses (id, question_id, logged_date, value_numeric, value_text)
       VALUES (?,?,?,?,?)`,
      [r.id, r.question_id, r.logged_date, r.value_numeric ?? null, r.value_text ?? null],
    )
  }
  for (const r of (data.checkin_reminders ?? [])) {
    exec(
      `INSERT OR IGNORE INTO checkin_reminders (id, template_id, trigger_time, days_active) VALUES (?,?,?,?)`,
      [r.id, r.template_id, r.trigger_time, r.days_active != null ? JSON.stringify(r.days_active) : null],
    )
  }
}

function importJsonV1Other(data: HabitatExport): void {
  for (const s of (data.scribbles ?? [])) {
    exec(
      `INSERT OR IGNORE INTO scribbles (id, title, content, tags, annotations, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      [s.id, s.title ?? '', s.content ?? '',
       JSON.stringify(s.tags ?? []), JSON.stringify(s.annotations ?? {}),
       s.created_at, s.updated_at],
    )
  }
  for (const e of (data.checkin_entries ?? [])) {
    exec(
      `INSERT OR IGNORE INTO checkin_entries (id, entry_date, content, created_at, updated_at)
       VALUES (?,?,?,?,?)`,
      [e.id, e.entry_date, e.content ?? '', e.created_at, e.updated_at],
    )
  }
}

function importJsonV1(data: HabitatExport): null {
  exec('BEGIN')
  try {
    importJsonV1Habits(data)
    importJsonV1Checkins(data)
    importJsonV1Other(data)
    exec('COMMIT')
    return null
  } catch (err) {
    exec('ROLLBACK')
    throw err
  }
}

function importJson(data: HabitatExport): null {
  if (data.version === 1) return importJsonV1(data)
  throw new Error(`Unsupported export version: ${String((data as { version: unknown }).version)}`)
}

// ─── Low-level helpers ────────────────────────────────────────────────────────

/** Safely parse a JSON column value, returning `fallback` on null or parse error. */
function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (str == null) return fallback
  try {
    return JSON.parse(str) as T
  } catch {
    console.warn('[db] JSON.parse failed for column value:', str)
    return fallback
  }
}

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

// ─── Domain deserializers (JSON columns → typed fields) ───────────────────────

const HABIT_WITH_SCHED_SQL = `
  SELECT h.*, hs.id as sched_id, hs.schedule_type, hs.frequency_count,
         hs.days_of_week, hs.due_time, hs.start_date, hs.end_date
  FROM habits h
  LEFT JOIN habit_schedules hs ON hs.habit_id = h.id`

function parseHabit(row: Record<string, unknown>): Habit {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: row['description'] as string,
    color: row['color'] as string,
    icon: row['icon'] as string,
    frequency: row['frequency'] as string,
    created_at: row['created_at'] as string,
    archived_at: (row['archived_at'] as string | null) ?? null,
    tags: safeJsonParse(row['tags'] as string | null, []),
    annotations: safeJsonParse(row['annotations'] as string | null, {}),
    type: ((row['type'] as string) ?? 'BOOLEAN') as 'BOOLEAN' | 'NUMERIC' | 'LIMIT',
    target_value: (row['target_value'] as number) ?? 1,
    paused_until: (row['paused_until'] as string | null) ?? null,
  }
}

function parseHabitWithSchedule(row: Record<string, unknown>): HabitWithSchedule {
  const habit = parseHabit(row)
  const schedId = row['sched_id'] as string | null
  if (!schedId) return { ...habit, schedule: null }
  return {
    ...habit,
    schedule: {
      id: schedId,
      habit_id: habit.id,
      schedule_type: ((row['schedule_type'] as string) ?? 'DAILY') as 'DAILY' | 'WEEKLY_FLEX' | 'SPECIFIC_DAYS',
      frequency_count: row['frequency_count'] != null ? (row['frequency_count'] as number) : null,
      days_of_week: safeJsonParse(row['days_of_week'] as string | null, null),
      due_time: (row['due_time'] as string | null) ?? null,
      start_date: (row['start_date'] as string | null) ?? null,
      end_date: (row['end_date'] as string | null) ?? null,
    },
  }
}

function parseHabitSchedule(row: Record<string, unknown>): HabitSchedule {
  return {
    id: row['id'] as string,
    habit_id: row['habit_id'] as string,
    schedule_type: ((row['schedule_type'] as string) ?? 'DAILY') as 'DAILY' | 'WEEKLY_FLEX' | 'SPECIFIC_DAYS',
    frequency_count: row['frequency_count'] != null ? (row['frequency_count'] as number) : null,
    days_of_week: row['days_of_week'] != null ? JSON.parse(row['days_of_week'] as string) : null,
    due_time: (row['due_time'] as string | null) ?? null,
    start_date: (row['start_date'] as string | null) ?? null,
    end_date: (row['end_date'] as string | null) ?? null,
  }
}

function parseHabitLog(row: Record<string, unknown>): HabitLog {
  return {
    id: row['id'] as string,
    habit_id: row['habit_id'] as string,
    date: row['date'] as string,
    logged_at: row['logged_at'] as string,
    value: row['value'] as number,
    notes: (row['notes'] as string) ?? '',
  }
}

function parseCompletion(row: Record<string, unknown>): Completion {
  return {
    id: row['id'] as string,
    habit_id: row['habit_id'] as string,
    date: row['date'] as string,
    completed_at: row['completed_at'] as string,
    notes: row['notes'] as string,
    tags: safeJsonParse(row['tags'] as string | null, []),
    annotations: safeJsonParse(row['annotations'] as string | null, {}),
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function getHabits(): HabitWithSchedule[] {
  return queryRaw(
    `${HABIT_WITH_SCHED_SQL} WHERE h.archived_at IS NULL ORDER BY h.created_at ASC`,
  ).map(parseHabitWithSchedule)
}

function createHabit(payload: Omit<Habit, 'id' | 'created_at' | 'archived_at'>): HabitWithSchedule {
  const id = crypto.randomUUID()
  const schedId = crypto.randomUUID()
  const created_at = new Date().toISOString()
  exec(
    `INSERT INTO habits
       (id, name, description, color, icon, frequency, created_at, tags, annotations,
        type, target_value, paused_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      payload.name,
      payload.description,
      payload.color,
      payload.icon,
      payload.frequency,
      created_at,
      JSON.stringify(payload.tags ?? []),
      JSON.stringify(payload.annotations ?? {}),
      payload.type ?? 'BOOLEAN',
      payload.target_value ?? 1,
      payload.paused_until ?? null,
    ],
  )
  exec(
    `INSERT INTO habit_schedules
       (id, habit_id, schedule_type, frequency_count, days_of_week, due_time, start_date, end_date)
     VALUES (?,?,?,?,?,?,?,?)`,
    [schedId, id, 'DAILY', null, null, null, created_at.slice(0, 10), null],
  )
  return parseHabitWithSchedule(
    queryRaw(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [id])[0]!,
  )
}

function updateHabit(payload: Partial<Habit> & { id: string }): HabitWithSchedule {
  const { id, ...fields } = payload
  const updates: [string, unknown][] = []

  const scalarFields = ['name', 'description', 'color', 'icon', 'frequency', 'type', 'target_value'] as const
  for (const k of scalarFields) {
    if (k in fields) updates.push([k, fields[k]])
  }
  if ('paused_until' in fields) updates.push(['paused_until', fields.paused_until ?? null])
  if ('tags' in fields) updates.push(['tags', JSON.stringify(fields.tags ?? [])])
  if ('annotations' in fields) updates.push(['annotations', JSON.stringify(fields.annotations ?? {})])

  if (updates.length > 0) {
    const set = updates.map(([k]) => `${k} = ?`).join(', ')
    exec(`UPDATE habits SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  }
  return parseHabitWithSchedule(
    queryRaw(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [id])[0]!,
  )
}

function archiveHabit(id: string): null {
  exec('UPDATE habits SET archived_at = ? WHERE id = ?', [new Date().toISOString(), id])
  return null
}

function deleteHabit(id: string): null {
  exec('DELETE FROM habits WHERE id = ?', [id])
  return null
}

function getCompletionsForDate(date: string): Completion[] {
  return queryRaw(
    'SELECT * FROM completions WHERE date = ? ORDER BY completed_at ASC',
    [date],
  ).map(parseCompletion)
}

function getCompletionsForHabit(habit_id: string, from: string, to: string): Completion[] {
  return queryRaw(
    'SELECT * FROM completions WHERE habit_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
    [habit_id, from, to],
  ).map(parseCompletion)
}

function getCompletionsForDateRange(from: string, to: string): Completion[] {
  return queryRaw(
    'SELECT * FROM completions WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [from, to],
  ).map(parseCompletion)
}

function toggleCompletion(
  habit_id: string,
  date: string,
  tags: string[] = [],
  annotations: Record<string, string> = {},
): Completion | null {
  const existing = queryRaw(
    'SELECT * FROM completions WHERE habit_id = ? AND date = ?',
    [habit_id, date],
  )
  if (existing.length > 0) {
    exec('DELETE FROM completions WHERE habit_id = ? AND date = ?', [habit_id, date])
    return null
  }
  const id = crypto.randomUUID()
  const completed_at = new Date().toISOString()
  exec(
    `INSERT INTO completions (id, habit_id, date, completed_at, notes, tags, annotations)
     VALUES (?,?,?,?,?,?,?)`,
    [id, habit_id, date, completed_at, '', JSON.stringify(tags), JSON.stringify(annotations)],
  )
  return parseCompletion(queryRaw('SELECT * FROM completions WHERE id = ?', [id])[0]!)
}

function getArchivedHabits(): HabitWithSchedule[] {
  return queryRaw(
    `${HABIT_WITH_SCHED_SQL} WHERE h.archived_at IS NOT NULL ORDER BY h.archived_at DESC`,
  ).map(parseHabitWithSchedule)
}

function getAllCompletions(): Completion[] {
  return queryRaw('SELECT * FROM completions ORDER BY date DESC').map(parseCompletion)
}

function deleteAllHabits(): null {
  exec('DELETE FROM habits')
  return null
}

function deleteAllCheckinEntries(): null {
  exec('DELETE FROM checkin_entries')
  return null
}

function deleteAllCheckinData(): null {
  exec('DELETE FROM checkin_templates') // cascades to questions + responses
  return null
}

function deleteAllScribbles(): null {
  exec('DELETE FROM scribbles')
  return null
}

function clearAppliedDefaults(): null {
  exec('DELETE FROM applied_defaults')
  return null
}

function isDefaultApplied(key: string): boolean {
  return queryRaw('SELECT 1 FROM applied_defaults WHERE key = ?', [key]).length > 0
}

function markDefaultApplied(key: string): null {
  exec('INSERT OR IGNORE INTO applied_defaults (key, applied_at) VALUES (?, ?)', [key, new Date().toISOString()])
  return null
}

function integrityCheck(): string[] {
  // Returns ['ok'] if healthy, or one message per problem found.
  return queryRaw('PRAGMA integrity_check').map(r => String(r['integrity_check'] ?? ''))
}

function getDbInfo(): { userVersion: number; tables: Array<{ name: string; sql: string }>; indices: Array<{ name: string; tbl_name: string; sql: string }> } {
  const versionRows = queryRaw('PRAGMA user_version')
  const userVersion = (versionRows[0]?.['user_version'] as number) ?? 0
  const tableRows = queryRaw(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name",
  )
  const indexRows = queryRaw(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name, name",
  )
  return {
    userVersion,
    tables: tableRows.map(r => ({ name: String(r['name']), sql: String(r['sql'] ?? '') })),
    indices: indexRows.map(r => ({ name: String(r['name']), tbl_name: String(r['tbl_name']), sql: String(r['sql'] ?? '') })),
  }
}

function calcStreaks(datesDesc: string[]): { current: number; longest: number } {
  if (datesDesc.length === 0) return { current: 0, longest: 0 }

  const today = new Date().toISOString().slice(0, 10)

  // Current streak: consecutive days ending today
  let current = 0
  let check = today
  for (const date of datesDesc) {
    if (date === check) {
      current++
      const d = new Date(check)
      d.setDate(d.getDate() - 1)
      check = d.toISOString().slice(0, 10)
    } else if (date < check) {
      break
    }
  }

  // Longest streak: scan ascending
  const ascending = [...datesDesc].reverse()
  let longest = 0
  let streak = 0
  let prev: string | null = null
  for (const date of ascending) {
    if (prev === null) {
      streak = 1
    } else {
      const prevDate = new Date(prev)
      prevDate.setDate(prevDate.getDate() + 1)
      streak = date === prevDate.toISOString().slice(0, 10) ? streak + 1 : 1
    }
    longest = Math.max(longest, streak)
    prev = date
  }

  return { current, longest }
}

function getStreak(habit_id: string): { current: number; longest: number } {
  const habitRow = queryRaw('SELECT type, target_value FROM habits WHERE id = ?', [habit_id])[0]
  if (!habitRow) return { current: 0, longest: 0 }

  const type = (habitRow['type'] as string) ?? 'BOOLEAN'
  const target = (habitRow['target_value'] as number) ?? 1

  // BOOLEAN: a completion row = done for that day
  if (type === 'BOOLEAN') {
    const dates = queryRaw(
      'SELECT date FROM completions WHERE habit_id = ? ORDER BY date DESC',
      [habit_id],
    ).map(r => r['date'] as string)
    return calcStreaks(dates)
  }

  // NUMERIC: done when the sum of logged values for the day meets the target
  if (type === 'NUMERIC') {
    const dates = queryRaw(
      'SELECT date FROM habit_logs WHERE habit_id = ? GROUP BY date HAVING SUM(value) >= ? ORDER BY date DESC',
      [habit_id, target],
    ).map(r => r['date'] as string)
    return calcStreaks(dates)
  }

  // LIMIT: done when the user tracked at least once AND total stayed under the limit
  const dates = queryRaw(
    'SELECT date FROM habit_logs WHERE habit_id = ? GROUP BY date HAVING SUM(value) < ? ORDER BY date DESC',
    [habit_id, target],
  ).map(r => r['date'] as string)
  return calcStreaks(dates)
}

// ─── Habit log handlers ───────────────────────────────────────────────────────

function getHabitLogsForDate(date: string): HabitLog[] {
  return queryRaw(
    'SELECT * FROM habit_logs WHERE date = ? ORDER BY logged_at ASC',
    [date],
  ).map(parseHabitLog)
}

function getHabitLogsForHabit(habit_id: string, from: string, to: string): HabitLog[] {
  return queryRaw(
    'SELECT * FROM habit_logs WHERE habit_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
    [habit_id, from, to],
  ).map(parseHabitLog)
}

function getHabitLogsForDateRange(from: string, to: string): HabitLog[] {
  return queryRaw(
    'SELECT * FROM habit_logs WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [from, to],
  ).map(parseHabitLog)
}

function logHabitValue(habit_id: string, date: string, value: number, notes = ''): HabitLog {
  const id = crypto.randomUUID()
  const logged_at = new Date().toISOString()
  exec(
    `INSERT INTO habit_logs (id, habit_id, date, logged_at, value, notes) VALUES (?,?,?,?,?,?)`,
    [id, habit_id, date, logged_at, value, notes],
  )
  return parseHabitLog(queryRaw('SELECT * FROM habit_logs WHERE id = ?', [id])[0]!)
}

function deleteHabitLog(id: string): null {
  exec('DELETE FROM habit_logs WHERE id = ?', [id])
  return null
}

// ─── Schedule handlers ────────────────────────────────────────────────────────

function getScheduleForHabit(habit_id: string): HabitSchedule | null {
  const rows = queryRaw('SELECT * FROM habit_schedules WHERE habit_id = ?', [habit_id])
  return rows.length > 0 ? parseHabitSchedule(rows[0]!) : null
}

function updateHabitSchedule(payload: Partial<HabitSchedule> & { id: string }): HabitSchedule {
  const { id, ...fields } = payload
  const updates: [string, unknown][] = []

  const scalarFields = ['schedule_type', 'frequency_count', 'due_time', 'start_date', 'end_date'] as const
  for (const k of scalarFields) {
    if (k in fields) updates.push([k, (fields as Record<string, unknown>)[k] ?? null])
  }
  if ('days_of_week' in fields) {
    updates.push([
      'days_of_week',
      fields.days_of_week != null ? JSON.stringify(fields.days_of_week) : null,
    ])
  }

  if (updates.length > 0) {
    const set = updates.map(([k]) => `${k} = ?`).join(', ')
    exec(`UPDATE habit_schedules SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  }
  return parseHabitSchedule(queryRaw('SELECT * FROM habit_schedules WHERE id = ?', [id])[0]!)
}

function pauseHabit(id: string, until: string | null): HabitWithSchedule {
  exec('UPDATE habits SET paused_until = ? WHERE id = ?', [until, id])
  return parseHabitWithSchedule(
    queryRaw(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [id])[0]!,
  )
}

function pauseAllHabits(until: string | null): null {
  exec('UPDATE habits SET paused_until = ? WHERE archived_at IS NULL', [until])
  return null
}

// ─── Check-in entry deserializers ─────────────────────────────────────────────

function parseCheckinEntry(row: Record<string, unknown>): CheckinEntry {
  return {
    id: row['id'] as string,
    entry_date: row['entry_date'] as string,
    content: (row['content'] as string) ?? '',
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  }
}

function parseCheckinTemplate(row: Record<string, unknown>): CheckinTemplate {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    schedule_type: ((row['schedule_type'] as string) ?? 'DAILY') as 'DAILY' | 'WEEKLY' | 'MONTHLY',
    days_active: safeJsonParse(row['days_active'] as string | null, null),
  }
}

function parseCheckinQuestion(row: Record<string, unknown>): CheckinQuestion {
  return {
    id: row['id'] as string,
    template_id: row['template_id'] as string,
    prompt: row['prompt'] as string,
    response_type: ((row['response_type'] as string) ?? 'TEXT') as 'SCALE' | 'TEXT' | 'BOOLEAN',
    display_order: (row['display_order'] as number) ?? 0,
  }
}

function parseCheckinResponse(row: Record<string, unknown>): CheckinResponse {
  return {
    id: row['id'] as string,
    question_id: row['question_id'] as string,
    logged_date: row['logged_date'] as string,
    value_numeric: row['value_numeric'] != null ? (row['value_numeric'] as number) : null,
    value_text: row['value_text'] != null ? (row['value_text'] as string) : null,
  }
}

// ─── Check-in entry handlers ──────────────────────────────────────────────────

function getCheckinEntry(date: string): CheckinEntry | null {
  const rows = queryRaw('SELECT * FROM checkin_entries WHERE entry_date = ?', [date])
  return rows.length > 0 ? parseCheckinEntry(rows[0]!) : null
}

function upsertCheckinEntry(date: string, content: string): CheckinEntry {
  const now = new Date().toISOString()
  const existing = queryRaw('SELECT id FROM checkin_entries WHERE entry_date = ?', [date])
  if (existing.length > 0) {
    const id = existing[0]!['id'] as string
    exec('UPDATE checkin_entries SET content = ?, updated_at = ? WHERE id = ?', [content, now, id])
    return parseCheckinEntry(queryRaw('SELECT * FROM checkin_entries WHERE id = ?', [id])[0]!)
  }
  const id = crypto.randomUUID()
  exec(
    'INSERT INTO checkin_entries (id, entry_date, content, created_at, updated_at) VALUES (?,?,?,?,?)',
    [id, date, content, now, now],
  )
  return parseCheckinEntry(queryRaw('SELECT * FROM checkin_entries WHERE id = ?', [id])[0]!)
}

function deleteCheckinEntry(id: string): null {
  exec('DELETE FROM checkin_entries WHERE id = ?', [id])
  return null
}

function getCheckinEntries(from: string, to: string): CheckinEntry[] {
  return queryRaw(
    'SELECT * FROM checkin_entries WHERE entry_date >= ? AND entry_date <= ? ORDER BY entry_date DESC',
    [from, to],
  ).map(parseCheckinEntry)
}

// ─── Checkin template handlers ────────────────────────────────────────────────

function getCheckinTemplates(): CheckinTemplate[] {
  return queryRaw('SELECT * FROM checkin_templates ORDER BY title ASC').map(parseCheckinTemplate)
}

function createCheckinTemplate(payload: Omit<CheckinTemplate, 'id'>): CheckinTemplate {
  const id = crypto.randomUUID()
  exec(
    'INSERT INTO checkin_templates (id, title, schedule_type, days_active) VALUES (?,?,?,?)',
    [id, payload.title, payload.schedule_type ?? 'DAILY', payload.days_active != null ? JSON.stringify(payload.days_active) : null],
  )
  return parseCheckinTemplate(queryRaw('SELECT * FROM checkin_templates WHERE id = ?', [id])[0]!)
}

function updateCheckinTemplate(payload: Partial<CheckinTemplate> & { id: string }): CheckinTemplate {
  const { id, ...fields } = payload
  const updates: [string, unknown][] = []
  if ('title' in fields) updates.push(['title', fields.title])
  if ('schedule_type' in fields) updates.push(['schedule_type', fields.schedule_type])
  if ('days_active' in fields) updates.push(['days_active', fields.days_active != null ? JSON.stringify(fields.days_active) : null])
  if (updates.length > 0) {
    const set = updates.map(([k]) => `${k} = ?`).join(', ')
    exec(`UPDATE checkin_templates SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  }
  return parseCheckinTemplate(queryRaw('SELECT * FROM checkin_templates WHERE id = ?', [id])[0]!)
}

function deleteCheckinTemplate(id: string): null {
  exec('DELETE FROM checkin_templates WHERE id = ?', [id])
  return null
}

// ─── Checkin question handlers ────────────────────────────────────────────────

function getCheckinQuestions(template_id: string): CheckinQuestion[] {
  return queryRaw(
    'SELECT * FROM checkin_questions WHERE template_id = ? ORDER BY display_order ASC',
    [template_id],
  ).map(parseCheckinQuestion)
}

function createCheckinQuestion(payload: Omit<CheckinQuestion, 'id'>): CheckinQuestion {
  const id = crypto.randomUUID()
  exec(
    'INSERT INTO checkin_questions (id, template_id, prompt, response_type, display_order) VALUES (?,?,?,?,?)',
    [id, payload.template_id, payload.prompt, payload.response_type ?? 'TEXT', payload.display_order ?? 0],
  )
  return parseCheckinQuestion(queryRaw('SELECT * FROM checkin_questions WHERE id = ?', [id])[0]!)
}

function updateCheckinQuestion(payload: Partial<CheckinQuestion> & { id: string }): CheckinQuestion {
  const { id, ...fields } = payload
  const updates: [string, unknown][] = []
  if ('prompt' in fields) updates.push(['prompt', fields.prompt])
  if ('response_type' in fields) updates.push(['response_type', fields.response_type])
  if ('display_order' in fields) updates.push(['display_order', fields.display_order])
  if (updates.length > 0) {
    const set = updates.map(([k]) => `${k} = ?`).join(', ')
    exec(`UPDATE checkin_questions SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  }
  return parseCheckinQuestion(queryRaw('SELECT * FROM checkin_questions WHERE id = ?', [id])[0]!)
}

function deleteCheckinQuestion(id: string): null {
  exec('DELETE FROM checkin_questions WHERE id = ?', [id])
  return null
}

// ─── Checkin response handlers ────────────────────────────────────────────────

function getCheckinResponses(template_id: string, date: string): CheckinResponse[] {
  return queryRaw(
    `SELECT cr.* FROM checkin_responses cr
     JOIN checkin_questions cq ON cq.id = cr.question_id
     WHERE cq.template_id = ? AND cr.logged_date = ?
     ORDER BY cq.display_order ASC`,
    [template_id, date],
  ).map(parseCheckinResponse)
}

function upsertCheckinResponse(
  question_id: string,
  logged_date: string,
  value_numeric: number | null,
  value_text: string | null,
): CheckinResponse {
  const existing = queryRaw(
    'SELECT id FROM checkin_responses WHERE question_id = ? AND logged_date = ?',
    [question_id, logged_date],
  )
  if (existing.length > 0) {
    const id = existing[0]!['id'] as string
    exec(
      'UPDATE checkin_responses SET value_numeric = ?, value_text = ? WHERE id = ?',
      [value_numeric, value_text, id],
    )
    return parseCheckinResponse(queryRaw('SELECT * FROM checkin_responses WHERE id = ?', [id])[0]!)
  }
  const id = crypto.randomUUID()
  exec(
    'INSERT INTO checkin_responses (id, question_id, logged_date, value_numeric, value_text) VALUES (?,?,?,?,?)',
    [id, question_id, logged_date, value_numeric, value_text],
  )
  return parseCheckinResponse(queryRaw('SELECT * FROM checkin_responses WHERE id = ?', [id])[0]!)
}

function deleteCheckinResponse(id: string): null {
  exec('DELETE FROM checkin_responses WHERE id = ?', [id])
  return null
}

// ─── Scribble handlers ────────────────────────────────────────────────────────

function parseScribble(row: Record<string, unknown>): Scribble {
  return {
    id: row['id'] as string,
    title: (row['title'] as string) ?? '',
    content: (row['content'] as string) ?? '',
    tags: safeJsonParse(row['tags'] as string | null, []),
    annotations: safeJsonParse(row['annotations'] as string | null, {}),
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  }
}

function getScribbles(): Scribble[] {
  return queryRaw('SELECT * FROM scribbles ORDER BY updated_at DESC').map(parseScribble)
}

function createScribble(payload: Omit<Scribble, 'id' | 'created_at' | 'updated_at'>): Scribble {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  exec(
    `INSERT INTO scribbles (id, title, content, tags, annotations, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, payload.title ?? '', payload.content ?? '', JSON.stringify(payload.tags ?? []), JSON.stringify(payload.annotations ?? {}), now, now],
  )
  return parseScribble(queryRaw('SELECT * FROM scribbles WHERE id = ?', [id])[0]!)
}

function updateScribble(payload: Partial<Scribble> & { id: string }): Scribble {
  const { id, ...fields } = payload
  const now = new Date().toISOString()
  const updates: [string, unknown][] = [['updated_at', now]]
  if ('title' in fields) updates.push(['title', fields.title ?? ''])
  if ('content' in fields) updates.push(['content', fields.content ?? ''])
  if ('tags' in fields) updates.push(['tags', JSON.stringify(fields.tags ?? [])])
  if ('annotations' in fields) updates.push(['annotations', JSON.stringify(fields.annotations ?? {})])
  const set = updates.map(([k]) => `${k} = ?`).join(', ')
  exec(`UPDATE scribbles SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  return parseScribble(queryRaw('SELECT * FROM scribbles WHERE id = ?', [id])[0]!)
}

function deleteScribble(id: string): null {
  exec('DELETE FROM scribbles WHERE id = ?', [id])
  return null
}

// ─── Reminder handlers ────────────────────────────────────────────────────────

function parseReminder(row: Record<string, unknown>): Reminder {
  return {
    id: row['id'] as string,
    habit_id: row['habit_id'] as string,
    trigger_time: row['trigger_time'] as string,
    days_active: safeJsonParse(row['days_active'] as string | null, null),
  }
}

function getAllReminders(): Reminder[] {
  return queryRaw('SELECT * FROM reminders ORDER BY trigger_time ASC').map(parseReminder)
}

function getRemindersForHabit(habit_id: string): Reminder[] {
  return queryRaw(
    'SELECT * FROM reminders WHERE habit_id = ? ORDER BY trigger_time ASC',
    [habit_id],
  ).map(parseReminder)
}

function createReminder(habit_id: string, trigger_time: string, days_active: number[] | null): Reminder {
  const id = crypto.randomUUID()
  exec(
    'INSERT INTO reminders (id, habit_id, trigger_time, days_active) VALUES (?,?,?,?)',
    [id, habit_id, trigger_time, days_active != null ? JSON.stringify(days_active) : null],
  )
  return parseReminder(queryRaw('SELECT * FROM reminders WHERE id = ?', [id])[0]!)
}

function deleteReminder(id: string): null {
  exec('DELETE FROM reminders WHERE id = ?', [id])
  return null
}

// ─── Check-in reminder handlers ───────────────────────────────────────────────

function parseCheckinReminder(row: Record<string, unknown>): CheckinReminder {
  return {
    id: row['id'] as string,
    template_id: row['template_id'] as string,
    trigger_time: row['trigger_time'] as string,
    days_active: safeJsonParse(row['days_active'] as string | null, null),
  }
}

function getAllCheckinReminders(): CheckinReminder[] {
  return queryRaw('SELECT * FROM checkin_reminders ORDER BY trigger_time ASC').map(parseCheckinReminder)
}

function getCheckinRemindersForTemplate(template_id: string): CheckinReminder[] {
  return queryRaw(
    'SELECT * FROM checkin_reminders WHERE template_id = ? ORDER BY trigger_time ASC',
    [template_id],
  ).map(parseCheckinReminder)
}

function createCheckinReminder(template_id: string, trigger_time: string, days_active: number[] | null): CheckinReminder {
  const id = crypto.randomUUID()
  exec(
    'INSERT INTO checkin_reminders (id, template_id, trigger_time, days_active) VALUES (?,?,?,?)',
    [id, template_id, trigger_time, days_active != null ? JSON.stringify(days_active) : null],
  )
  return parseCheckinReminder(queryRaw('SELECT * FROM checkin_reminders WHERE id = ?', [id])[0]!)
}

function deleteCheckinReminder(id: string): null {
  exec('DELETE FROM checkin_reminders WHERE id = ?', [id])
  return null
}

function getCheckinTemplate(id: string): CheckinTemplate | null {
  const rows = queryRaw('SELECT * FROM checkin_templates WHERE id = ?', [id])
  return rows.length > 0 ? parseCheckinTemplate(rows[0]!) : null
}

function getCheckinSummaryForDate(date: string): CheckinDaySummary[] {
  return queryRaw(
    `SELECT ct.id as template_id, ct.title, COUNT(cr.id) as response_count
     FROM checkin_templates ct
     JOIN checkin_questions cq ON cq.template_id = ct.id
     JOIN checkin_responses cr ON cr.question_id = cq.id
     WHERE cr.logged_date = ?
     GROUP BY ct.id, ct.title
     ORDER BY ct.title`,
    [date],
  ).map(r => ({
    template_id: r['template_id'] as string,
    title: r['title'] as string,
    response_count: r['response_count'] as number,
  }))
}

function getScribblesForDate(date: string): Scribble[] {
  return queryRaw(
    `SELECT * FROM scribbles WHERE updated_at LIKE ? ORDER BY updated_at DESC`,
    [`${date}%`],
  ).map(parseScribble)
}

function getCheckinResponseDates(): Array<{ date: string; count: number }> {
  return queryRaw(
    'SELECT logged_date as date, COUNT(*) as count FROM checkin_responses GROUP BY logged_date ORDER BY logged_date DESC',
  ).map(r => ({ date: r['date'] as string, count: r['count'] as number }))
}

// ─── Message loop ─────────────────────────────────────────────────────────────

self.addEventListener('message', async (e: MessageEvent) => {
  const req = e.data as WorkerRequest
  let result: unknown
  try {
    switch (req.type) {
      case 'GET_HABITS':
        result = getHabits()
        break
      case 'CREATE_HABIT':
        result = createHabit(req.payload)
        break
      case 'UPDATE_HABIT':
        result = updateHabit(req.payload)
        break
      case 'ARCHIVE_HABIT':
        result = archiveHabit(req.payload.id)
        break
      case 'DELETE_HABIT':
        result = deleteHabit(req.payload.id)
        break
      case 'GET_COMPLETIONS_FOR_DATE':
        result = getCompletionsForDate(req.payload.date)
        break
      case 'GET_COMPLETIONS_FOR_HABIT':
        result = getCompletionsForHabit(req.payload.habit_id, req.payload.from, req.payload.to)
        break
      case 'GET_COMPLETIONS_FOR_DATE_RANGE':
        result = getCompletionsForDateRange(req.payload.from, req.payload.to)
        break
      case 'TOGGLE_COMPLETION':
        result = toggleCompletion(
          req.payload.habit_id,
          req.payload.date,
          req.payload.tags,
          req.payload.annotations,
        )
        break
      case 'GET_STREAK':
        result = getStreak(req.payload.habit_id)
        break
      case 'GET_ARCHIVED_HABITS':
        result = getArchivedHabits()
        break
      case 'GET_ALL_COMPLETIONS':
        result = getAllCompletions()
        break
      case 'DELETE_ALL_HABITS':
        result = deleteAllHabits()
        break
      case 'DELETE_ALL_CHECKIN_ENTRIES':
        result = deleteAllCheckinEntries()
        break
      case 'DELETE_ALL_CHECKIN_DATA':
        result = deleteAllCheckinData()
        break
      case 'DELETE_ALL_SCRIBBLES':
        result = deleteAllScribbles()
        break
      case 'CLEAR_APPLIED_DEFAULTS':
        result = clearAppliedDefaults()
        break
      case 'GET_DB_INFO':
        result = getDbInfo()
        break
      case 'INTEGRITY_CHECK':
        result = integrityCheck()
        break
      case 'IS_DEFAULT_APPLIED':
        result = isDefaultApplied(req.payload.key)
        break
      case 'MARK_DEFAULT_APPLIED':
        result = markDefaultApplied(req.payload.key)
        break
      case 'EXPORT_DB':
        result = exportDbBytes()
        break
      case 'EXPORT_JSON_DATA':
        result = exportJsonData(req.payload)
        break
      case 'IMPORT_JSON':
        result = importJson(req.payload)
        break
      case 'GET_HABIT_LOGS_FOR_DATE':
        result = getHabitLogsForDate(req.payload.date)
        break
      case 'GET_HABIT_LOGS_FOR_HABIT':
        result = getHabitLogsForHabit(req.payload.habit_id, req.payload.from, req.payload.to)
        break
      case 'GET_HABIT_LOGS_FOR_DATE_RANGE':
        result = getHabitLogsForDateRange(req.payload.from, req.payload.to)
        break
      case 'LOG_HABIT_VALUE':
        result = logHabitValue(req.payload.habit_id, req.payload.date, req.payload.value, req.payload.notes)
        break
      case 'DELETE_HABIT_LOG':
        result = deleteHabitLog(req.payload.id)
        break
      case 'GET_SCHEDULE_FOR_HABIT':
        result = getScheduleForHabit(req.payload.habit_id)
        break
      case 'UPDATE_HABIT_SCHEDULE':
        result = updateHabitSchedule(req.payload)
        break
      case 'PAUSE_HABIT':
        result = pauseHabit(req.payload.id, req.payload.until)
        break
      case 'PAUSE_ALL_HABITS':
        result = pauseAllHabits(req.payload.until)
        break
      case 'GET_CHECKIN_ENTRY':
        result = getCheckinEntry(req.payload.date)
        break
      case 'UPSERT_CHECKIN_ENTRY':
        result = upsertCheckinEntry(req.payload.date, req.payload.content)
        break
      case 'DELETE_CHECKIN_ENTRY':
        result = deleteCheckinEntry(req.payload.id)
        break
      case 'GET_CHECKIN_ENTRIES':
        result = getCheckinEntries(req.payload.from, req.payload.to)
        break
      case 'GET_CHECKIN_TEMPLATES':
        result = getCheckinTemplates()
        break
      case 'CREATE_CHECKIN_TEMPLATE':
        result = createCheckinTemplate(req.payload)
        break
      case 'UPDATE_CHECKIN_TEMPLATE':
        result = updateCheckinTemplate(req.payload)
        break
      case 'DELETE_CHECKIN_TEMPLATE':
        result = deleteCheckinTemplate(req.payload.id)
        break
      case 'GET_CHECKIN_QUESTIONS':
        result = getCheckinQuestions(req.payload.template_id)
        break
      case 'CREATE_CHECKIN_QUESTION':
        result = createCheckinQuestion(req.payload)
        break
      case 'UPDATE_CHECKIN_QUESTION':
        result = updateCheckinQuestion(req.payload)
        break
      case 'DELETE_CHECKIN_QUESTION':
        result = deleteCheckinQuestion(req.payload.id)
        break
      case 'GET_CHECKIN_RESPONSES':
        result = getCheckinResponses(req.payload.template_id, req.payload.date)
        break
      case 'UPSERT_CHECKIN_RESPONSE':
        result = upsertCheckinResponse(
          req.payload.question_id,
          req.payload.logged_date,
          req.payload.value_numeric,
          req.payload.value_text,
        )
        break
      case 'DELETE_CHECKIN_RESPONSE':
        result = deleteCheckinResponse(req.payload.id)
        break
      case 'GET_SCRIBBLES':
        result = getScribbles()
        break
      case 'CREATE_SCRIBBLE':
        result = createScribble(req.payload)
        break
      case 'UPDATE_SCRIBBLE':
        result = updateScribble(req.payload)
        break
      case 'DELETE_SCRIBBLE':
        result = deleteScribble(req.payload.id)
        break
      case 'GET_ALL_REMINDERS':
        result = getAllReminders()
        break
      case 'GET_REMINDERS_FOR_HABIT':
        result = getRemindersForHabit(req.payload.habit_id)
        break
      case 'CREATE_REMINDER':
        result = createReminder(req.payload.habit_id, req.payload.trigger_time, req.payload.days_active)
        break
      case 'DELETE_REMINDER':
        result = deleteReminder(req.payload.id)
        break
      case 'GET_ALL_CHECKIN_REMINDERS':
        result = getAllCheckinReminders()
        break
      case 'GET_CHECKIN_REMINDERS_FOR_TEMPLATE':
        result = getCheckinRemindersForTemplate(req.payload.template_id)
        break
      case 'CREATE_CHECKIN_REMINDER':
        result = createCheckinReminder(req.payload.template_id, req.payload.trigger_time, req.payload.days_active)
        break
      case 'DELETE_CHECKIN_REMINDER':
        result = deleteCheckinReminder(req.payload.id)
        break
      case 'GET_CHECKIN_TEMPLATE':
        result = getCheckinTemplate(req.payload.id)
        break
      case 'GET_CHECKIN_RESPONSE_DATES':
        result = getCheckinResponseDates()
        break
      case 'GET_CHECKIN_SUMMARY_FOR_DATE':
        result = getCheckinSummaryForDate(req.payload.date)
        break
      case 'GET_SCRIBBLES_FOR_DATE':
        result = getScribblesForDate(req.payload.date)
        break
      case 'NUKE_OPFS': {
        // Close DB to release all OPFS sync-access handles, then wipe every
        // entry in the OPFS root (the SAH pool directory lives there).
        db.close()
        const root = await navigator.storage.getDirectory()
        for await (const [name] of root.entries()) {
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
  self.postMessage({ type: 'INIT_ERROR', message: err instanceof Error ? err.message : String(err) })
}

})()
