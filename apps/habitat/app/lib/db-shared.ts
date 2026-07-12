/**
 * Shared database operations for both web (WorkerDbAdapter) and native
 * (NativeDbAdapter) paths. Every function is async and receives a DbAdapter
 * so it can work with either wa-sqlite (sync, wrapped in Promise.resolve()) or
 * Capacitor SQLite (natively async).
 *
 * Row parsing is delegated to db-parsers.ts.
 */
import {
  HABIT_WITH_SCHED_SQL,
  parseBoredActivity,
  parseBoredCategory,
  parseCheckinEntry,
  parseCheckinQuestion,
  parseCheckinReminder,
  parseCheckinResponse,
  parseCheckinTemplate,
  parseCompletion,
  parseHabit,
  parseHabitLog,
  parseHabitSchedule,
  parseHabitWithSchedule,
  parseReminder,
  parseScribble,
  parseTodo,
} from '~/lib/db-parsers'
import { computeStreak, type StreakResult } from '~/lib/streak-engine'
import type {
  BoredActivity,
  BoredCategory,
  BoredOracleResult,
  CheckinCompletion,
  CheckinDaySummary,
  CheckinEntry,
  CheckinHistoryRow,
  CheckinQuestion,
  CheckinReminder,
  CheckinResponse,
  CheckinTemplate,
  Completion,
  DbAdapter,
  ExportSelection,
  Habit,
  HabitatExport,
  HabitLog,
  HabitSchedule,
  HabitWithSchedule,
  ImageNoteRow,
  Reminder,
  Scribble,
  SearchResult,
  TagRow,
  TagSource,
  Todo,
  VoiceNoteRow,
  WorkerRequestBody,
} from '~/types/database'

// ─── Dynamic UPDATE helpers ──────────────────────────────────────────────────

export type FieldSpec =
  | { kind: 'scalar'; name: string }
  | { kind: 'nullable'; name: string; fallback?: unknown }
  | { kind: 'json'; name: string; fallback: unknown }
  | { kind: 'json-nullable'; name: string }
  | { kind: 'bool'; name: string }

export function buildUpdatePairs(
  fields: Record<string, unknown>,
  specs: FieldSpec[],
): [string, unknown][] {
  const pairs: [string, unknown][] = []
  for (const s of specs) {
    if (!(s.name in fields)) continue
    const v = fields[s.name]
    switch (s.kind) {
      case 'scalar':
        pairs.push([s.name, v])
        break
      case 'nullable':
        pairs.push([s.name, v ?? (s.fallback === undefined ? null : s.fallback)])
        break
      case 'json':
        pairs.push([s.name, JSON.stringify(v ?? s.fallback)])
        break
      case 'json-nullable':
        pairs.push([s.name, v == null ? null : JSON.stringify(v)])
        break
      case 'bool':
        pairs.push([s.name, v ? 1 : 0])
        break
    }
  }
  return pairs
}

async function execDynamicUpdate(
  db: DbAdapter,
  table: string,
  id: string,
  pairs: [string, unknown][],
): Promise<void> {
  if (pairs.length === 0) return
  const set = pairs.map(([k]) => `${k} = ?`).join(', ')
  await db.exec(`UPDATE ${table} SET ${set} WHERE id = ?`, [...pairs.map(([, v]) => v), id])
}

// ─── Habit operations ─────────────────────────────────────────────────────────

export async function getHabits(db: DbAdapter): Promise<HabitWithSchedule[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    `${HABIT_WITH_SCHED_SQL} WHERE h.archived_at IS NULL ORDER BY h.created_at ASC`,
  )
  return rows.map(parseHabitWithSchedule)
}

