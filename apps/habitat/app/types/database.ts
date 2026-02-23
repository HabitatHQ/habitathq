export interface Habit {
  id: string
  name: string
  description: string
  color: string
  icon: string
  frequency: string
  created_at: string
  archived_at: string | null
  /** Hierarchical tag keys, e.g. ['health/exercise', 'goals/daily']. */
  tags: string[]
  /** Arbitrary key-value metadata, e.g. { difficulty: 'medium' }. */
  annotations: Record<string, string>
  type: 'BOOLEAN' | 'NUMERIC' | 'LIMIT'
  target_value: number
  paused_until: string | null
}

export interface HabitSchedule {
  id: string
  habit_id: string
  schedule_type: 'DAILY' | 'WEEKLY_FLEX' | 'SPECIFIC_DAYS'
  frequency_count: number | null
  days_of_week: number[] | null   // 0=Sun … 6=Sat
  due_time: string | null
  start_date: string | null
  end_date: string | null
}

export interface HabitLog {
  id: string
  habit_id: string
  date: string       // YYYY-MM-DD
  logged_at: string  // ISO timestamp
  value: number
  notes: string
}

export type HabitWithSchedule = Habit & { schedule: HabitSchedule | null }

export interface Completion {
  id: string
  habit_id: string
  date: string          // 'YYYY-MM-DD'
  completed_at: string  // ISO timestamp
  notes: string
  /** Tags applied at completion time. */
  tags: string[]
  /** Annotations applied at completion time. */
  annotations: Record<string, string>
}

export interface CheckinEntry {
  id: string
  entry_date: string    // YYYY-MM-DD
  content: string       // JSON-serialised CheckinAnswers
  created_at: string
  updated_at: string
}

export interface CheckinTemplate {
  id: string
  title: string
  schedule_type: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  days_active: number[] | null
}

export interface CheckinQuestion {
  id: string
  template_id: string
  prompt: string
  response_type: 'SCALE' | 'TEXT' | 'BOOLEAN'
  display_order: number
}

export interface CheckinResponse {
  id: string
  question_id: string
  logged_date: string   // YYYY-MM-DD
  value_numeric: number | null
  value_text: string | null
}

export interface Scribble {
  id: string
  title: string
  content: string
  tags: string[]
  annotations: Record<string, string>
  created_at: string
  updated_at: string
}

export interface Reminder {
  id: string
  habit_id: string
  trigger_time: string        // 'HH:MM'
  days_active: number[] | null  // null = every day; 0=Sun … 6=Sat
}

export interface CheckinReminder {
  id: string
  template_id: string
  trigger_time: string        // 'HH:MM'
  days_active: number[] | null  // null = every day; 0=Sun … 6=Sat
}

export interface BoredCategory {
  id: string
  name: string
  icon: string
  color: string
  is_system: boolean
  sort_order: number
  created_at: string
}

export interface BoredActivity {
  id: string
  title: string
  description: string
  category_id: string
  estimated_minutes: number | null
  tags: string[]
  annotations: Record<string, string>
  is_recurring: boolean
  recurrence_rule: 'daily' | 'weekly' | 'monthly' | null
  is_done: boolean
  done_at: string | null
  done_count: number
  last_done_at: string | null
  archived_at: string | null
  created_at: string
}

