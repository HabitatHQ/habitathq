/**
 * Shared row-to-type parser functions used by both database.worker.ts (WASM)
 * and db-native.ts (Capacitor SQLite). Every parser is a pure function that
 * maps a raw `Record<string, unknown>` DB row to a typed domain object.
 */
/**
 * Parse a JSON string from a DB column, returning `fallback` on null, undefined,
 * a JSON-null value (`"null"`), or a parse error.
 */
export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (str == null) return fallback
  try {
    const parsed = JSON.parse(str) as T
    return parsed ?? fallback
  } catch {
    console.warn('[db] JSON.parse failed for column value:', str)
    return fallback
  }
}

import type {
  BoredActivity,
  BoredCategory,
  CheckinEntry,
  CheckinQuestion,
  CheckinReminder,
  CheckinResponse,
  CheckinTemplate,
  Completion,
  Habit,
  HabitLog,
  HabitSchedule,
  HabitWithSchedule,
  Reminder,
  Scribble,
  Todo,
} from '~/types/database'
// ─── Shared SQL ───────────────────────────────────────────────────────────────

export const HABIT_WITH_SCHED_SQL = `
  SELECT h.*, hs.id as sched_id, hs.schedule_type, hs.frequency_count,
         hs.days_of_week, hs.due_time, hs.start_date, hs.end_date
  FROM habits h
  LEFT JOIN habit_schedules hs ON hs.habit_id = h.id`

// ─── Parsers ──────────────────────────────────────────────────────────────────

export function parseHabit(row: Record<string, unknown>): Habit {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: row['description'] as string,
    why: (row['why'] as string) ?? '',
    color: row['color'] as string,
    icon: row['icon'] as string,
    frequency: row['frequency'] as string,
    created_at: row['created_at'] as string,
    archived_at: row['archived_at'] as string | null,
    tags: safeJsonParse(row['tags'] as string | null, []),
    annotations: safeJsonParse(row['annotations'] as string | null, {}),
    type: ((row['type'] as string) ?? 'BOOLEAN') as 'BOOLEAN' | 'NUMERIC' | 'LIMIT',
    target_value: (row['target_value'] as number) ?? 1,
    paused_until: row['paused_until'] as string | null,
  }
}

export function parseHabitWithSchedule(row: Record<string, unknown>): HabitWithSchedule {
  const habit = parseHabit(row)
  const schedId = row['sched_id'] as string | null
  if (!schedId) return { ...habit, schedule: null }
  return {
    ...habit,
    schedule: {
      id: schedId,
      habit_id: habit.id,
      schedule_type: ((row['schedule_type'] as string) ?? 'DAILY') as
        | 'DAILY'
        | 'WEEKLY_FLEX'
        | 'SPECIFIC_DAYS',
      frequency_count: row['frequency_count'] as number | null,
      days_of_week: safeJsonParse(row['days_of_week'] as string | null, null),
      due_time: row['due_time'] as string | null,
      start_date: row['start_date'] as string | null,
      end_date: row['end_date'] as string | null,
    },
  }
}

export function parseHabitSchedule(row: Record<string, unknown>): HabitSchedule {
  return {
    id: row['id'] as string,
    habit_id: row['habit_id'] as string,
    schedule_type: ((row['schedule_type'] as string) ?? 'DAILY') as
      | 'DAILY'
      | 'WEEKLY_FLEX'
      | 'SPECIFIC_DAYS',
    frequency_count: row['frequency_count'] as number | null,
    days_of_week: safeJsonParse(row['days_of_week'] as string | null, null),
    due_time: row['due_time'] as string | null,
    start_date: row['start_date'] as string | null,
    end_date: row['end_date'] as string | null,
  }
}

export function parseHabitLog(row: Record<string, unknown>): HabitLog {
  return {
    id: row['id'] as string,
    habit_id: row['habit_id'] as string,
    date: row['date'] as string,
    logged_at: row['logged_at'] as string,
    value: row['value'] as number,
    notes: (row['notes'] as string) ?? '',
  }
}