export async function createHabit(
  db: DbAdapter,
  payload: Omit<Habit, 'id' | 'created_at' | 'archived_at'>,
): Promise<HabitWithSchedule> {
  const id = crypto.randomUUID()
  const schedId = crypto.randomUUID()
  const created_at = new Date().toISOString()
  await db.exec(
    `INSERT INTO habits
     (id, name, description, why, color, icon, frequency, created_at, tags, annotations,
      type, target_value, paused_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      payload.name,
      payload.description,
      payload.why ?? '',
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
  await db.exec(
    `INSERT INTO habit_schedules
     (id, habit_id, schedule_type, frequency_count, days_of_week, due_time, start_date, end_date)
     VALUES (?,?,?,?,?,?,?,?)`,
    [schedId, id, 'DAILY', null, null, null, created_at.slice(0, 10), null],
  )
  const row = await db.queryOne<Record<string, unknown>>(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [
    id,
  ])
  return parseHabitWithSchedule(row!)
}

export async function updateHabit(
  db: DbAdapter,
  payload: Partial<Habit> & { id: string },
): Promise<HabitWithSchedule> {
  const { id, ...fields } = payload
  const pairs = buildUpdatePairs(fields as Record<string, unknown>, [
    { kind: 'scalar', name: 'name' },
    { kind: 'scalar', name: 'description' },
    { kind: 'scalar', name: 'why' },
    { kind: 'scalar', name: 'color' },
    { kind: 'scalar', name: 'icon' },
    { kind: 'scalar', name: 'frequency' },
    { kind: 'scalar', name: 'type' },
    { kind: 'scalar', name: 'target_value' },
    { kind: 'nullable', name: 'paused_until' },
    { kind: 'json', name: 'tags', fallback: [] },
    { kind: 'json', name: 'annotations', fallback: {} },
  ])
  await execDynamicUpdate(db, 'habits', id, pairs)
  const row = await db.queryOne<Record<string, unknown>>(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [
    id,
  ])
  return parseHabitWithSchedule(row!)
}

export async function archiveHabit(db: DbAdapter, id: string): Promise<null> {
  await db.exec('UPDATE habits SET archived_at = ? WHERE id = ?', [new Date().toISOString(), id])
  return null
}

export async function deleteHabit(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM habits WHERE id = ?', [id])
  return null
}

export async function getArchivedHabits(db: DbAdapter): Promise<HabitWithSchedule[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    `${HABIT_WITH_SCHED_SQL} WHERE h.archived_at IS NOT NULL ORDER BY h.archived_at DESC`,
  )
  return rows.map(parseHabitWithSchedule)
}

export async function deleteAllHabits(db: DbAdapter): Promise<null> {
  await db.exec('DELETE FROM habits')
  return null
}

// ─── Completions ──────────────────────────────────────────────────────────────

export async function getCompletionsForDate(db: DbAdapter, date: string): Promise<Completion[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM completions WHERE date = ? ORDER BY completed_at ASC',
    [date],
  )
  return rows.map(parseCompletion)
}

export async function getCompletionsForHabit(
  db: DbAdapter,
  habit_id: string,
  from: string,
  to: string,
): Promise<Completion[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM completions WHERE habit_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
    [habit_id, from, to],
  )
  return rows.map(parseCompletion)
}

export async function getCompletionsForDateRange(
  db: DbAdapter,
  from: string,
  to: string,
): Promise<Completion[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM completions WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [from, to],
  )
  return rows.map(parseCompletion)
}

export async function toggleCompletion(
  db: DbAdapter,
  habit_id: string,
  date: string,
  tags: string[] = [],
  annotations: Record<string, string> = {},
): Promise<Completion | null> {
  const existing = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM completions WHERE habit_id = ? AND date = ?',
    [habit_id, date],
  )
  if (existing.length > 0) {
    await db.exec('DELETE FROM completions WHERE habit_id = ? AND date = ?', [habit_id, date])
    return null
  }
  const id = crypto.randomUUID()
  const completed_at = new Date().toISOString()
  await db.exec(
    `INSERT INTO completions (id, habit_id, date, completed_at, notes, tags, annotations)
     VALUES (?,?,?,?,?,?,?)`,
    [id, habit_id, date, completed_at, '', JSON.stringify(tags), JSON.stringify(annotations)],
  )
  const rows2 = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM completions WHERE id = ?',
    [id],
  )
  return parseCompletion(rows2[0]!)
}

export async function getAllCompletions(db: DbAdapter): Promise<Completion[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM completions ORDER BY date DESC',
  )
  return rows.map(parseCompletion)
}

// ─── Streaks ──────────────────────────────────────────────────────────────────

/**
 * Schedule-aware streak with "never miss twice" grace. Delegates the state logic
 * to the pure `computeStreak` engine; this function only gathers the habit's
 * schedule + per-day data from the DB.
 */
export async function getStreak(db: DbAdapter, habit_id: string): Promise<StreakResult> {
  const empty: StreakResult = {
    current: 0,
    longest: 0,
    status: 'active',
    thawProgress: 0,
    plantLevel: 0,
    daisies: 0,
    thawed: 0,
  }

  const habitRows = await db.queryAll<Record<string, unknown>>(
    'SELECT type, target_value FROM habits WHERE id = ?',
    [habit_id],
  )
  const habitRow = habitRows[0]
  if (!habitRow) return empty
  const type = ((habitRow['type'] as string) ?? 'BOOLEAN') as 'BOOLEAN' | 'NUMERIC' | 'LIMIT'
  const target = (habitRow['target_value'] as number) ?? 1

  const schedRows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM habit_schedules WHERE habit_id = ?',
    [habit_id],
  )
  const sched = schedRows[0] ? parseHabitSchedule(schedRows[0]) : null
  const schedule = {
    type: sched?.schedule_type ?? 'DAILY',
    daysOfWeek: sched?.days_of_week ?? null,
    frequencyCount: sched?.frequency_count ?? null,
    startDate: sched?.start_date ?? null,
  }
  const today = new Date().toISOString().slice(0, 10)

  if (type === 'BOOLEAN') {
    const rows = await db.queryAll<Record<string, unknown>>(
      'SELECT date FROM completions WHERE habit_id = ?',
      [habit_id],
    )
    return computeStreak({
      type,
      target,
      schedule,
      completions: new Set(rows.map((r) => r['date'] as string)),
      today,
    })
  }

  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT date, SUM(value) AS total FROM habit_logs WHERE habit_id = ? GROUP BY date',
    [habit_id],
  )
  const sums = new Map<string, number>()
  for (const r of rows) sums.set(r['date'] as string, Number(r['total'] ?? 0))
  return computeStreak({ type, target, schedule, sums, today })
}

// ─── Habit logs ───────────────────────────────────────────────────────────────

export async function getHabitLogsForDate(db: DbAdapter, date: string): Promise<HabitLog[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM habit_logs WHERE date = ? ORDER BY logged_at ASC',
    [date],
  )
  return rows.map(parseHabitLog)
}

export async function getHabitLogsForHabit(
  db: DbAdapter,
  habit_id: string,
  from: string,
  to: string,
): Promise<HabitLog[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM habit_logs WHERE habit_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
    [habit_id, from, to],
  )
  return rows.map(parseHabitLog)
}

export async function getHabitLogsForDateRange(
  db: DbAdapter,
  from: string,
  to: string,
): Promise<HabitLog[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM habit_logs WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [from, to],
  )
  return rows.map(parseHabitLog)
}

export async function logHabitValue(
  db: DbAdapter,
  habit_id: string,
  date: string,
  value: number,
  notes = '',
): Promise<HabitLog> {
  const id = crypto.randomUUID()
  const logged_at = new Date().toISOString()
  await db.exec(
    'INSERT INTO habit_logs (id, habit_id, date, logged_at, value, notes) VALUES (?,?,?,?,?,?)',
    [id, habit_id, date, logged_at, value, notes],
  )
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM habit_logs WHERE id = ?', [
    id,
  ])
  return parseHabitLog(row!)
}

export async function deleteHabitLog(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM habit_logs WHERE id = ?', [id])
  return null
}

// ─── Schedules ────────────────────────────────────────────────────────────────

export async function getScheduleForHabit(
  db: DbAdapter,
  habit_id: string,
): Promise<HabitSchedule | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM habit_schedules WHERE habit_id = ?',
    [habit_id],
  )
  return row ? parseHabitSchedule(row) : null
}

export async function updateHabitSchedule(
  db: DbAdapter,
  payload: Partial<HabitSchedule> & { id: string },
): Promise<HabitSchedule> {
  const { id, ...fields } = payload
  const pairs = buildUpdatePairs(fields as Record<string, unknown>, [
    { kind: 'nullable', name: 'schedule_type' },
    { kind: 'nullable', name: 'frequency_count' },
    { kind: 'nullable', name: 'due_time' },
    { kind: 'nullable', name: 'start_date' },
    { kind: 'nullable', name: 'end_date' },
    { kind: 'json-nullable', name: 'days_of_week' },
  ])
  await execDynamicUpdate(db, 'habit_schedules', id, pairs)
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM habit_schedules WHERE id = ?',
    [id],
  )
  return parseHabitSchedule(row!)
}

export async function pauseHabit(
  db: DbAdapter,
  id: string,
  until: string | null,
): Promise<HabitWithSchedule> {
  await db.exec('UPDATE habits SET paused_until = ? WHERE id = ?', [until, id])
  const row = await db.queryOne<Record<string, unknown>>(`${HABIT_WITH_SCHED_SQL} WHERE h.id = ?`, [
    id,
  ])
  return parseHabitWithSchedule(row!)
}

export async function pauseAllHabits(db: DbAdapter, until: string | null): Promise<null> {
  await db.exec('UPDATE habits SET paused_until = ? WHERE archived_at IS NULL', [until])
  return null
}

// ─── Check-in entries ─────────────────────────────────────────────────────────

export async function getCheckinEntry(db: DbAdapter, date: string): Promise<CheckinEntry | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM checkin_entries WHERE entry_date = ?',
    [date],
  )
  return row ? parseCheckinEntry(row) : null
}

export async function upsertCheckinEntry(
  db: DbAdapter,
  date: string,
  content: string,
): Promise<CheckinEntry> {
  const now = new Date().toISOString()
  const existing = await db.queryAll<Record<string, unknown>>(
    'SELECT id FROM checkin_entries WHERE entry_date = ?',
    [date],
  )
  if (existing.length > 0) {
    const id = existing[0]!['id'] as string
    await db.exec('UPDATE checkin_entries SET content = ?, updated_at = ? WHERE id = ?', [
      content,
      now,
      id,
    ])
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM checkin_entries WHERE id = ?',
      [id],
    )
    return parseCheckinEntry(row!)
  }
  const id = crypto.randomUUID()
  await db.exec(
    'INSERT INTO checkin_entries (id, entry_date, content, created_at, updated_at) VALUES (?,?,?,?,?)',
    [id, date, content, now, now],
  )
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM checkin_entries WHERE id = ?',
    [id],
  )
  return parseCheckinEntry(row!)
}

export async function deleteCheckinEntry(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM checkin_entries WHERE id = ?', [id])
  return null
}

export async function getCheckinEntries(
  db: DbAdapter,
  from: string,
  to: string,
): Promise<CheckinEntry[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM checkin_entries WHERE entry_date >= ? AND entry_date <= ? ORDER BY entry_date DESC',
    [from, to],
  )
  return rows.map(parseCheckinEntry)
}

export async function deleteAllCheckinEntries(db: DbAdapter): Promise<null> {
  await db.exec('DELETE FROM checkin_entries')
  return null
}

// ─── Check-in templates ───────────────────────────────────────────────────────

export async function getCheckinTemplates(db: DbAdapter): Promise<CheckinTemplate[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT t.*,
      (SELECT COUNT(DISTINCT r.logged_date)
       FROM checkin_responses r
       JOIN checkin_questions q ON r.question_id = q.id
       WHERE q.template_id = t.id AND q.archived_at IS NULL) AS response_day_count,
      (SELECT COUNT(*) FROM checkin_questions q WHERE q.template_id = t.id AND q.archived_at IS NULL) AS question_count
     FROM checkin_templates t
     WHERE t.archived_at IS NULL
     ORDER BY t.title ASC`,
  )
  return rows.map(parseCheckinTemplate)
}

export async function getCheckinTemplate(
  db: DbAdapter,
  id: string,
): Promise<CheckinTemplate | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM checkin_templates WHERE id = ?',
    [id],
  )
  return row ? parseCheckinTemplate(row) : null
}

export async function createCheckinTemplate(
  db: DbAdapter,
  payload: Omit<CheckinTemplate, 'id' | 'archived_at' | 'response_day_count' | 'question_count'>,
): Promise<CheckinTemplate> {
  const id = crypto.randomUUID()
  await db.exec(
    'INSERT INTO checkin_templates (id, title, schedule_type, days_active) VALUES (?,?,?,?)',
    [
      id,
      payload.title,
      payload.schedule_type ?? 'DAILY',
      payload.days_active == null ? null : JSON.stringify(payload.days_active),
    ],
  )
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM checkin_templates WHERE id = ?',
    [id],
  )
  return parseCheckinTemplate(row!)
}

export async function updateCheckinTemplate(
  db: DbAdapter,
  payload: Partial<CheckinTemplate> & { id: string },
): Promise<CheckinTemplate> {
  const { id, ...fields } = payload
  const pairs = buildUpdatePairs(fields as Record<string, unknown>, [
    { kind: 'scalar', name: 'title' },
    { kind: 'scalar', name: 'schedule_type' },
    { kind: 'json-nullable', name: 'days_active' },
  ])
  await execDynamicUpdate(db, 'checkin_templates', id, pairs)
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM checkin_templates WHERE id = ?',
    [id],
  )
  return parseCheckinTemplate(row!)
}

export async function deleteCheckinTemplate(db: DbAdapter, id: string): Promise<null> {
  const now = new Date().toISOString()
  await db.exec('UPDATE checkin_templates SET archived_at = ? WHERE id = ?', [now, id])
  return null
}

export async function deleteAllCheckinData(db: DbAdapter): Promise<null> {
  await db.exec('DELETE FROM checkin_templates') // cascades to questions + responses
  return null
}