export interface Todo {
  id: string
  title: string
  description: string
  due_date: string | null
  priority: 'high' | 'medium' | 'low'
  estimated_minutes: number | null
  is_done: boolean
  done_at: string | null
  done_count: number
  last_done_at: string | null
  tags: string[]
  annotations: Record<string, string>
  is_recurring: boolean
  recurrence_rule: 'daily' | 'weekly' | 'monthly' | null
  show_in_bored: boolean
  bored_category_id: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type BoredOracleResult =
  | { source: 'activity'; activity: BoredActivity; category: BoredCategory }
  | { source: 'todo'; todo: Todo; category: BoredCategory | null }

export type WorkerRequest =
  | { id: string; type: 'GET_HABITS' }
  | { id: string; type: 'CREATE_HABIT'; payload: Omit<Habit, 'id' | 'created_at' | 'archived_at'> }
  | { id: string; type: 'UPDATE_HABIT'; payload: Partial<Habit> & { id: string } }
  | { id: string; type: 'ARCHIVE_HABIT'; payload: { id: string } }
  | { id: string; type: 'DELETE_HABIT'; payload: { id: string } }
  | { id: string; type: 'GET_COMPLETIONS_FOR_DATE'; payload: { date: string } }
  | { id: string; type: 'GET_COMPLETIONS_FOR_HABIT'; payload: { habit_id: string; from: string; to: string } }
  | { id: string; type: 'TOGGLE_COMPLETION'; payload: { habit_id: string; date: string; tags?: string[]; annotations?: Record<string, string> } }
  | { id: string; type: 'GET_STREAK'; payload: { habit_id: string } }
  | { id: string; type: 'GET_ALL_COMPLETIONS' }
  | { id: string; type: 'DELETE_ALL_HABITS' }
  | { id: string; type: 'DELETE_ALL_CHECKIN_ENTRIES' }
  | { id: string; type: 'DELETE_ALL_CHECKIN_DATA' }
  | { id: string; type: 'DELETE_ALL_SCRIBBLES' }
  | { id: string; type: 'CLEAR_APPLIED_DEFAULTS' }
  | { id: string; type: 'GET_ARCHIVED_HABITS' }
  | { id: string; type: 'NUKE_OPFS' }
  | { id: string; type: 'EXPORT_DB' }
  | { id: string; type: 'GET_HABIT_LOGS_FOR_DATE'; payload: { date: string } }
  | { id: string; type: 'GET_HABIT_LOGS_FOR_HABIT'; payload: { habit_id: string; from: string; to: string } }
  | { id: string; type: 'LOG_HABIT_VALUE'; payload: { habit_id: string; date: string; value: number; notes?: string } }
  | { id: string; type: 'DELETE_HABIT_LOG'; payload: { id: string } }
  | { id: string; type: 'GET_SCHEDULE_FOR_HABIT'; payload: { habit_id: string } }
  | { id: string; type: 'UPDATE_HABIT_SCHEDULE'; payload: Partial<HabitSchedule> & { id: string } }
  | { id: string; type: 'PAUSE_HABIT'; payload: { id: string; until: string | null } }
  | { id: string; type: 'GET_COMPLETIONS_FOR_DATE_RANGE'; payload: { from: string; to: string } }
  | { id: string; type: 'GET_HABIT_LOGS_FOR_DATE_RANGE'; payload: { from: string; to: string } }
  | { id: string; type: 'GET_CHECKIN_ENTRY'; payload: { date: string } }
  | { id: string; type: 'UPSERT_CHECKIN_ENTRY'; payload: { date: string; content: string } }
  | { id: string; type: 'DELETE_CHECKIN_ENTRY'; payload: { id: string } }
  | { id: string; type: 'GET_CHECKIN_ENTRIES'; payload: { from: string; to: string } }
  | { id: string; type: 'GET_CHECKIN_TEMPLATES' }
  | { id: string; type: 'CREATE_CHECKIN_TEMPLATE'; payload: Omit<CheckinTemplate, 'id'> }
  | { id: string; type: 'UPDATE_CHECKIN_TEMPLATE'; payload: Partial<CheckinTemplate> & { id: string } }
  | { id: string; type: 'DELETE_CHECKIN_TEMPLATE'; payload: { id: string } }
  | { id: string; type: 'GET_CHECKIN_QUESTIONS'; payload: { template_id: string } }
  | { id: string; type: 'CREATE_CHECKIN_QUESTION'; payload: Omit<CheckinQuestion, 'id'> }
  | { id: string; type: 'UPDATE_CHECKIN_QUESTION'; payload: Partial<CheckinQuestion> & { id: string } }
  | { id: string; type: 'DELETE_CHECKIN_QUESTION'; payload: { id: string } }
  | { id: string; type: 'GET_CHECKIN_RESPONSES'; payload: { template_id: string; date: string } }
  | { id: string; type: 'UPSERT_CHECKIN_RESPONSE'; payload: { question_id: string; logged_date: string; value_numeric: number | null; value_text: string | null } }
  | { id: string; type: 'DELETE_CHECKIN_RESPONSE'; payload: { id: string } }
  | { id: string; type: 'GET_SCRIBBLES' }
  | { id: string; type: 'CREATE_SCRIBBLE'; payload: Omit<Scribble, 'id' | 'created_at' | 'updated_at'> }
  | { id: string; type: 'UPDATE_SCRIBBLE'; payload: Partial<Scribble> & { id: string } }
  | { id: string; type: 'DELETE_SCRIBBLE'; payload: { id: string } }
  | { id: string; type: 'GET_DB_INFO' }
  | { id: string; type: 'INTEGRITY_CHECK' }
  | { id: string; type: 'IS_DEFAULT_APPLIED'; payload: { key: string } }
  | { id: string; type: 'MARK_DEFAULT_APPLIED'; payload: { key: string } }
  | { id: string; type: 'GET_ALL_REMINDERS' }
  | { id: string; type: 'GET_REMINDERS_FOR_HABIT'; payload: { habit_id: string } }
  | { id: string; type: 'CREATE_REMINDER'; payload: Omit<Reminder, 'id'> }
  | { id: string; type: 'DELETE_REMINDER'; payload: { id: string } }
  | { id: string; type: 'GET_ALL_CHECKIN_REMINDERS' }
  | { id: string; type: 'GET_CHECKIN_REMINDERS_FOR_TEMPLATE'; payload: { template_id: string } }
  | { id: string; type: 'CREATE_CHECKIN_REMINDER'; payload: Omit<CheckinReminder, 'id'> }
  | { id: string; type: 'DELETE_CHECKIN_REMINDER'; payload: { id: string } }
  | { id: string; type: 'GET_CHECKIN_TEMPLATE'; payload: { id: string } }
  | { id: string; type: 'GET_CHECKIN_RESPONSE_DATES' }
  | { id: string; type: 'PAUSE_ALL_HABITS'; payload: { until: string | null } }
  | { id: string; type: 'EXPORT_JSON_DATA'; payload: ExportSelection }
  | { id: string; type: 'IMPORT_JSON'; payload: HabitatExport }
  | { id: string; type: 'GET_CHECKIN_SUMMARY_FOR_DATE'; payload: { date: string } }
  | { id: string; type: 'GET_SCRIBBLES_FOR_DATE'; payload: { date: string } }
  | { id: string; type: 'GET_BORED_CATEGORIES' }
  | { id: string; type: 'CREATE_BORED_CATEGORY'; payload: Omit<BoredCategory, 'id' | 'created_at'> }
  | { id: string; type: 'UPDATE_BORED_CATEGORY'; payload: Partial<BoredCategory> & { id: string } }
  | { id: string; type: 'DELETE_BORED_CATEGORY'; payload: { id: string } }
  | { id: string; type: 'GET_BORED_ACTIVITIES' }
  | { id: string; type: 'GET_BORED_ACTIVITIES_FOR_CATEGORY'; payload: { category_id: string } }
  | { id: string; type: 'CREATE_BORED_ACTIVITY'; payload: Omit<BoredActivity, 'id' | 'created_at' | 'is_done' | 'done_at' | 'done_count' | 'last_done_at' | 'archived_at'> }
  | { id: string; type: 'UPDATE_BORED_ACTIVITY'; payload: Partial<BoredActivity> & { id: string } }
  | { id: string; type: 'DELETE_BORED_ACTIVITY'; payload: { id: string } }
  | { id: string; type: 'ARCHIVE_BORED_ACTIVITY'; payload: { id: string } }
  | { id: string; type: 'MARK_BORED_ACTIVITY_DONE'; payload: { id: string } }
  | { id: string; type: 'GET_BORED_ORACLE'; payload: { excluded_category_ids: string[]; max_minutes: number | null } }
  | { id: string; type: 'DELETE_ALL_BORED_DATA' }
  | { id: string; type: 'GET_TODOS' }
  | { id: string; type: 'CREATE_TODO'; payload: Omit<Todo, 'id' | 'created_at' | 'updated_at' | 'is_done' | 'done_at' | 'done_count' | 'last_done_at' | 'archived_at'> }
  | { id: string; type: 'UPDATE_TODO'; payload: Partial<Todo> & { id: string } }
  | { id: string; type: 'DELETE_TODO'; payload: { id: string } }
  | { id: string; type: 'ARCHIVE_TODO'; payload: { id: string } }
  | { id: string; type: 'TOGGLE_TODO'; payload: { id: string } }
  | { id: string; type: 'DELETE_ALL_TODOS' }

export interface CheckinDaySummary {
  template_id: string
  title: string
  response_count: number
}

export interface DbInfo {
  userVersion: number
  tables: Array<{ name: string; sql: string }>
  indices: Array<{ name: string; tbl_name: string; sql: string }>
}

/** Versioned JSON export payload produced by EXPORT_JSON_DATA. */
export interface HabitatExport {
  version: 1
  exported_at: string
  habits: Habit[]
  completions: Completion[]
  habit_logs: HabitLog[]
  habit_schedules: HabitSchedule[]
  checkin_templates: CheckinTemplate[]
  checkin_questions: CheckinQuestion[]
  checkin_responses: CheckinResponse[]
  reminders: Reminder[]
  checkin_reminders: CheckinReminder[]
  scribbles: Scribble[]
  checkin_entries: CheckinEntry[]
  bored_categories: BoredCategory[]
  bored_activities: BoredActivity[]
  todos: Todo[]
}

/** Which tables to include when exporting JSON. */
export interface ExportSelection {
  habits: boolean
  completions: boolean
  habit_logs: boolean
  habit_schedules: boolean
  reminders: boolean
  checkin_templates: boolean
  checkin_questions: boolean
  checkin_responses: boolean
  checkin_reminders: boolean
  scribbles: boolean
  checkin_entries: boolean
  bored_categories: boolean
  bored_activities: boolean
  todos: boolean
}

export type WorkerResponse<T = unknown> =
  | { id: string; ok: true; data: T }
  | { id: string; ok: false; error: string }

/** Distributive Omit — strips a key from each member of a discriminated union. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** WorkerRequest with the correlation `id` removed — used by sendToWorker callers. */
export type WorkerRequestBody = DistOmit<WorkerRequest, 'id'>
