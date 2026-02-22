import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import type {
  WorkerRequestBody,
  Habit, Completion, HabitWithSchedule, HabitSchedule, HabitLog,
  CheckinEntry, CheckinTemplate, CheckinQuestion, CheckinResponse,
  Scribble, DbInfo, Reminder, CheckinReminder, HabitatExport, ExportSelection, CheckinDaySummary,
} from '~/types/database'

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
  if (s === 'BEGIN') { await db().beginTransaction(); return }
  if (s === 'COMMIT') { await db().commitTransaction(); return }
  if (s === 'ROLLBACK') { await db().rollbackTransaction(); return }
  if (bind && bind.length > 0) {
    await db().run(sql, bind as (string | number | boolean | null)[], false)
  } else {
    await db().execute(sql, false)
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

async function runSchema(): Promise<void> {
  await db().execute(`
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
  `, false)
}

// ─── Migrations ───────────────────────────────────────────────────────────────

async function runMigrations(): Promise<void> {
  const rows = await queryRaw('PRAGMA user_version')
  let userVersion = (rows[0]?.['user_version'] as number) ?? 0

  // Schema squashed at v10. Add future migrations at key 11+.
  const migrations: Record<number, string[]> = {
    // placeholder — next migration goes here at key 11
  }

  for (let v = userVersion + 1; v in migrations; v++) {
    for (const sql of migrations[v]!) {
      await exec(sql)
    }
    await db().execute(`PRAGMA user_version = ${v}`, false)
    userVersion = v
  }

  if (userVersion === 0) await db().execute('PRAGMA user_version = 10', false)
}

// ─── Default seeds ────────────────────────────────────────────────────────────

async function seedDefaults(): Promise<void> {
  type Seed = { key: string; apply: () => Promise<void> }

  const seeds: Seed[] = [
    {
      key: 'checkin_template:morning_checkin',
      apply: async () => {
        const t = await createCheckinTemplate({ title: 'Morning Check-in', schedule_type: 'DAILY', days_active: null })
        const qs: Omit<CheckinQuestion, 'id'>[] = [
          { template_id: t.id, prompt: 'How did you sleep?',                        response_type: 'SCALE',   display_order: 0 },
          { template_id: t.id, prompt: 'How is your energy level right now?',        response_type: 'SCALE',   display_order: 1 },
          { template_id: t.id, prompt: "What's your main intention for today?",      response_type: 'TEXT',    display_order: 2 },
          { template_id: t.id, prompt: 'Are you feeling anxious or stressed?',       response_type: 'BOOLEAN', display_order: 3 },
        ]
        for (const q of qs) await createCheckinQuestion(q)
      },
    },
    {
      key: 'checkin_template:evening_reflection',
      apply: async () => {
        const t = await createCheckinTemplate({ title: 'Evening Reflection', schedule_type: 'DAILY', days_active: null })
        const qs: Omit<CheckinQuestion, 'id'>[] = [
          { template_id: t.id, prompt: 'Overall mood today (1–10)?',          response_type: 'SCALE',   display_order: 0 },
          { template_id: t.id, prompt: 'What went well today?',               response_type: 'TEXT',    display_order: 1 },
          { template_id: t.id, prompt: 'What could have gone better?',        response_type: 'TEXT',    display_order: 2 },
          { template_id: t.id, prompt: 'Did you complete your main intention?', response_type: 'BOOLEAN', display_order: 3 },
        ]
        for (const q of qs) await createCheckinQuestion(q)
      },
    },
    {
      key: 'checkin_template:weekly_review',
      apply: async () => {
        const t = await createCheckinTemplate({ title: 'Weekly Review', schedule_type: 'WEEKLY', days_active: [0] })
        const qs: Omit<CheckinQuestion, 'id'>[] = [
          { template_id: t.id, prompt: 'How would you rate this week overall (1–10)?', response_type: 'SCALE', display_order: 0 },
          { template_id: t.id, prompt: 'What were your biggest wins?',                 response_type: 'TEXT',  display_order: 1 },
          { template_id: t.id, prompt: 'Which habit are you most proud of?',           response_type: 'TEXT',  display_order: 2 },
          { template_id: t.id, prompt: 'What will you focus on next week?',            response_type: 'TEXT',  display_order: 3 },
        ]
        for (const q of qs) await createCheckinQuestion(q)
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

// ─── Domain deserializers ─────────────────────────────────────────────────────

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
    tags: JSON.parse((row['tags'] as string | null) ?? '[]'),
    annotations: JSON.parse((row['annotations'] as string | null) ?? '{}'),
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
      days_of_week: row['days_of_week'] != null ? JSON.parse(row['days_of_week'] as string) : null,
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
    tags: JSON.parse((row['tags'] as string | null) ?? '[]'),
    annotations: JSON.parse((row['annotations'] as string | null) ?? '{}'),
  }
}

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
    days_active: row['days_active'] != null ? JSON.parse(row['days_active'] as string) : null,
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

function parseScribble(row: Record<string, unknown>): Scribble {
  return {
    id: row['id'] as string,
    title: (row['title'] as string) ?? '',
    content: (row['content'] as string) ?? '',
    tags: JSON.parse((row['tags'] as string | null) ?? '[]'),
    annotations: JSON.parse((row['annotations'] as string | null) ?? '{}'),
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  }
}

function parseReminder(row: Record<string, unknown>): Reminder {
  return {
    id: row['id'] as string,
    habit_id: row['habit_id'] as string,
    trigger_time: row['trigger_time'] as string,
    days_active: row['days_active'] != null ? JSON.parse(row['days_active'] as string) : null,
  }
}

function parseCheckinReminder(row: Record<string, unknown>): CheckinReminder {
  return {
    id: row['id'] as string,
    template_id: row['template_id'] as string,
    trigger_time: row['trigger_time'] as string,
    days_active: row['days_active'] != null ? JSON.parse(row['days_active'] as string) : null,
  }
}

// ─── Habit handlers ───────────────────────────────────────────────────────────

async function getHabits(): Promise<HabitWithSchedule[]> {
  const rows = await queryRaw(`${HABIT_WITH_SCHED_SQL} WHERE h.archived_at IS NULL ORDER BY h.created_at ASC`)
  return rows.map(parseHabitWithSchedule)
}

async function getArchivedHabits(): Promise<HabitWithSchedule[]> {
  const rows = await queryRaw(`${HABIT_WITH_SCHED_SQL} WHERE h.archived_at IS NOT NULL ORDER BY h.archived_at DESC`)
  return rows.map(parseHabitWithSchedule)
}

async function createHabit(payload: Omit<Habit, 'id' | 'created_at' | 'archived_at'>): Promise<HabitWithSchedule> {
  const id = crypto.randomUUID()
  const schedId = crypto.randomUUID()
  const created_at = new Date().toISOString()
  await exec(
    `INSERT INTO habits
       (id, name, description, color, icon, frequency, created_at, tags, annotations,
        type, target_value, paused_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, payload.name, payload.description, payload.color, payload.icon, payload.frequency,
     created_at, JSON.stringify(payload.tags ?? []), JSON.stringify(payload.annotations ?? {}),
     payload.type ?? 'BOOLEAN', payload.target_value ?? 1, payload.paused_until ?? null],
  )
  await exec(
    `INSERT INTO habit_schedules
       (id, habit_id, schedule_type, frequency_count, days_of_week, due_time, start_date, end_date)
     VALUES (?,?,?,?,?,?,?,?)`,
    [schedId, id, 'DAILY', null, null, null, created_at.slice(0, 10), null],
  )
  const rows = await queryRaw(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [id])
  return parseHabitWithSchedule(rows[0]!)
}

async function updateHabit(payload: Partial<Habit> & { id: string }): Promise<HabitWithSchedule> {
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
    await exec(`UPDATE habits SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  }
  const rows = await queryRaw(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [id])
  return parseHabitWithSchedule(rows[0]!)
}

async function archiveHabit(id: string): Promise<null> {
  await exec('UPDATE habits SET archived_at = ? WHERE id = ?', [new Date().toISOString(), id])
  return null
}

async function deleteHabit(id: string): Promise<null> {
  await exec('DELETE FROM habits WHERE id = ?', [id])
  return null
}

async function deleteAllHabits(): Promise<null> {
  await exec('DELETE FROM habits')
  return null
}

async function pauseHabit(id: string, until: string | null): Promise<HabitWithSchedule> {
  await exec('UPDATE habits SET paused_until = ? WHERE id = ?', [until, id])
  const rows = await queryRaw(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [id])
  return parseHabitWithSchedule(rows[0]!)
}

async function pauseAllHabits(until: string | null): Promise<null> {
  await exec('UPDATE habits SET paused_until = ? WHERE archived_at IS NULL', [until])
  return null
}

// ─── Completion handlers ──────────────────────────────────────────────────────

async function getCompletionsForDate(date: string): Promise<Completion[]> {
  const rows = await queryRaw('SELECT * FROM completions WHERE date = ? ORDER BY completed_at ASC', [date])
  return rows.map(parseCompletion)
}

async function getCompletionsForHabit(habit_id: string, from: string, to: string): Promise<Completion[]> {
  const rows = await queryRaw(
    'SELECT * FROM completions WHERE habit_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
    [habit_id, from, to],
  )
  return rows.map(parseCompletion)
}

async function getCompletionsForDateRange(from: string, to: string): Promise<Completion[]> {
  const rows = await queryRaw(
    'SELECT * FROM completions WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [from, to],
  )
  return rows.map(parseCompletion)
}

async function getAllCompletions(): Promise<Completion[]> {
  const rows = await queryRaw('SELECT * FROM completions ORDER BY date DESC')
  return rows.map(parseCompletion)
}

async function toggleCompletion(
  habit_id: string,
  date: string,
  tags: string[] = [],
  annotations: Record<string, string> = {},
): Promise<Completion | null> {
  const existing = await queryRaw('SELECT * FROM completions WHERE habit_id = ? AND date = ?', [habit_id, date])
  if (existing.length > 0) {
    await exec('DELETE FROM completions WHERE habit_id = ? AND date = ?', [habit_id, date])
    return null
  }
  const id = crypto.randomUUID()
  const completed_at = new Date().toISOString()
  await exec(
    `INSERT INTO completions (id, habit_id, date, completed_at, notes, tags, annotations)
     VALUES (?,?,?,?,?,?,?)`,
    [id, habit_id, date, completed_at, '', JSON.stringify(tags), JSON.stringify(annotations)],
  )
  const rows = await queryRaw('SELECT * FROM completions WHERE id = ?', [id])
  return parseCompletion(rows[0]!)
}

// ─── Streak calculation ───────────────────────────────────────────────────────

function calcStreaks(datesDesc: string[]): { current: number; longest: number } {
  if (datesDesc.length === 0) return { current: 0, longest: 0 }
  const today = new Date().toISOString().slice(0, 10)
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

async function getStreak(habit_id: string): Promise<{ current: number; longest: number }> {
  const habitRow = (await queryRaw('SELECT type, target_value FROM habits WHERE id = ?', [habit_id]))[0]
  if (!habitRow) return { current: 0, longest: 0 }
  const type = (habitRow['type'] as string) ?? 'BOOLEAN'
  const target = (habitRow['target_value'] as number) ?? 1
  if (type === 'BOOLEAN') {
    const rows = await queryRaw('SELECT date FROM completions WHERE habit_id = ? ORDER BY date DESC', [habit_id])
    return calcStreaks(rows.map(r => r['date'] as string))
  }
  if (type === 'NUMERIC') {
    const rows = await queryRaw(
      'SELECT date FROM habit_logs WHERE habit_id = ? GROUP BY date HAVING SUM(value) >= ? ORDER BY date DESC',
      [habit_id, target],
    )
    return calcStreaks(rows.map(r => r['date'] as string))
  }
  const rows = await queryRaw(
    'SELECT date FROM habit_logs WHERE habit_id = ? GROUP BY date HAVING SUM(value) < ? ORDER BY date DESC',
    [habit_id, target],
  )
  return calcStreaks(rows.map(r => r['date'] as string))
}

// ─── Habit log handlers ───────────────────────────────────────────────────────

async function getHabitLogsForDate(date: string): Promise<HabitLog[]> {
  const rows = await queryRaw('SELECT * FROM habit_logs WHERE date = ? ORDER BY logged_at ASC', [date])
  return rows.map(parseHabitLog)
}

async function getHabitLogsForHabit(habit_id: string, from: string, to: string): Promise<HabitLog[]> {
  const rows = await queryRaw(
    'SELECT * FROM habit_logs WHERE habit_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
    [habit_id, from, to],
  )
  return rows.map(parseHabitLog)
}

async function getHabitLogsForDateRange(from: string, to: string): Promise<HabitLog[]> {
  const rows = await queryRaw(
    'SELECT * FROM habit_logs WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [from, to],
  )
  return rows.map(parseHabitLog)
}

async function logHabitValue(habit_id: string, date: string, value: number, notes = ''): Promise<HabitLog> {
  const id = crypto.randomUUID()
  const logged_at = new Date().toISOString()
  await exec(
    'INSERT INTO habit_logs (id, habit_id, date, logged_at, value, notes) VALUES (?,?,?,?,?,?)',
    [id, habit_id, date, logged_at, value, notes],
  )
  const rows = await queryRaw('SELECT * FROM habit_logs WHERE id = ?', [id])
  return parseHabitLog(rows[0]!)
}

async function deleteHabitLog(id: string): Promise<null> {
  await exec('DELETE FROM habit_logs WHERE id = ?', [id])
  return null
}

// ─── Schedule handlers ────────────────────────────────────────────────────────

async function getScheduleForHabit(habit_id: string): Promise<HabitSchedule | null> {
  const rows = await queryRaw('SELECT * FROM habit_schedules WHERE habit_id = ?', [habit_id])
  return rows.length > 0 ? parseHabitSchedule(rows[0]!) : null
}

async function updateHabitSchedule(payload: Partial<HabitSchedule> & { id: string }): Promise<HabitSchedule> {
  const { id, ...fields } = payload
  const updates: [string, unknown][] = []
  const scalarFields = ['schedule_type', 'frequency_count', 'due_time', 'start_date', 'end_date'] as const
  for (const k of scalarFields) {
    if (k in fields) updates.push([k, (fields as Record<string, unknown>)[k] ?? null])
  }
  if ('days_of_week' in fields) {
    updates.push(['days_of_week', fields.days_of_week != null ? JSON.stringify(fields.days_of_week) : null])
  }
  if (updates.length > 0) {
    const set = updates.map(([k]) => `${k} = ?`).join(', ')
    await exec(`UPDATE habit_schedules SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  }
  const rows = await queryRaw('SELECT * FROM habit_schedules WHERE id = ?', [id])
  return parseHabitSchedule(rows[0]!)
}

// ─── Check-in entry handlers ──────────────────────────────────────────────────

async function getCheckinEntry(date: string): Promise<CheckinEntry | null> {
  const rows = await queryRaw('SELECT * FROM checkin_entries WHERE entry_date = ?', [date])
  return rows.length > 0 ? parseCheckinEntry(rows[0]!) : null
}

async function upsertCheckinEntry(date: string, content: string): Promise<CheckinEntry> {
  const now = new Date().toISOString()
  const existing = await queryRaw('SELECT id FROM checkin_entries WHERE entry_date = ?', [date])
  if (existing.length > 0) {
    const id = existing[0]!['id'] as string
    await exec('UPDATE checkin_entries SET content = ?, updated_at = ? WHERE id = ?', [content, now, id])
    const rows = await queryRaw('SELECT * FROM checkin_entries WHERE id = ?', [id])
    return parseCheckinEntry(rows[0]!)
  }
  const id = crypto.randomUUID()
  await exec(
    'INSERT INTO checkin_entries (id, entry_date, content, created_at, updated_at) VALUES (?,?,?,?,?)',
    [id, date, content, now, now],
  )
  const rows = await queryRaw('SELECT * FROM checkin_entries WHERE id = ?', [id])
  return parseCheckinEntry(rows[0]!)
}

async function deleteCheckinEntry(id: string): Promise<null> {
  await exec('DELETE FROM checkin_entries WHERE id = ?', [id])
  return null
}

async function getCheckinEntries(from: string, to: string): Promise<CheckinEntry[]> {
  const rows = await queryRaw(
    'SELECT * FROM checkin_entries WHERE entry_date >= ? AND entry_date <= ? ORDER BY entry_date DESC',
    [from, to],
  )
  return rows.map(parseCheckinEntry)
}

async function deleteAllCheckinEntries(): Promise<null> {
  await exec('DELETE FROM checkin_entries')
  return null
}

// ─── Checkin template handlers ────────────────────────────────────────────────

async function getCheckinTemplates(): Promise<CheckinTemplate[]> {
  const rows = await queryRaw('SELECT * FROM checkin_templates ORDER BY title ASC')
  return rows.map(parseCheckinTemplate)
}

async function getCheckinTemplate(id: string): Promise<CheckinTemplate | null> {
  const rows = await queryRaw('SELECT * FROM checkin_templates WHERE id = ?', [id])
  return rows.length > 0 ? parseCheckinTemplate(rows[0]!) : null
}

async function createCheckinTemplate(payload: Omit<CheckinTemplate, 'id'>): Promise<CheckinTemplate> {
  const id = crypto.randomUUID()
  await exec(
    'INSERT INTO checkin_templates (id, title, schedule_type, days_active) VALUES (?,?,?,?)',
    [id, payload.title, payload.schedule_type ?? 'DAILY', payload.days_active != null ? JSON.stringify(payload.days_active) : null],
  )
  const rows = await queryRaw('SELECT * FROM checkin_templates WHERE id = ?', [id])
  return parseCheckinTemplate(rows[0]!)
}

async function updateCheckinTemplate(payload: Partial<CheckinTemplate> & { id: string }): Promise<CheckinTemplate> {
  const { id, ...fields } = payload
  const updates: [string, unknown][] = []
  if ('title' in fields) updates.push(['title', fields.title])
  if ('schedule_type' in fields) updates.push(['schedule_type', fields.schedule_type])
  if ('days_active' in fields) updates.push(['days_active', fields.days_active != null ? JSON.stringify(fields.days_active) : null])
  if (updates.length > 0) {
    const set = updates.map(([k]) => `${k} = ?`).join(', ')
    await exec(`UPDATE checkin_templates SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  }
  const rows = await queryRaw('SELECT * FROM checkin_templates WHERE id = ?', [id])
  return parseCheckinTemplate(rows[0]!)
}

async function deleteCheckinTemplate(id: string): Promise<null> {
  await exec('DELETE FROM checkin_templates WHERE id = ?', [id])
  return null
}

async function deleteAllCheckinData(): Promise<null> {
  await exec('DELETE FROM checkin_templates') // cascades to questions + responses
  return null
}

// ─── Checkin question handlers ────────────────────────────────────────────────

async function getCheckinQuestions(template_id: string): Promise<CheckinQuestion[]> {
  const rows = await queryRaw(
    'SELECT * FROM checkin_questions WHERE template_id = ? ORDER BY display_order ASC',
    [template_id],
  )
  return rows.map(parseCheckinQuestion)
}

async function createCheckinQuestion(payload: Omit<CheckinQuestion, 'id'>): Promise<CheckinQuestion> {
  const id = crypto.randomUUID()
  await exec(
    'INSERT INTO checkin_questions (id, template_id, prompt, response_type, display_order) VALUES (?,?,?,?,?)',
    [id, payload.template_id, payload.prompt, payload.response_type ?? 'TEXT', payload.display_order ?? 0],
  )
  const rows = await queryRaw('SELECT * FROM checkin_questions WHERE id = ?', [id])
  return parseCheckinQuestion(rows[0]!)
}

async function updateCheckinQuestion(payload: Partial<CheckinQuestion> & { id: string }): Promise<CheckinQuestion> {
  const { id, ...fields } = payload
  const updates: [string, unknown][] = []
  if ('prompt' in fields) updates.push(['prompt', fields.prompt])
  if ('response_type' in fields) updates.push(['response_type', fields.response_type])
  if ('display_order' in fields) updates.push(['display_order', fields.display_order])
  if (updates.length > 0) {
    const set = updates.map(([k]) => `${k} = ?`).join(', ')
    await exec(`UPDATE checkin_questions SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  }
  const rows = await queryRaw('SELECT * FROM checkin_questions WHERE id = ?', [id])
  return parseCheckinQuestion(rows[0]!)
}

async function deleteCheckinQuestion(id: string): Promise<null> {
  await exec('DELETE FROM checkin_questions WHERE id = ?', [id])
  return null
}

// ─── Checkin response handlers ────────────────────────────────────────────────

async function getCheckinResponses(template_id: string, date: string): Promise<CheckinResponse[]> {
  const rows = await queryRaw(
    `SELECT cr.* FROM checkin_responses cr
     JOIN checkin_questions cq ON cq.id = cr.question_id
     WHERE cq.template_id = ? AND cr.logged_date = ?
     ORDER BY cq.display_order ASC`,
    [template_id, date],
  )
  return rows.map(parseCheckinResponse)
}

async function upsertCheckinResponse(
  question_id: string,
  logged_date: string,
  value_numeric: number | null,
  value_text: string | null,
): Promise<CheckinResponse> {
  const existing = await queryRaw(
    'SELECT id FROM checkin_responses WHERE question_id = ? AND logged_date = ?',
    [question_id, logged_date],
  )
  if (existing.length > 0) {
    const id = existing[0]!['id'] as string
    await exec(
      'UPDATE checkin_responses SET value_numeric = ?, value_text = ? WHERE id = ?',
      [value_numeric, value_text, id],
    )
    const rows = await queryRaw('SELECT * FROM checkin_responses WHERE id = ?', [id])
    return parseCheckinResponse(rows[0]!)
  }
  const id = crypto.randomUUID()
  await exec(
    'INSERT INTO checkin_responses (id, question_id, logged_date, value_numeric, value_text) VALUES (?,?,?,?,?)',
    [id, question_id, logged_date, value_numeric, value_text],
  )
  const rows = await queryRaw('SELECT * FROM checkin_responses WHERE id = ?', [id])
  return parseCheckinResponse(rows[0]!)
}

async function deleteCheckinResponse(id: string): Promise<null> {
  await exec('DELETE FROM checkin_responses WHERE id = ?', [id])
  return null
}

async function getCheckinResponseDates(): Promise<Array<{ date: string; count: number }>> {
  const rows = await queryRaw(
    'SELECT logged_date as date, COUNT(*) as count FROM checkin_responses GROUP BY logged_date ORDER BY logged_date DESC',
  )
  return rows.map(r => ({ date: r['date'] as string, count: r['count'] as number }))
}

async function getCheckinSummaryForDate(date: string): Promise<CheckinDaySummary[]> {
  const rows = await queryRaw(
    `SELECT ct.id as template_id, ct.title, COUNT(cr.id) as response_count
     FROM checkin_templates ct
     JOIN checkin_questions cq ON cq.template_id = ct.id
     JOIN checkin_responses cr ON cr.question_id = cq.id
     WHERE cr.logged_date = ?
     GROUP BY ct.id, ct.title
     ORDER BY ct.title`,
    [date],
  )
  return rows.map(r => ({
    template_id: r['template_id'] as string,
    title: r['title'] as string,
    response_count: r['response_count'] as number,
  }))
}

// ─── Scribble handlers ────────────────────────────────────────────────────────

async function getScribbles(): Promise<Scribble[]> {
  const rows = await queryRaw('SELECT * FROM scribbles ORDER BY updated_at DESC')
  return rows.map(parseScribble)
}

async function getScribblesForDate(date: string): Promise<Scribble[]> {
  const rows = await queryRaw(
    'SELECT * FROM scribbles WHERE updated_at LIKE ? ORDER BY updated_at DESC',
    [`${date}%`],
  )
  return rows.map(parseScribble)
}

async function createScribble(payload: Omit<Scribble, 'id' | 'created_at' | 'updated_at'>): Promise<Scribble> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await exec(
    'INSERT INTO scribbles (id, title, content, tags, annotations, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, payload.title ?? '', payload.content ?? '',
     JSON.stringify(payload.tags ?? []), JSON.stringify(payload.annotations ?? {}), now, now],
  )
  const rows = await queryRaw('SELECT * FROM scribbles WHERE id = ?', [id])
  return parseScribble(rows[0]!)
}

async function updateScribble(payload: Partial<Scribble> & { id: string }): Promise<Scribble> {
  const { id, ...fields } = payload
  const now = new Date().toISOString()
  const updates: [string, unknown][] = [['updated_at', now]]
  if ('title' in fields) updates.push(['title', fields.title ?? ''])
  if ('content' in fields) updates.push(['content', fields.content ?? ''])
  if ('tags' in fields) updates.push(['tags', JSON.stringify(fields.tags ?? [])])
  if ('annotations' in fields) updates.push(['annotations', JSON.stringify(fields.annotations ?? {})])
  const set = updates.map(([k]) => `${k} = ?`).join(', ')
  await exec(`UPDATE scribbles SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id])
  const rows = await queryRaw('SELECT * FROM scribbles WHERE id = ?', [id])
  return parseScribble(rows[0]!)
}

async function deleteScribble(id: string): Promise<null> {
  await exec('DELETE FROM scribbles WHERE id = ?', [id])
  return null
}

async function deleteAllScribbles(): Promise<null> {
  await exec('DELETE FROM scribbles')
  return null
}

// ─── Reminder handlers ────────────────────────────────────────────────────────

async function getAllReminders(): Promise<Reminder[]> {
  const rows = await queryRaw('SELECT * FROM reminders ORDER BY trigger_time ASC')
  return rows.map(parseReminder)
}

async function getRemindersForHabit(habit_id: string): Promise<Reminder[]> {
  const rows = await queryRaw('SELECT * FROM reminders WHERE habit_id = ? ORDER BY trigger_time ASC', [habit_id])
  return rows.map(parseReminder)
}

async function createReminder(habit_id: string, trigger_time: string, days_active: number[] | null): Promise<Reminder> {
  const id = crypto.randomUUID()
  await exec(
    'INSERT INTO reminders (id, habit_id, trigger_time, days_active) VALUES (?,?,?,?)',
    [id, habit_id, trigger_time, days_active != null ? JSON.stringify(days_active) : null],
  )
  const rows = await queryRaw('SELECT * FROM reminders WHERE id = ?', [id])
  return parseReminder(rows[0]!)
}

async function deleteReminder(id: string): Promise<null> {
  await exec('DELETE FROM reminders WHERE id = ?', [id])
  return null
}

// ─── Check-in reminder handlers ───────────────────────────────────────────────

async function getAllCheckinReminders(): Promise<CheckinReminder[]> {
  const rows = await queryRaw('SELECT * FROM checkin_reminders ORDER BY trigger_time ASC')
  return rows.map(parseCheckinReminder)
}

async function getCheckinRemindersForTemplate(template_id: string): Promise<CheckinReminder[]> {
  const rows = await queryRaw(
    'SELECT * FROM checkin_reminders WHERE template_id = ? ORDER BY trigger_time ASC',
    [template_id],
  )
  return rows.map(parseCheckinReminder)
}

async function createCheckinReminder(template_id: string, trigger_time: string, days_active: number[] | null): Promise<CheckinReminder> {
  const id = crypto.randomUUID()
  await exec(
    'INSERT INTO checkin_reminders (id, template_id, trigger_time, days_active) VALUES (?,?,?,?)',
    [id, template_id, trigger_time, days_active != null ? JSON.stringify(days_active) : null],
  )
  const rows = await queryRaw('SELECT * FROM checkin_reminders WHERE id = ?', [id])
  return parseCheckinReminder(rows[0]!)
}

async function deleteCheckinReminder(id: string): Promise<null> {
  await exec('DELETE FROM checkin_reminders WHERE id = ?', [id])
  return null
}

// ─── Applied defaults ─────────────────────────────────────────────────────────

async function isDefaultApplied(key: string): Promise<boolean> {
  const rows = await queryRaw('SELECT 1 FROM applied_defaults WHERE key = ?', [key])
  return rows.length > 0
}

async function markDefaultApplied(key: string): Promise<null> {
  await exec('INSERT OR IGNORE INTO applied_defaults (key, applied_at) VALUES (?, ?)', [key, new Date().toISOString()])
  return null
}

async function clearAppliedDefaults(): Promise<null> {
  await exec('DELETE FROM applied_defaults')
  return null
}

// ─── DB info / integrity ──────────────────────────────────────────────────────

async function getDbInfo(): Promise<DbInfo> {
  const versionRows = await queryRaw('PRAGMA user_version')
  const userVersion = (versionRows[0]?.['user_version'] as number) ?? 0
  const tableRows = await queryRaw("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
  const indexRows = await queryRaw(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name, name",
  )
  return {
    userVersion,
    tables: tableRows.map(r => ({ name: String(r['name']), sql: String(r['sql'] ?? '') })),
    indices: indexRows.map(r => ({ name: String(r['name']), tbl_name: String(r['tbl_name']), sql: String(r['sql'] ?? '') })),
  }
}

async function integrityCheck(): Promise<string[]> {
  const rows = await queryRaw('PRAGMA integrity_check')
  return rows.map(r => String(r['integrity_check'] ?? ''))
}

// ─── JSON export / import ─────────────────────────────────────────────────────

async function exportJsonData(sel: ExportSelection): Promise<HabitatExport> {
  const habits = sel.habits
    ? (await queryRaw('SELECT * FROM habits ORDER BY created_at ASC')).map(parseHabit)
    : []
  const completions = sel.completions ? await getAllCompletions() : []
  const habit_logs = sel.habit_logs
    ? (await queryRaw('SELECT * FROM habit_logs ORDER BY logged_at ASC')).map(parseHabitLog)
    : []
  const habit_schedules = sel.habit_schedules
    ? (await queryRaw('SELECT * FROM habit_schedules')).map(parseHabitSchedule)
    : []
  const reminders = sel.reminders ? await getAllReminders() : []
  const checkin_templates = sel.checkin_templates ? await getCheckinTemplates() : []
  const checkin_questions = sel.checkin_questions
    ? (await queryRaw('SELECT * FROM checkin_questions ORDER BY template_id, display_order')).map(parseCheckinQuestion)
    : []
  const checkin_responses = sel.checkin_responses
    ? (await queryRaw('SELECT * FROM checkin_responses ORDER BY logged_date ASC')).map(parseCheckinResponse)
    : []
  const checkin_reminders = sel.checkin_reminders ? await getAllCheckinReminders() : []
  const scribbles = sel.scribbles ? await getScribbles() : []
  const checkin_entries = sel.checkin_entries
    ? (await queryRaw('SELECT * FROM checkin_entries ORDER BY entry_date ASC')).map(parseCheckinEntry)
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

async function importJsonV1Habits(data: HabitatExport): Promise<void> {
  for (const h of (data.habits ?? [])) {
    await exec(
      `INSERT OR IGNORE INTO habits
         (id, name, description, color, icon, frequency, created_at, archived_at, tags, annotations, type, target_value, paused_until)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [h.id, h.name, h.description, h.color, h.icon, h.frequency, h.created_at, h.archived_at ?? null,
       JSON.stringify(h.tags ?? []), JSON.stringify(h.annotations ?? {}),
       h.type ?? 'BOOLEAN', h.target_value ?? 1, h.paused_until ?? null],
    )
  }
  for (const c of (data.completions ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO completions (id, habit_id, date, completed_at, notes, tags, annotations) VALUES (?,?,?,?,?,?,?)',
      [c.id, c.habit_id, c.date, c.completed_at, c.notes ?? '',
       JSON.stringify(c.tags ?? []), JSON.stringify(c.annotations ?? {})],
    )
  }
  for (const l of (data.habit_logs ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO habit_logs (id, habit_id, date, logged_at, value, notes) VALUES (?,?,?,?,?,?)',
      [l.id, l.habit_id, l.date, l.logged_at, l.value, l.notes ?? ''],
    )
  }
  for (const s of (data.habit_schedules ?? [])) {
    await exec(
      `INSERT OR IGNORE INTO habit_schedules
         (id, habit_id, schedule_type, frequency_count, days_of_week, due_time, start_date, end_date)
       VALUES (?,?,?,?,?,?,?,?)`,
      [s.id, s.habit_id, s.schedule_type ?? 'DAILY', s.frequency_count ?? null,
       s.days_of_week != null ? JSON.stringify(s.days_of_week) : null,
       s.due_time ?? null, s.start_date ?? null, s.end_date ?? null],
    )
  }
  for (const r of (data.reminders ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO reminders (id, habit_id, trigger_time, days_active) VALUES (?,?,?,?)',
      [r.id, r.habit_id, r.trigger_time, r.days_active != null ? JSON.stringify(r.days_active) : null],
    )
  }
}

async function importJsonV1Checkins(data: HabitatExport): Promise<void> {
  for (const t of (data.checkin_templates ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO checkin_templates (id, title, schedule_type, days_active) VALUES (?,?,?,?)',
      [t.id, t.title, t.schedule_type ?? 'DAILY', t.days_active != null ? JSON.stringify(t.days_active) : null],
    )
  }
  for (const q of (data.checkin_questions ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO checkin_questions (id, template_id, prompt, response_type, display_order) VALUES (?,?,?,?,?)',
      [q.id, q.template_id, q.prompt, q.response_type ?? 'TEXT', q.display_order ?? 0],
    )
  }
  for (const r of (data.checkin_responses ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO checkin_responses (id, question_id, logged_date, value_numeric, value_text) VALUES (?,?,?,?,?)',
      [r.id, r.question_id, r.logged_date, r.value_numeric ?? null, r.value_text ?? null],
    )
  }
  for (const r of (data.checkin_reminders ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO checkin_reminders (id, template_id, trigger_time, days_active) VALUES (?,?,?,?)',
      [r.id, r.template_id, r.trigger_time, r.days_active != null ? JSON.stringify(r.days_active) : null],
    )
  }
}

async function importJsonV1Other(data: HabitatExport): Promise<void> {
  for (const s of (data.scribbles ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO scribbles (id, title, content, tags, annotations, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [s.id, s.title ?? '', s.content ?? '',
       JSON.stringify(s.tags ?? []), JSON.stringify(s.annotations ?? {}),
       s.created_at, s.updated_at],
    )
  }
  for (const e of (data.checkin_entries ?? [])) {
    await exec(
      'INSERT OR IGNORE INTO checkin_entries (id, entry_date, content, created_at, updated_at) VALUES (?,?,?,?,?)',
      [e.id, e.entry_date, e.content ?? '', e.created_at, e.updated_at],
    )
  }
}

async function importJson(data: HabitatExport): Promise<null> {
  if (data.version !== 1) throw new Error(`Unsupported export version: ${String((data as { version: unknown }).version)}`)
  await db().beginTransaction()
  try {
    await importJsonV1Habits(data)
    await importJsonV1Checkins(data)
    await importJsonV1Other(data)
    await db().commitTransaction()
    return null
  } catch (err) {
    await db().rollbackTransaction()
    throw err
  }
}

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
    case 'GET_HABITS':                      return getHabits()
    case 'CREATE_HABIT':                    return createHabit(req.payload)
    case 'UPDATE_HABIT':                    return updateHabit(req.payload)
    case 'ARCHIVE_HABIT':                   return archiveHabit(req.payload.id)
    case 'DELETE_HABIT':                    return deleteHabit(req.payload.id)
    case 'GET_ARCHIVED_HABITS':             return getArchivedHabits()
    case 'GET_COMPLETIONS_FOR_DATE':        return getCompletionsForDate(req.payload.date)
    case 'GET_COMPLETIONS_FOR_HABIT':       return getCompletionsForHabit(req.payload.habit_id, req.payload.from, req.payload.to)
    case 'GET_COMPLETIONS_FOR_DATE_RANGE':  return getCompletionsForDateRange(req.payload.from, req.payload.to)
    case 'GET_ALL_COMPLETIONS':             return getAllCompletions()
    case 'TOGGLE_COMPLETION':               return toggleCompletion(req.payload.habit_id, req.payload.date, req.payload.tags, req.payload.annotations)
    case 'GET_STREAK':                      return getStreak(req.payload.habit_id)
    case 'DELETE_ALL_HABITS':               return deleteAllHabits()
    case 'PAUSE_HABIT':                     return pauseHabit(req.payload.id, req.payload.until)
    case 'PAUSE_ALL_HABITS':                return pauseAllHabits(req.payload.until)
    case 'GET_HABIT_LOGS_FOR_DATE':         return getHabitLogsForDate(req.payload.date)
    case 'GET_HABIT_LOGS_FOR_HABIT':        return getHabitLogsForHabit(req.payload.habit_id, req.payload.from, req.payload.to)
    case 'GET_HABIT_LOGS_FOR_DATE_RANGE':   return getHabitLogsForDateRange(req.payload.from, req.payload.to)
    case 'LOG_HABIT_VALUE':                 return logHabitValue(req.payload.habit_id, req.payload.date, req.payload.value, req.payload.notes)
    case 'DELETE_HABIT_LOG':                return deleteHabitLog(req.payload.id)
    case 'GET_SCHEDULE_FOR_HABIT':          return getScheduleForHabit(req.payload.habit_id)
    case 'UPDATE_HABIT_SCHEDULE':           return updateHabitSchedule(req.payload)
    case 'GET_CHECKIN_ENTRY':               return getCheckinEntry(req.payload.date)
    case 'UPSERT_CHECKIN_ENTRY':            return upsertCheckinEntry(req.payload.date, req.payload.content)
    case 'DELETE_CHECKIN_ENTRY':            return deleteCheckinEntry(req.payload.id)
    case 'GET_CHECKIN_ENTRIES':             return getCheckinEntries(req.payload.from, req.payload.to)
    case 'DELETE_ALL_CHECKIN_ENTRIES':      return deleteAllCheckinEntries()
    case 'GET_CHECKIN_TEMPLATES':           return getCheckinTemplates()
    case 'GET_CHECKIN_TEMPLATE':            return getCheckinTemplate(req.payload.id)
    case 'CREATE_CHECKIN_TEMPLATE':         return createCheckinTemplate(req.payload)
    case 'UPDATE_CHECKIN_TEMPLATE':         return updateCheckinTemplate(req.payload)
    case 'DELETE_CHECKIN_TEMPLATE':         return deleteCheckinTemplate(req.payload.id)
    case 'DELETE_ALL_CHECKIN_DATA':         return deleteAllCheckinData()
    case 'GET_CHECKIN_QUESTIONS':           return getCheckinQuestions(req.payload.template_id)
    case 'CREATE_CHECKIN_QUESTION':         return createCheckinQuestion(req.payload)
    case 'UPDATE_CHECKIN_QUESTION':         return updateCheckinQuestion(req.payload)
    case 'DELETE_CHECKIN_QUESTION':         return deleteCheckinQuestion(req.payload.id)
    case 'GET_CHECKIN_RESPONSES':           return getCheckinResponses(req.payload.template_id, req.payload.date)
    case 'UPSERT_CHECKIN_RESPONSE':         return upsertCheckinResponse(req.payload.question_id, req.payload.logged_date, req.payload.value_numeric, req.payload.value_text)
    case 'DELETE_CHECKIN_RESPONSE':         return deleteCheckinResponse(req.payload.id)
    case 'GET_CHECKIN_RESPONSE_DATES':      return getCheckinResponseDates()
    case 'GET_CHECKIN_SUMMARY_FOR_DATE':    return getCheckinSummaryForDate(req.payload.date)
    case 'GET_SCRIBBLES':                   return getScribbles()
    case 'GET_SCRIBBLES_FOR_DATE':          return getScribblesForDate(req.payload.date)
    case 'CREATE_SCRIBBLE':                 return createScribble(req.payload)
    case 'UPDATE_SCRIBBLE':                 return updateScribble(req.payload)
    case 'DELETE_SCRIBBLE':                 return deleteScribble(req.payload.id)
    case 'DELETE_ALL_SCRIBBLES':            return deleteAllScribbles()
    case 'GET_ALL_REMINDERS':              return getAllReminders()
    case 'GET_REMINDERS_FOR_HABIT':         return getRemindersForHabit(req.payload.habit_id)
    case 'CREATE_REMINDER':                 return createReminder(req.payload.habit_id, req.payload.trigger_time, req.payload.days_active)
    case 'DELETE_REMINDER':                 return deleteReminder(req.payload.id)
    case 'GET_ALL_CHECKIN_REMINDERS':       return getAllCheckinReminders()
    case 'GET_CHECKIN_REMINDERS_FOR_TEMPLATE': return getCheckinRemindersForTemplate(req.payload.template_id)
    case 'CREATE_CHECKIN_REMINDER':         return createCheckinReminder(req.payload.template_id, req.payload.trigger_time, req.payload.days_active)
    case 'DELETE_CHECKIN_REMINDER':         return deleteCheckinReminder(req.payload.id)
    case 'IS_DEFAULT_APPLIED':              return isDefaultApplied(req.payload.key)
    case 'MARK_DEFAULT_APPLIED':            return markDefaultApplied(req.payload.key)
    case 'CLEAR_APPLIED_DEFAULTS':          return clearAppliedDefaults()
    case 'GET_DB_INFO':                     return getDbInfo()
    case 'INTEGRITY_CHECK':                 return integrityCheck()
    case 'EXPORT_JSON_DATA':                return exportJsonData(req.payload)
    case 'IMPORT_JSON':                     return importJson(req.payload)
    // Not applicable on native — no OPFS, no raw WASM serialize
    case 'NUKE_OPFS':                       return null
    case 'EXPORT_DB':                       throw new Error('Raw DB export is not supported on native')
    default:
      throw new Error(`Unknown request type: ${(req as WorkerRequestBody).type}`)
  }
}