export async function getCheckinSummaryForDate(
  db: DbAdapter,
  date: string,
): Promise<CheckinDaySummary[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT 
       ct.id as template_id, 
       ct.title,
       ct.schedule_type,
       ct.days_active,
       (SELECT COUNT(*) 
        FROM checkin_responses cr 
        JOIN checkin_questions cq ON cq.id = cr.question_id 
        WHERE cq.template_id = ct.id AND cr.logged_date = ?) as response_count,
       EXISTS(SELECT 1 FROM checkin_completions WHERE template_id = ct.id AND date = ?) as is_completed
     FROM checkin_templates ct
     WHERE ct.archived_at IS NULL
     ORDER BY ct.title`,
    [date, date],
  )

  // Filter by schedule: skip templates not active on this day of week
  const dow = new Date(`${date}T12:00:00`).getDay() // 0=Sun … 6=Sat
  return rows
    .filter((r) => {
      const schedType = r['schedule_type'] as string
      if (schedType === 'DAILY') return true
      if (schedType === 'WEEKLY') {
        const raw = r['days_active']
        if (raw == null) return true // no days_active = every day of the week
        const days: number[] = typeof raw === 'string' ? JSON.parse(raw) : (raw as number[])
        return days.length === 0 || days.includes(dow)
      }
      // MONTHLY: always show (no day-of-week constraint)
      return true
    })
    .map((r) => ({
      template_id: r['template_id'] as string,
      title: r['title'] as string,
      response_count: r['response_count'] as number,
      is_completed: !!r['is_completed'],
    }))
}

export async function toggleCheckinCompletion(
  db: DbAdapter,
  template_id: string,
  date: string,
): Promise<void> {
  const existing = await db.queryOne<Record<string, unknown>>(
    'SELECT id FROM checkin_completions WHERE template_id = ? AND date = ?',
    [template_id, date],
  )
  if (existing) {
    await db.exec('DELETE FROM checkin_completions WHERE template_id = ? AND date = ?', [
      template_id,
      date,
    ])
  } else {
    await db.exec(
      'INSERT INTO checkin_completions (id, template_id, date, completed_at) VALUES (?,?,?,?)',
      [crypto.randomUUID(), template_id, date, new Date().toISOString()],
    )
  }
}

export async function getCheckinCompletionsForDate(
  db: DbAdapter,
  date: string,
): Promise<CheckinCompletion[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM checkin_completions WHERE date = ?',
    [date],
  )
  return rows.map((r) => ({
    id: r['id'] as string,
    template_id: r['template_id'] as string,
    date: r['date'] as string,
    completed_at: r['completed_at'] as string,
  }))
}

export async function getCheckinResponseDates(
  db: DbAdapter,
): Promise<Array<{ date: string; count: number }>> {
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT date, SUM(cnt) as count FROM (
      SELECT logged_date as date, COUNT(*) as cnt FROM checkin_responses GROUP BY logged_date
      UNION ALL
      SELECT date, COUNT(*) as cnt FROM checkin_completions GROUP BY date
    ) GROUP BY date ORDER BY date DESC`,
  )
  return rows.map((r) => ({
    date: r['date'] as string,
    count: r['count'] as number,
  }))
}

export async function getCheckinHistory(
  db: DbAdapter,
  from: string,
  to: string,
  template_id?: string,
): Promise<CheckinHistoryRow[]> {
  const where = template_id
    ? 'WHERE cr.logged_date >= ? AND cr.logged_date <= ? AND ct.id = ?'
    : 'WHERE cr.logged_date >= ? AND cr.logged_date <= ?'
  const bind: unknown[] = template_id ? [from, to, template_id] : [from, to]
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT
       ct.id AS template_id, ct.title AS template_title, ct.schedule_type,
       cq.id AS question_id, cq.prompt, cq.response_type, cq.display_order, cq.desired_answer,
       cr.logged_date, cr.value_numeric, cr.value_text
     FROM checkin_responses cr
     JOIN checkin_questions cq ON cq.id = cr.question_id
     JOIN checkin_templates ct ON ct.id = cq.template_id
     ${where}
     ORDER BY cr.logged_date DESC, ct.title ASC, cq.display_order ASC`,
    bind,
  )
  return rows.map((r) => ({
    template_id: r['template_id'] as string,
    template_title: r['template_title'] as string,
    schedule_type: r['schedule_type'] as string,
    question_id: r['question_id'] as string,
    prompt: r['prompt'] as string,
    response_type: r['response_type'] as 'SCALE' | 'TEXT' | 'BOOLEAN',
    display_order: r['display_order'] as number,
    desired_answer: (r['desired_answer'] as number) ?? 1,
    logged_date: r['logged_date'] as string,
    value_numeric: (r['value_numeric'] as number | null) ?? null,
    value_text: (r['value_text'] as string | null) ?? null,
  }))
}

// ─── Check-in questions ───────────────────────────────────────────────────────

export async function getCheckinQuestions(
  db: DbAdapter,
  template_id: string,
): Promise<CheckinQuestion[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM checkin_questions WHERE template_id = ? AND archived_at IS NULL ORDER BY display_order ASC',
    [template_id],
  )
  return rows.map(parseCheckinQuestion)
}

export async function createCheckinQuestion(
  db: DbAdapter,
  payload: Omit<CheckinQuestion, 'id' | 'archived_at'>,
): Promise<CheckinQuestion> {
  const id = crypto.randomUUID()
  await db.exec(
    'INSERT INTO checkin_questions (id, template_id, prompt, response_type, display_order, desired_answer) VALUES (?,?,?,?,?,?)',
    [
      id,
      payload.template_id,
      payload.prompt,
      payload.response_type ?? 'TEXT',
      payload.display_order ?? 0,
      payload.desired_answer ?? 1,
    ],
  )
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM checkin_questions WHERE id = ?',
    [id],
  )
  return parseCheckinQuestion(row!)
}

export async function updateCheckinQuestion(
  db: DbAdapter,
  payload: Partial<CheckinQuestion> & { id: string },
): Promise<CheckinQuestion> {
  const { id, ...fields } = payload
  const pairs = buildUpdatePairs(fields as Record<string, unknown>, [
    { kind: 'scalar', name: 'prompt' },
    { kind: 'scalar', name: 'response_type' },
    { kind: 'scalar', name: 'display_order' },
    { kind: 'scalar', name: 'desired_answer' },
  ])
  await execDynamicUpdate(db, 'checkin_questions', id, pairs)
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM checkin_questions WHERE id = ?',
    [id],
  )
  return parseCheckinQuestion(row!)
}

export async function deleteCheckinQuestion(db: DbAdapter, id: string): Promise<null> {
  const now = new Date().toISOString()
  await db.exec('UPDATE checkin_questions SET archived_at = ? WHERE id = ?', [now, id])
  return null
}

// ─── Check-in responses ───────────────────────────────────────────────────────

export async function getCheckinResponses(
  db: DbAdapter,
  template_id: string,
  date: string,
): Promise<CheckinResponse[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT cr.* FROM checkin_responses cr
     JOIN checkin_questions cq ON cq.id = cr.question_id
     WHERE cq.template_id = ? AND cr.logged_date = ?
     ORDER BY cq.display_order ASC`,
    [template_id, date],
  )
  return rows.map(parseCheckinResponse)
}

export async function upsertCheckinResponse(
  db: DbAdapter,
  question_id: string,
  logged_date: string,
  value_numeric: number | null,
  value_text: string | null,
): Promise<CheckinResponse> {
  const existing = await db.queryAll<Record<string, unknown>>(
    'SELECT id FROM checkin_responses WHERE question_id = ? AND logged_date = ?',
    [question_id, logged_date],
  )
  if (existing.length > 0) {
    const id = existing[0]!['id'] as string
    await db.exec('UPDATE checkin_responses SET value_numeric = ?, value_text = ? WHERE id = ?', [
      value_numeric,
      value_text,
      id,
    ])
    const rows2 = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM checkin_responses WHERE id = ?',
      [id],
    )
    return parseCheckinResponse(rows2[0]!)
  }
  const id = crypto.randomUUID()
  await db.exec(
    'INSERT INTO checkin_responses (id, question_id, logged_date, value_numeric, value_text) VALUES (?,?,?,?,?)',
    [id, question_id, logged_date, value_numeric, value_text],
  )
  const rows2 = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM checkin_responses WHERE id = ?',
    [id],
  )
  return parseCheckinResponse(rows2[0]!)
}

export async function deleteCheckinResponse(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM checkin_responses WHERE id = ?', [id])
  return null
}

// ─── Check-in reminders ───────────────────────────────────────────────────────

export async function getAllCheckinReminders(db: DbAdapter): Promise<CheckinReminder[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM checkin_reminders ORDER BY trigger_time ASC',
  )
  return rows.map(parseCheckinReminder)
}