export function parseCompletion(row: Record<string, unknown>): Completion {
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

export function parseCheckinEntry(row: Record<string, unknown>): CheckinEntry {
  return {
    id: row['id'] as string,
    entry_date: row['entry_date'] as string,
    content: (row['content'] as string) ?? '',
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  }
}

export function parseCheckinTemplate(row: Record<string, unknown>): CheckinTemplate {
  const result: CheckinTemplate = {
    id: row['id'] as string,
    title: row['title'] as string,
    schedule_type: ((row['schedule_type'] as string) ?? 'DAILY') as 'DAILY' | 'WEEKLY' | 'MONTHLY',
    days_active: safeJsonParse<number[] | null>(row['days_active'] as string | null, null),
    archived_at: (row['archived_at'] as string | null) ?? null,
  }
  if (row['response_day_count'] !== undefined) {
    result.response_day_count = row['response_day_count'] as number
  }
  if (row['question_count'] !== undefined) {
    result.question_count = row['question_count'] as number
  }
  return result
}

export function parseCheckinQuestion(row: Record<string, unknown>): CheckinQuestion {
  return {
    id: row['id'] as string,
    template_id: row['template_id'] as string,
    prompt: row['prompt'] as string,
    response_type: ((row['response_type'] as string) ?? 'TEXT') as 'SCALE' | 'TEXT' | 'BOOLEAN',
    display_order: (row['display_order'] as number) ?? 0,
    desired_answer: (row['desired_answer'] as number) ?? 1,
    archived_at: (row['archived_at'] as string | null) ?? null,
  }
}

export function parseCheckinResponse(row: Record<string, unknown>): CheckinResponse {
  return {
    id: row['id'] as string,
    question_id: row['question_id'] as string,
    logged_date: row['logged_date'] as string,
    value_numeric: row['value_numeric'] as number | null,
    value_text: row['value_text'] as string | null,
  }
}

export function parseScribble(row: Record<string, unknown>): Scribble {
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

export function parseReminder(row: Record<string, unknown>): Reminder {
  return {
    id: row['id'] as string,
    habit_id: row['habit_id'] as string,
    trigger_time: row['trigger_time'] as string,
    days_active: safeJsonParse(row['days_active'] as string | null, null),
  }
}

export function parseCheckinReminder(row: Record<string, unknown>): CheckinReminder {
  return {
    id: row['id'] as string,
    template_id: row['template_id'] as string,
    trigger_time: row['trigger_time'] as string,
    days_active: safeJsonParse(row['days_active'] as string | null, null),
  }
}

export function parseBoredCategory(row: Record<string, unknown>): BoredCategory {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    icon: row['icon'] as string,
    color: row['color'] as string,
    is_system: Boolean(row['is_system']),
    sort_order: (row['sort_order'] as number) ?? 0,
    created_at: row['created_at'] as string,
  }
}

export function parseBoredActivity(row: Record<string, unknown>): BoredActivity {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    description: (row['description'] as string) ?? '',
    category_id: row['category_id'] as string,
    estimated_minutes: row['estimated_minutes'] as number | null,
    tags: safeJsonParse(row['tags'] as string | null, []),
    annotations: safeJsonParse(row['annotations'] as string | null, {}),
    is_recurring: Boolean(row['is_recurring']),
    recurrence_rule: row['recurrence_rule'] as 'daily' | 'weekly' | 'monthly' | null,
    is_done: Boolean(row['is_done']),
    done_at: row['done_at'] as string | null,
    done_count: (row['done_count'] as number) ?? 0,
    last_done_at: row['last_done_at'] as string | null,
    archived_at: row['archived_at'] as string | null,
    created_at: row['created_at'] as string,
  }
}

export function parseTodo(row: Record<string, unknown>): Todo {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    description: (row['description'] as string) ?? '',
    due_date: row['due_date'] as string | null,
    priority: ((row['priority'] as string) ?? 'medium') as 'high' | 'medium' | 'low',
    estimated_minutes: row['estimated_minutes'] as number | null,
    is_done: Boolean(row['is_done']),
    done_at: row['done_at'] as string | null,
    done_count: (row['done_count'] as number) ?? 0,
    last_done_at: row['last_done_at'] as string | null,
    tags: safeJsonParse(row['tags'] as string | null, []),
    annotations: safeJsonParse(row['annotations'] as string | null, {}),
    is_recurring: Boolean(row['is_recurring']),
    recurrence_rule: row['recurrence_rule'] as 'daily' | 'weekly' | 'monthly' | null,
    show_in_bored: Boolean(row['show_in_bored']),
    bored_category_id: row['bored_category_id'] as string | null,
    archived_at: row['archived_at'] as string | null,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  }
}