export async function getCheckinRemindersForTemplate(
  db: DbAdapter,
  template_id: string,
): Promise<CheckinReminder[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM checkin_reminders WHERE template_id = ? ORDER BY trigger_time ASC',
    [template_id],
  )
  return rows.map(parseCheckinReminder)
}

export async function createCheckinReminder(
  db: DbAdapter,
  template_id: string,
  trigger_time: string,
  days_active: number[] | null,
): Promise<CheckinReminder> {
  const id = crypto.randomUUID()
  await db.exec(
    'INSERT INTO checkin_reminders (id, template_id, trigger_time, days_active) VALUES (?,?,?,?)',
    [id, template_id, trigger_time, days_active == null ? null : JSON.stringify(days_active)],
  )
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM checkin_reminders WHERE id = ?',
    [id],
  )
  return parseCheckinReminder(row!)
}

export async function deleteCheckinReminder(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM checkin_reminders WHERE id = ?', [id])
  return null
}

// ─── Scribbles ────────────────────────────────────────────────────────────────

export async function getScribbles(db: DbAdapter): Promise<Scribble[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM scribbles ORDER BY updated_at DESC',
  )
  return rows.map(parseScribble)
}

export async function getScribblesForDate(db: DbAdapter, date: string): Promise<Scribble[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM scribbles WHERE updated_at LIKE ? ORDER BY updated_at DESC',
    [`${date}%`],
  )
  return rows.map(parseScribble)
}

export async function createScribble(
  db: DbAdapter,
  payload: Omit<Scribble, 'id' | 'created_at' | 'updated_at'>,
): Promise<Scribble> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.exec(
    `INSERT INTO scribbles (id, title, content, tags, annotations, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id,
      payload.title ?? '',
      payload.content ?? '',
      JSON.stringify(payload.tags ?? []),
      JSON.stringify(payload.annotations ?? {}),
      now,
      now,
    ],
  )
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM scribbles WHERE id = ?', [
    id,
  ])
  return parseScribble(row!)
}

export async function updateScribble(
  db: DbAdapter,
  payload: Partial<Scribble> & { id: string },
): Promise<Scribble> {
  const { id, ...fields } = payload
  const pairs: [string, unknown][] = [['updated_at', new Date().toISOString()]]
  pairs.push(
    ...buildUpdatePairs(fields as Record<string, unknown>, [
      { kind: 'nullable', name: 'title', fallback: '' },
      { kind: 'nullable', name: 'content', fallback: '' },
      { kind: 'json', name: 'tags', fallback: [] },
      { kind: 'json', name: 'annotations', fallback: {} },
    ]),
  )
  await execDynamicUpdate(db, 'scribbles', id, pairs)
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM scribbles WHERE id = ?', [
    id,
  ])
  return parseScribble(row!)
}

export async function deleteScribble(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM scribbles WHERE id = ?', [id])
  return null
}

export async function deleteAllScribbles(db: DbAdapter): Promise<null> {
  await db.exec('DELETE FROM scribbles')
  return null
}

export async function getRecentSharedScribbles(
  db: DbAdapter,
  daysBack: number = 7,
): Promise<Scribble[]> {
  const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString()
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT * FROM scribbles
     WHERE tags LIKE '%"shared/%' AND created_at >= ?
     ORDER BY created_at DESC`,
    [cutoff],
  )
  return rows.map(parseScribble)
}

// ─── Reminders ────────────────────────────────────────────────────────────────

export async function getAllReminders(db: DbAdapter): Promise<Reminder[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM reminders ORDER BY trigger_time ASC',
  )
  return rows.map(parseReminder)
}

export async function getRemindersForHabit(db: DbAdapter, habit_id: string): Promise<Reminder[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM reminders WHERE habit_id = ? ORDER BY trigger_time ASC',
    [habit_id],
  )
  return rows.map(parseReminder)
}

export async function createReminder(
  db: DbAdapter,
  habit_id: string,
  trigger_time: string,
  days_active: number[] | null,
): Promise<Reminder> {
  const id = crypto.randomUUID()
  await db.exec(
    'INSERT INTO reminders (id, habit_id, trigger_time, days_active) VALUES (?,?,?,?)',
    [id, habit_id, trigger_time, days_active == null ? null : JSON.stringify(days_active)],
  )
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM reminders WHERE id = ?', [
    id,
  ])
  return parseReminder(row!)
}

export async function deleteReminder(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM reminders WHERE id = ?', [id])
  return null
}

// ─── Bored categories ─────────────────────────────────────────────────────────

export async function getBoredCategories(db: DbAdapter): Promise<BoredCategory[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM bored_categories ORDER BY is_system DESC, sort_order ASC, created_at ASC',
  )
  return rows.map(parseBoredCategory)
}

export async function createBoredCategory(
  db: DbAdapter,
  payload: Omit<BoredCategory, 'id' | 'created_at'>,
): Promise<BoredCategory> {
  const id = crypto.randomUUID()
  const created_at = new Date().toISOString()
  await db.exec(
    'INSERT INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
    [
      id,
      payload.name,
      payload.icon,
      payload.color,
      payload.is_system ? 1 : 0,
      payload.sort_order,
      created_at,
    ],
  )
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM bored_categories WHERE id = ?',
    [id],
  )
  return parseBoredCategory(row!)
}

export async function updateBoredCategory(
  db: DbAdapter,
  payload: Partial<BoredCategory> & { id: string },
): Promise<BoredCategory> {
  const { id, ...fields } = payload
  const pairs = buildUpdatePairs(fields as Record<string, unknown>, [
    { kind: 'scalar', name: 'name' },
    { kind: 'scalar', name: 'icon' },
    { kind: 'scalar', name: 'color' },
    { kind: 'scalar', name: 'sort_order' },
  ])
  await execDynamicUpdate(db, 'bored_categories', id, pairs)
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM bored_categories WHERE id = ?',
    [id],
  )
  return parseBoredCategory(row!)
}

export async function deleteBoredCategory(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM bored_categories WHERE id = ? AND is_system = 0', [id])
  return null
}

// ─── Bored activities ─────────────────────────────────────────────────────────

export async function getBoredActivities(db: DbAdapter): Promise<BoredActivity[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM bored_activities WHERE archived_at IS NULL ORDER BY created_at ASC',
  )
  return rows.map(parseBoredActivity)
}

export async function getBoredActivitiesForCategory(
  db: DbAdapter,
  category_id: string,
): Promise<BoredActivity[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM bored_activities WHERE category_id = ? AND archived_at IS NULL ORDER BY created_at ASC',
    [category_id],
  )
  return rows.map(parseBoredActivity)
}

export async function createBoredActivity(
  db: DbAdapter,
  payload: Omit<
    BoredActivity,
    'id' | 'created_at' | 'is_done' | 'done_at' | 'done_count' | 'last_done_at' | 'archived_at'
  >,
): Promise<BoredActivity> {
  const id = crypto.randomUUID()
  const created_at = new Date().toISOString()
  await db.exec(
    `INSERT INTO bored_activities
     (id,title,description,category_id,estimated_minutes,tags,annotations,is_recurring,recurrence_rule,is_done,done_count,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,0,0,?)`,
    [
      id,
      payload.title,
      payload.description,
      payload.category_id,
      payload.estimated_minutes ?? null,
      JSON.stringify(payload.tags ?? []),
      JSON.stringify(payload.annotations ?? {}),
      payload.is_recurring ? 1 : 0,
      payload.recurrence_rule ?? null,
      created_at,
    ],
  )
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM bored_activities WHERE id = ?',
    [id],
  )
  return parseBoredActivity(row!)
}

export async function updateBoredActivity(
  db: DbAdapter,
  payload: Partial<BoredActivity> & { id: string },
): Promise<BoredActivity> {
  const { id, ...fields } = payload
  const pairs = buildUpdatePairs(fields as Record<string, unknown>, [
    { kind: 'nullable', name: 'title' },
    { kind: 'nullable', name: 'description' },
    { kind: 'nullable', name: 'category_id' },
    { kind: 'nullable', name: 'estimated_minutes' },
    { kind: 'nullable', name: 'recurrence_rule' },
    { kind: 'bool', name: 'is_recurring' },
    { kind: 'json', name: 'tags', fallback: [] },
    { kind: 'json', name: 'annotations', fallback: {} },
  ])
  await execDynamicUpdate(db, 'bored_activities', id, pairs)
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM bored_activities WHERE id = ?',
    [id],
  )
  return parseBoredActivity(row!)
}

export async function deleteBoredActivity(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM bored_activities WHERE id = ?', [id])
  return null
}

export async function archiveBoredActivity(db: DbAdapter, id: string): Promise<null> {
  await db.exec('UPDATE bored_activities SET archived_at = ? WHERE id = ?', [
    new Date().toISOString(),
    id,
  ])
  return null
}

export async function markBoredActivityDone(db: DbAdapter, id: string): Promise<BoredActivity> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM bored_activities WHERE id = ?',
    [id],
  )
  if (rows.length === 0) throw new Error(`BoredActivity not found: ${id}`)
  const activity = parseBoredActivity(rows[0]!)
  const now = new Date().toISOString()
  if (activity.is_recurring) {
    await db.exec(
      'UPDATE bored_activities SET done_count = done_count + 1, last_done_at = ? WHERE id = ?',
      [now, id],
    )
  } else {
    await db.exec(
      'UPDATE bored_activities SET is_done = 1, done_at = ?, done_count = done_count + 1, last_done_at = ? WHERE id = ?',
      [now, now, id],
    )
  }
  const rows2 = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM bored_activities WHERE id = ?',
    [id],
  )
  return parseBoredActivity(rows2[0]!)
}

export async function getBoredOracle(
  db: DbAdapter,
  excludedCategoryIds: string[],
  maxMinutes: number | null,
): Promise<BoredOracleResult | null> {
  const activityRows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM bored_activities WHERE archived_at IS NULL AND (is_done = 0 OR is_recurring = 1)',
  )
  const activities = activityRows.map(parseBoredActivity).filter((a) => {
    if (excludedCategoryIds.includes(a.category_id)) return false
    if (maxMinutes != null && a.estimated_minutes != null && a.estimated_minutes > maxMinutes)
      return false
    return true
  })

  const todoRows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM todos WHERE show_in_bored = 1 AND is_done = 0 AND archived_at IS NULL',
  )
  const todos = todoRows.map(parseTodo).filter((t) => {
    if (t.bored_category_id && excludedCategoryIds.includes(t.bored_category_id)) return false
    if (maxMinutes != null && t.estimated_minutes != null && t.estimated_minutes > maxMinutes)
      return false
    return true
  })

  const categories = new Map((await getBoredCategories(db)).map((c) => [c.id, c]))
  const pool: BoredOracleResult[] = []
  for (const activity of activities) {
    const category = categories.get(activity.category_id)
    if (category) pool.push({ source: 'activity', activity, category })
  }
  for (const todo of todos) {
    const category = todo.bored_category_id
      ? (categories.get(todo.bored_category_id) ?? null)
      : null
    pool.push({ source: 'todo', todo, category })
  }

  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)]!
}

export async function deleteAllBoredData(db: DbAdapter): Promise<null> {
  await db.exec('DELETE FROM bored_activities')
  await db.exec(
    'UPDATE todos SET show_in_bored = 0, bored_category_id = NULL WHERE bored_category_id IN (SELECT id FROM bored_categories WHERE is_system = 0)',
  )
  await db.exec('DELETE FROM bored_categories WHERE is_system = 0')
  return null
}

// ─── Todos ────────────────────────────────────────────────────────────────────

export async function getTodos(db: DbAdapter): Promise<Todo[]> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM todos WHERE archived_at IS NULL ORDER BY created_at ASC',
  )
  return rows.map(parseTodo)
}

export async function createTodo(
  db: DbAdapter,
  payload: Omit<
    Todo,
    | 'id'
    | 'created_at'
    | 'updated_at'
    | 'is_done'
    | 'done_at'
    | 'done_count'
    | 'last_done_at'
    | 'archived_at'
  >,
): Promise<Todo> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.exec(
    `INSERT INTO todos
     (id,title,description,due_date,priority,estimated_minutes,is_done,done_count,
      tags,annotations,is_recurring,recurrence_rule,show_in_bored,bored_category_id,
      created_at,updated_at)
     VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,?)`,
    [
      id,
      payload.title,
      payload.description,
      payload.due_date ?? null,
      payload.priority ?? 'medium',
      payload.estimated_minutes ?? null,
      JSON.stringify(payload.tags ?? []),
      JSON.stringify(payload.annotations ?? {}),
      payload.is_recurring ? 1 : 0,
      payload.recurrence_rule ?? null,
      payload.show_in_bored ? 1 : 0,
      payload.bored_category_id ?? null,
      now,
      now,
    ],
  )
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM todos WHERE id = ?', [id])
  return parseTodo(row!)
}

export async function updateTodo(
  db: DbAdapter,
  payload: Partial<Todo> & { id: string },
): Promise<Todo> {
  const { id, ...fields } = payload
  const pairs = buildUpdatePairs(fields as Record<string, unknown>, [
    { kind: 'nullable', name: 'title' },
    { kind: 'nullable', name: 'description' },
    { kind: 'nullable', name: 'due_date' },
    { kind: 'nullable', name: 'priority' },
    { kind: 'nullable', name: 'estimated_minutes' },
    { kind: 'nullable', name: 'recurrence_rule' },
    { kind: 'nullable', name: 'bored_category_id' },
    { kind: 'bool', name: 'is_recurring' },
    { kind: 'bool', name: 'show_in_bored' },
    { kind: 'json', name: 'tags', fallback: [] },
    { kind: 'json', name: 'annotations', fallback: {} },
  ])
  if (pairs.length > 0) {
    pairs.push(['updated_at', new Date().toISOString()])
  }
  await execDynamicUpdate(db, 'todos', id, pairs)
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM todos WHERE id = ?', [id])
  return parseTodo(row!)
}

export async function deleteTodo(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM todos WHERE id = ?', [id])
  return null
}

export async function archiveTodo(db: DbAdapter, id: string): Promise<null> {
  const now = new Date().toISOString()
  await db.exec('UPDATE todos SET archived_at = ?, updated_at = ? WHERE id = ?', [now, now, id])
  return null
}

export function calculateNextDue(fromDate: string, rule: string): string {
  const d = new Date(`${fromDate}T12:00:00`)
  if (rule === 'daily') d.setDate(d.getDate() + 1)
  else if (rule === 'weekly') d.setDate(d.getDate() + 7)
  else if (rule === 'monthly') d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function toggleTodo(db: DbAdapter, id: string): Promise<Todo> {
  const rows = await db.queryAll<Record<string, unknown>>('SELECT * FROM todos WHERE id = ?', [id])
  if (rows.length === 0) throw new Error(`Todo not found: ${id}`)
  const todo = parseTodo(rows[0]!)
  const now = new Date().toISOString()
  if (!todo.is_done && todo.is_recurring && todo.due_date) {
    const nextDue = calculateNextDue(todo.due_date, todo.recurrence_rule ?? 'daily')
    await db.exec(
      'UPDATE todos SET due_date = ?, done_count = done_count + 1, last_done_at = ?, updated_at = ? WHERE id = ?',
      [nextDue, now, now, id],
    )
  } else if (todo.is_done) {
    await db.exec('UPDATE todos SET is_done = 0, done_at = NULL, updated_at = ? WHERE id = ?', [
      now,
      id,
    ])
  } else {
    await db.exec(
      'UPDATE todos SET is_done = 1, done_at = ?, done_count = done_count + 1, last_done_at = ?, updated_at = ? WHERE id = ?',
      [now, now, now, id],
    )
  }
  const rows2 = await db.queryAll<Record<string, unknown>>('SELECT * FROM todos WHERE id = ?', [id])
  return parseTodo(rows2[0]!)
}

export async function deleteAllTodos(db: DbAdapter): Promise<null> {
  await db.exec('DELETE FROM todos')
  return null
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export async function isDefaultApplied(db: DbAdapter, key: string): Promise<boolean> {
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT 1 FROM applied_defaults WHERE key = ?',
    [key],
  )
  return rows.length > 0
}

// App-level default flags (e.g. check-in template seeding). Distinct from
// Palladium's _palladium_seeds which tracks SchemaConfig seeds.
export async function markDefaultApplied(db: DbAdapter, key: string): Promise<null> {
  await db.exec('INSERT OR IGNORE INTO applied_defaults (key, applied_at) VALUES (?, ?)', [
    key,
    new Date().toISOString(),
  ])
  return null
}

export async function clearAppliedDefaults(db: DbAdapter): Promise<null> {
  await db.exec('DELETE FROM applied_defaults')
  await db.exec('DELETE FROM _palladium_seeds')
  return null
}

export async function integrityCheck(db: DbAdapter): Promise<string[]> {
  const rows = await db.queryAll<Record<string, unknown>>('PRAGMA integrity_check')
  return rows.map((r) => String(r['integrity_check'] ?? ''))
}

export async function getDbInfo(db: DbAdapter): Promise<{
  userVersion: number
  tables: Array<{ name: string; sql: string }>
  indices: Array<{ name: string; tbl_name: string; sql: string }>
}> {
  const versionRows = await db.queryAll<Record<string, unknown>>('PRAGMA user_version')
  const userVersion = (versionRows[0]?.['user_version'] as number) ?? 0
  const tableRows = await db.queryAll<Record<string, unknown>>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name",
  )
  const indexRows = await db.queryAll<Record<string, unknown>>(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name, name",
  )
  return {
    userVersion,
    tables: tableRows.map((r) => ({ name: String(r['name']), sql: String(r['sql'] ?? '') })),
    indices: indexRows.map((r) => ({
      name: String(r['name']),
      tbl_name: String(r['tbl_name']),
      sql: String(r['sql'] ?? ''),
    })),
  }
}

export async function getContextTags(db: DbAdapter): Promise<string[]> {
  const rows = await db.queryAll<Record<string, unknown>>(`
    WITH
      ht AS (SELECT t.value AS tag, MAX(h.created_at) AS latest FROM habits h, json_each(h.tags) t WHERE h.archived_at IS NULL GROUP BY t.value),
      tt AS (SELECT t.value AS tag, MAX(td.created_at) AS latest FROM todos td, json_each(td.tags) t WHERE td.archived_at IS NULL GROUP BY t.value),
      bt AS (SELECT t.value AS tag, MAX(b.created_at) AS latest FROM bored_activities b, json_each(b.tags) t WHERE b.archived_at IS NULL GROUP BY t.value),
      all_tags AS (SELECT tag, 'h' AS src, latest FROM ht UNION ALL SELECT tag, 't' AS src, latest FROM tt UNION ALL SELECT tag, 'b' AS src, latest FROM bt)
    SELECT tag FROM (SELECT tag, COUNT(DISTINCT src) AS cnt, MAX(latest) AS recent FROM all_tags GROUP BY tag HAVING cnt >= 2 AND tag NOT LIKE 'habitat-%') ORDER BY recent DESC LIMIT 6
  `)
  return rows.map((r) => String(r['tag']))
}

export async function getAllTags(db: DbAdapter): Promise<TagRow[]> {
  const rows = await db.queryAll<Record<string, unknown>>(`
    WITH
      ht AS (SELECT t.value AS tag, 'habit' AS src, COUNT(*) AS cnt FROM habits h, json_each(h.tags) t WHERE h.archived_at IS NULL GROUP BY t.value),
      tt AS (SELECT t.value AS tag, 'todo' AS src, COUNT(*) AS cnt FROM todos td, json_each(td.tags) t WHERE td.archived_at IS NULL GROUP BY t.value),
      bt AS (SELECT t.value AS tag, 'bored' AS src, COUNT(*) AS cnt FROM bored_activities b, json_each(b.tags) t WHERE b.archived_at IS NULL GROUP BY t.value),
      st AS (SELECT t.value AS tag, 'scribble' AS src, COUNT(*) AS cnt FROM scribbles s, json_each(s.tags) t GROUP BY t.value)
    SELECT tag, src, cnt FROM ht
    UNION ALL SELECT tag, src, cnt FROM tt
    UNION ALL SELECT tag, src, cnt FROM bt
    UNION ALL SELECT tag, src, cnt FROM st
  `)
  return rows.map((r) => ({
    tag: String(r['tag']),
    source: String(r['src']) as TagSource,
    count: Number(r['cnt']),
  }))
}

export async function searchGlobal(db: DbAdapter, query: string): Promise<SearchResult[]> {
  const q = `%${query.toLowerCase()}%`
  const results: SearchResult[] = []

  const habits = await db.queryAll<Record<string, unknown>>(
    'SELECT id, name, icon, color, archived_at FROM habits WHERE lower(name) LIKE ? OR lower(description) LIKE ? ORDER BY name ASC LIMIT 10',
    [q, q],
  )
  for (const r of habits) {
    results.push({
      kind: 'habit',
      id: r['id'] as string,
      name: r['name'] as string,
      icon: r['icon'] as string,
      color: r['color'] as string,
      archived: r['archived_at'] != null,
    })
  }

  const todos = await db.queryAll<Record<string, unknown>>(
    'SELECT id, title, is_done FROM todos WHERE archived_at IS NULL AND (lower(title) LIKE ? OR lower(description) LIKE ?) ORDER BY title ASC LIMIT 10',
    [q, q],
  )
  for (const r of todos) {
    results.push({
      kind: 'todo',
      id: r['id'] as string,
      title: r['title'] as string,
      is_done: Boolean(r['is_done']),
    })
  }

  const scribbles = await db.queryAll<Record<string, unknown>>(
    'SELECT id, title, content FROM scribbles WHERE lower(title) LIKE ? OR lower(content) LIKE ? ORDER BY updated_at DESC LIMIT 10',
    [q, q],
  )
  for (const r of scribbles) {
    const content = String(r['content'] ?? '')
    results.push({
      kind: 'scribble',
      id: r['id'] as string,
      title: String(r['title'] ?? '').slice(0, 60) || content.slice(0, 60),
      preview: content.slice(0, 80),
    })
  }

  const checkins = await db.queryAll<Record<string, unknown>>(
    'SELECT id, title FROM checkin_templates WHERE lower(title) LIKE ? ORDER BY title ASC LIMIT 5',
    [q],
  )
  for (const r of checkins) {
    results.push({ kind: 'checkin', id: r['id'] as string, title: r['title'] as string })
  }

  return results
}

// ─── Export / Import ──────────────────────────────────────────────────────────

export async function exportJsonData(db: DbAdapter, sel: ExportSelection): Promise<HabitatExport> {
  const habits = sel.habits
    ? (
        await db.queryAll<Record<string, unknown>>('SELECT * FROM habits ORDER BY created_at ASC')
      ).map(parseHabit)
    : []
  const completions = sel.completions ? await getAllCompletions(db) : []
  const habit_logs = sel.habit_logs
    ? (
        await db.queryAll<Record<string, unknown>>(
          'SELECT * FROM habit_logs ORDER BY logged_at ASC',
        )
      ).map(parseHabitLog)
    : []
  const habit_schedules = sel.habit_schedules
    ? (await db.queryAll<Record<string, unknown>>('SELECT * FROM habit_schedules')).map(
        parseHabitSchedule,
      )
    : []
  const reminders = sel.reminders ? await getAllReminders(db) : []
  const checkin_templates = sel.checkin_templates ? await getCheckinTemplates(db) : []
  const checkin_questions = sel.checkin_questions
    ? (
        await db.queryAll<Record<string, unknown>>(
          'SELECT * FROM checkin_questions ORDER BY template_id, display_order',
        )
      ).map(parseCheckinQuestion)
    : []
  const checkin_responses = sel.checkin_responses
    ? (
        await db.queryAll<Record<string, unknown>>(
          'SELECT * FROM checkin_responses ORDER BY logged_date ASC',
        )
      ).map(parseCheckinResponse)
    : []
  const checkin_reminders = sel.checkin_reminders ? await getAllCheckinReminders(db) : []
  const scribbles = sel.scribbles ? await getScribbles(db) : []
  const checkin_entries = sel.checkin_entries
    ? (
        await db.queryAll<Record<string, unknown>>(
          'SELECT * FROM checkin_entries ORDER BY entry_date ASC',
        )
      ).map(parseCheckinEntry)
    : []
  const bored_categories = sel.bored_categories
    ? (
        await db.queryAll<Record<string, unknown>>(
          'SELECT * FROM bored_categories ORDER BY sort_order ASC',
        )
      ).map(parseBoredCategory)
    : []
  const bored_activities = sel.bored_activities
    ? (
        await db.queryAll<Record<string, unknown>>(
          'SELECT * FROM bored_activities ORDER BY created_at ASC',
        )
      ).map(parseBoredActivity)
    : []
  const todos = sel.todos
    ? (
        await db.queryAll<Record<string, unknown>>('SELECT * FROM todos ORDER BY created_at ASC')
      ).map(parseTodo)
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
    bored_categories,
    bored_activities,
    todos,
  }
}

export async function importJson(db: DbAdapter, data: HabitatExport): Promise<null> {
  if (data.version !== 1)
    throw new Error(`Unsupported export version: ${String((data as { version: unknown }).version)}`)
  await db.exec('BEGIN')
  try {
    for (const h of data.habits ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO habits
         (id,name,description,why,color,icon,frequency,created_at,archived_at,tags,annotations,type,target_value,paused_until)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          h.id,
          h.name,
          h.description,
          h.why ?? '',
          h.color,
          h.icon,
          h.frequency,
          h.created_at,
          h.archived_at ?? null,
          JSON.stringify(h.tags ?? []),
          JSON.stringify(h.annotations ?? {}),
          h.type ?? 'BOOLEAN',
          h.target_value ?? 1,
          h.paused_until ?? null,
        ],
      )
    }
    for (const c of data.completions ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO completions (id,habit_id,date,completed_at,notes,tags,annotations) VALUES (?,?,?,?,?,?,?)',
        [
          c.id,
          c.habit_id,
          c.date,
          c.completed_at,
          c.notes ?? '',
          JSON.stringify(c.tags ?? []),
          JSON.stringify(c.annotations ?? {}),
        ],
      )
    }
    for (const l of data.habit_logs ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO habit_logs (id,habit_id,date,logged_at,value,notes) VALUES (?,?,?,?,?,?)',
        [l.id, l.habit_id, l.date, l.logged_at, l.value, l.notes ?? ''],
      )
    }
    for (const s of data.habit_schedules ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO habit_schedules (id,habit_id,schedule_type,frequency_count,days_of_week,due_time,start_date,end_date) VALUES (?,?,?,?,?,?,?,?)',
        [
          s.id,
          s.habit_id,
          s.schedule_type ?? 'DAILY',
          s.frequency_count ?? null,
          s.days_of_week == null ? null : JSON.stringify(s.days_of_week),
          s.due_time ?? null,
          s.start_date ?? null,
          s.end_date ?? null,
        ],
      )
    }
    for (const r of data.reminders ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO reminders (id,habit_id,trigger_time,days_active) VALUES (?,?,?,?)',
        [
          r.id,
          r.habit_id,
          r.trigger_time,
          r.days_active == null ? null : JSON.stringify(r.days_active),
        ],
      )
    }
    for (const t of data.checkin_templates ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO checkin_templates (id,title,schedule_type,days_active) VALUES (?,?,?,?)',
        [
          t.id,
          t.title,
          t.schedule_type ?? 'DAILY',
          t.days_active == null ? null : JSON.stringify(t.days_active),
        ],
      )
    }
    for (const q of data.checkin_questions ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO checkin_questions (id,template_id,prompt,response_type,display_order,desired_answer) VALUES (?,?,?,?,?,?)',
        [
          q.id,
          q.template_id,
          q.prompt,
          q.response_type ?? 'TEXT',
          q.display_order ?? 0,
          q.desired_answer ?? 1,
        ],
      )
    }
    for (const r of data.checkin_responses ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO checkin_responses (id,question_id,logged_date,value_numeric,value_text) VALUES (?,?,?,?,?)',
        [r.id, r.question_id, r.logged_date, r.value_numeric ?? null, r.value_text ?? null],
      )
    }
    for (const r of data.checkin_reminders ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO checkin_reminders (id,template_id,trigger_time,days_active) VALUES (?,?,?,?)',
        [
          r.id,
          r.template_id,
          r.trigger_time,
          r.days_active == null ? null : JSON.stringify(r.days_active),
        ],
      )
    }
    for (const s of data.scribbles ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO scribbles (id,title,content,tags,annotations,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        [
          s.id,
          s.title ?? '',
          s.content ?? '',
          JSON.stringify(s.tags ?? []),
          JSON.stringify(s.annotations ?? {}),
          s.created_at,
          s.updated_at,
        ],
      )
    }
    for (const e of data.checkin_entries ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO checkin_entries (id,entry_date,content,created_at,updated_at) VALUES (?,?,?,?,?)',
        [e.id, e.entry_date, e.content ?? '', e.created_at, e.updated_at],
      )
    }
    for (const c of data.bored_categories ?? []) {
      await db.exec(
        'INSERT OR IGNORE INTO bored_categories (id,name,icon,color,is_system,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
        [c.id, c.name, c.icon, c.color, c.is_system ? 1 : 0, c.sort_order, c.created_at],
      )
    }
    for (const a of data.bored_activities ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO bored_activities
         (id,title,description,category_id,estimated_minutes,tags,annotations,
          is_recurring,recurrence_rule,is_done,done_at,done_count,last_done_at,archived_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          a.id,
          a.title,
          a.description,
          a.category_id,
          a.estimated_minutes ?? null,
          JSON.stringify(a.tags ?? []),
          JSON.stringify(a.annotations ?? {}),
          a.is_recurring ? 1 : 0,
          a.recurrence_rule ?? null,
          a.is_done ? 1 : 0,
          a.done_at ?? null,
          a.done_count ?? 0,
          a.last_done_at ?? null,
          a.archived_at ?? null,
          a.created_at,
        ],
      )
    }
    for (const t of data.todos ?? []) {
      await db.exec(
        `INSERT OR IGNORE INTO todos
         (id,title,description,due_date,priority,estimated_minutes,is_done,done_at,
          done_count,last_done_at,tags,annotations,is_recurring,recurrence_rule,
          show_in_bored,bored_category_id,archived_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          t.id,
          t.title,
          t.description,
          t.due_date ?? null,
          t.priority ?? 'medium',
          t.estimated_minutes ?? null,
          t.is_done ? 1 : 0,
          t.done_at ?? null,
          t.done_count ?? 0,
          t.last_done_at ?? null,
          JSON.stringify(t.tags ?? []),
          JSON.stringify(t.annotations ?? {}),
          t.is_recurring ? 1 : 0,
          t.recurrence_rule ?? null,
          t.show_in_bored ? 1 : 0,
          t.bored_category_id ?? null,
          t.archived_at ?? null,
          t.created_at,
          t.updated_at,
        ],
      )
    }
    await db.exec('COMMIT')
    return null
  } catch (err) {
    await db.exec('ROLLBACK')
    throw err
  }
}

// ─── Shared dispatcher ─────────────────────────────────────────────────────────
// Maps WorkerRequestBody.type to the corresponding db-shared function.
// Worker-only ops (EXPORT_DB, NUKE_OPFS) are handled by the caller.

export async function dispatch(db: DbAdapter, req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    case 'GET_HABITS':
      return getHabits(db)
    case 'CREATE_HABIT':
      return createHabit(db, req.payload)
    case 'UPDATE_HABIT':
      return updateHabit(db, req.payload)
    case 'ARCHIVE_HABIT':
      return archiveHabit(db, req.payload.id)
    case 'DELETE_HABIT':
      return deleteHabit(db, req.payload.id)
    case 'GET_ARCHIVED_HABITS':
      return getArchivedHabits(db)
    case 'GET_COMPLETIONS_FOR_DATE':
      return getCompletionsForDate(db, req.payload.date)
    case 'GET_COMPLETIONS_FOR_HABIT':
      return getCompletionsForHabit(db, req.payload.habit_id, req.payload.from, req.payload.to)
    case 'GET_COMPLETIONS_FOR_DATE_RANGE':
      return getCompletionsForDateRange(db, req.payload.from, req.payload.to)
    case 'GET_ALL_COMPLETIONS':
      return getAllCompletions(db)
    case 'TOGGLE_COMPLETION':
      return toggleCompletion(
        db,
        req.payload.habit_id,
        req.payload.date,
        req.payload.tags,
        req.payload.annotations,
      )
    case 'GET_STREAK':
      return getStreak(db, req.payload.habit_id)
    case 'DELETE_ALL_HABITS':
      return deleteAllHabits(db)
    case 'PAUSE_HABIT':
      return pauseHabit(db, req.payload.id, req.payload.until)
    case 'PAUSE_ALL_HABITS':
      return pauseAllHabits(db, req.payload.until)
    case 'GET_HABIT_LOGS_FOR_DATE':
      return getHabitLogsForDate(db, req.payload.date)
    case 'GET_HABIT_LOGS_FOR_HABIT':
      return getHabitLogsForHabit(db, req.payload.habit_id, req.payload.from, req.payload.to)
    case 'GET_HABIT_LOGS_FOR_DATE_RANGE':
      return getHabitLogsForDateRange(db, req.payload.from, req.payload.to)
    case 'LOG_HABIT_VALUE':
      return logHabitValue(
        db,
        req.payload.habit_id,
        req.payload.date,
        req.payload.value,
        req.payload.notes,
      )
    case 'DELETE_HABIT_LOG':
      return deleteHabitLog(db, req.payload.id)
    case 'GET_SCHEDULE_FOR_HABIT':
      return getScheduleForHabit(db, req.payload.habit_id)
    case 'UPDATE_HABIT_SCHEDULE':
      return updateHabitSchedule(db, req.payload)
    case 'GET_CHECKIN_ENTRY':
      return getCheckinEntry(db, req.payload.date)
    case 'UPSERT_CHECKIN_ENTRY':
      return upsertCheckinEntry(db, req.payload.date, req.payload.content)
    case 'DELETE_CHECKIN_ENTRY':
      return deleteCheckinEntry(db, req.payload.id)
    case 'GET_CHECKIN_ENTRIES':
      return getCheckinEntries(db, req.payload.from, req.payload.to)
    case 'DELETE_ALL_CHECKIN_ENTRIES':
      return deleteAllCheckinEntries(db)
    case 'GET_CHECKIN_TEMPLATES':
      return getCheckinTemplates(db)
    case 'GET_CHECKIN_TEMPLATE':
      return getCheckinTemplate(db, req.payload.id)
    case 'CREATE_CHECKIN_TEMPLATE':
      return createCheckinTemplate(db, req.payload)
    case 'UPDATE_CHECKIN_TEMPLATE':
      return updateCheckinTemplate(db, req.payload)
    case 'DELETE_CHECKIN_TEMPLATE':
      return deleteCheckinTemplate(db, req.payload.id)
    case 'DELETE_ALL_CHECKIN_DATA':
      return deleteAllCheckinData(db)
    case 'GET_CHECKIN_QUESTIONS':
      return getCheckinQuestions(db, req.payload.template_id)
    case 'CREATE_CHECKIN_QUESTION':
      return createCheckinQuestion(db, req.payload)
    case 'UPDATE_CHECKIN_QUESTION':
      return updateCheckinQuestion(db, req.payload)
    case 'DELETE_CHECKIN_QUESTION':
      return deleteCheckinQuestion(db, req.payload.id)
    case 'GET_CHECKIN_RESPONSES':
      return getCheckinResponses(db, req.payload.template_id, req.payload.date)
    case 'UPSERT_CHECKIN_RESPONSE':
      return upsertCheckinResponse(
        db,
        req.payload.question_id,
        req.payload.logged_date,
        req.payload.value_numeric,
        req.payload.value_text,
      )
    case 'DELETE_CHECKIN_RESPONSE':
      return deleteCheckinResponse(db, req.payload.id)
    case 'TOGGLE_CHECKIN_COMPLETION':
      return toggleCheckinCompletion(db, req.payload.template_id, req.payload.date)
    case 'GET_CHECKIN_COMPLETIONS_FOR_DATE':
      return getCheckinCompletionsForDate(db, req.payload.date)
    case 'GET_CHECKIN_RESPONSE_DATES':
      return getCheckinResponseDates(db)
    case 'GET_CHECKIN_HISTORY':
      return getCheckinHistory(db, req.payload.from, req.payload.to, req.payload.template_id)
    case 'GET_CHECKIN_SUMMARY_FOR_DATE':
      return getCheckinSummaryForDate(db, req.payload.date)
    case 'GET_SCRIBBLES':
      return getScribbles(db)
    case 'GET_SCRIBBLES_FOR_DATE':
      return getScribblesForDate(db, req.payload.date)
    case 'CREATE_SCRIBBLE':
      return createScribble(db, req.payload)
    case 'UPDATE_SCRIBBLE':
      return updateScribble(db, req.payload)
    case 'DELETE_SCRIBBLE':
      return deleteScribble(db, req.payload.id)
    case 'DELETE_ALL_SCRIBBLES':
      return deleteAllScribbles(db)
    case 'GET_RECENT_SHARED_SCRIBBLES':
      return getRecentSharedScribbles(db, req.payload.days_back)
    case 'GET_ALL_REMINDERS':
      return getAllReminders(db)
    case 'GET_REMINDERS_FOR_HABIT':
      return getRemindersForHabit(db, req.payload.habit_id)
    case 'CREATE_REMINDER':
      return createReminder(
        db,
        req.payload.habit_id,
        req.payload.trigger_time,
        req.payload.days_active,
      )
    case 'DELETE_REMINDER':
      return deleteReminder(db, req.payload.id)
    case 'GET_ALL_CHECKIN_REMINDERS':
      return getAllCheckinReminders(db)
    case 'GET_CHECKIN_REMINDERS_FOR_TEMPLATE':
      return getCheckinRemindersForTemplate(db, req.payload.template_id)
    case 'CREATE_CHECKIN_REMINDER':
      return createCheckinReminder(
        db,
        req.payload.template_id,
        req.payload.trigger_time,
        req.payload.days_active,
      )
    case 'DELETE_CHECKIN_REMINDER':
      return deleteCheckinReminder(db, req.payload.id)
    case 'IS_DEFAULT_APPLIED':
      return isDefaultApplied(db, req.payload.key)
    case 'MARK_DEFAULT_APPLIED':
      return markDefaultApplied(db, req.payload.key)
    case 'CLEAR_APPLIED_DEFAULTS':
      return clearAppliedDefaults(db)
    case 'GET_DB_INFO':
      return getDbInfo(db)
    case 'INTEGRITY_CHECK':
      return integrityCheck(db)
    case 'EXPORT_JSON_DATA':
      return exportJsonData(db, req.payload)
    case 'IMPORT_JSON':
      return importJson(db, req.payload)
    case 'GET_BORED_CATEGORIES':
      return getBoredCategories(db)
    case 'CREATE_BORED_CATEGORY':
      return createBoredCategory(db, req.payload)
    case 'UPDATE_BORED_CATEGORY':
      return updateBoredCategory(db, req.payload)
    case 'DELETE_BORED_CATEGORY':
      return deleteBoredCategory(db, req.payload.id)
    case 'GET_BORED_ACTIVITIES':
      return getBoredActivities(db)
    case 'GET_BORED_ACTIVITIES_FOR_CATEGORY':
      return getBoredActivitiesForCategory(db, req.payload.category_id)
    case 'CREATE_BORED_ACTIVITY':
      return createBoredActivity(db, req.payload)
    case 'UPDATE_BORED_ACTIVITY':
      return updateBoredActivity(db, req.payload)
    case 'DELETE_BORED_ACTIVITY':
      return deleteBoredActivity(db, req.payload.id)
    case 'ARCHIVE_BORED_ACTIVITY':
      return archiveBoredActivity(db, req.payload.id)
    case 'MARK_BORED_ACTIVITY_DONE':
      return markBoredActivityDone(db, req.payload.id)
    case 'GET_BORED_ORACLE':
      return getBoredOracle(db, req.payload.excluded_category_ids, req.payload.max_minutes)
    case 'DELETE_ALL_BORED_DATA':
      return deleteAllBoredData(db)
    case 'GET_TODOS':
      return getTodos(db)
    case 'CREATE_TODO':
      return createTodo(db, req.payload)
    case 'UPDATE_TODO':
      return updateTodo(db, req.payload)
    case 'DELETE_TODO':
      return deleteTodo(db, req.payload.id)
    case 'ARCHIVE_TODO':
      return archiveTodo(db, req.payload.id)
    case 'TOGGLE_TODO':
      return toggleTodo(db, req.payload.id)
    case 'DELETE_ALL_TODOS':
      return deleteAllTodos(db)
    case 'GET_CONTEXT_TAGS':
      return getContextTags(db)
    case 'GET_ALL_TAGS':
      return getAllTags(db)
    case 'SEARCH_GLOBAL':
      return searchGlobal(db, req.payload.query)
    case 'GET_VOICE_NOTES':
      return getVoiceNotes(db)
    case 'CREATE_VOICE_NOTE':
      return createVoiceNote(db, req.payload)
    case 'UPDATE_VOICE_NOTE':
      return updateVoiceNote(db, req.payload.id, req.payload.title)
    case 'DELETE_VOICE_NOTE':
      return deleteVoiceNote(db, req.payload.id)
    case 'GET_IMAGE_NOTES':
      return getImageNotes(db)
    case 'CREATE_IMAGE_NOTE':
      return createImageNote(db, req.payload)
    case 'UPDATE_IMAGE_NOTE':
      return updateImageNote(db, req.payload.id, req.payload.filename)
    case 'DELETE_IMAGE_NOTE':
      return deleteImageNote(db, req.payload.id)
    case 'DELETE_ALL_MEDIA_NOTES':
      return deleteAllMediaNotes(db)
    default:
      return undefined
  }
}

// ─── Voice / Image notes (metadata only — binary data lives in IDBBlobAdapter) ──

async function getVoiceNotes(db: DbAdapter): Promise<VoiceNoteRow[]> {
  return db.queryAll<VoiceNoteRow>('SELECT * FROM voice_notes ORDER BY created_at DESC')
}

async function createVoiceNote(db: DbAdapter, p: VoiceNoteRow): Promise<VoiceNoteRow> {
  await db.exec(
    'INSERT OR IGNORE INTO voice_notes (id, title, mime_type, duration, created_at) VALUES (?, ?, ?, ?, ?)',
    [p.id, p.title ?? '', p.mime_type, p.duration, p.created_at],
  )
  return { ...p, title: p.title ?? '' }
}

async function updateVoiceNote(db: DbAdapter, id: string, title: string): Promise<null> {
  await db.exec('UPDATE voice_notes SET title = ? WHERE id = ?', [title, id])
  return null
}

async function deleteVoiceNote(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM voice_notes WHERE id = ?', [id])
  return null
}

async function getImageNotes(db: DbAdapter): Promise<ImageNoteRow[]> {
  return db.queryAll<ImageNoteRow>('SELECT * FROM image_notes ORDER BY created_at DESC')
}

async function createImageNote(db: DbAdapter, p: ImageNoteRow): Promise<ImageNoteRow> {
  await db.exec(
    'INSERT OR IGNORE INTO image_notes (id, mime_type, filename, created_at) VALUES (?, ?, ?, ?)',
    [p.id, p.mime_type, p.filename, p.created_at],
  )
  return p
}

async function updateImageNote(db: DbAdapter, id: string, filename: string): Promise<null> {
  await db.exec('UPDATE image_notes SET filename = ? WHERE id = ?', [filename, id])
  return null
}

async function deleteImageNote(db: DbAdapter, id: string): Promise<null> {
  await db.exec('DELETE FROM image_notes WHERE id = ?', [id])
  return null
}

async function deleteAllMediaNotes(db: DbAdapter): Promise<null> {
  await db.exec('DELETE FROM voice_notes')
  await db.exec('DELETE FROM image_notes')
  return null
}
