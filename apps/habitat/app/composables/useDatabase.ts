import { sendToWorker } from '~/plugins/database.client'
import type { Habit, Completion, HabitWithSchedule, HabitSchedule, HabitLog, CheckinEntry, CheckinTemplate, CheckinQuestion, CheckinResponse, Scribble, DbInfo, Reminder, CheckinReminder, HabitatExport, ExportSelection, CheckinDaySummary, BoredCategory, BoredActivity, Todo, BoredOracleResult } from '~/types/database'

export function useDatabase() {
  return {
    isAvailable: true as const,
    getHabits: (): Promise<HabitWithSchedule[]> =>
      sendToWorker({ type: 'GET_HABITS' }),
    createHabit: (p: Omit<Habit, 'id' | 'created_at' | 'archived_at'>): Promise<HabitWithSchedule> =>
      sendToWorker({ type: 'CREATE_HABIT', payload: p }),
    updateHabit: (p: Partial<Habit> & { id: string }): Promise<HabitWithSchedule> =>
      sendToWorker({ type: 'UPDATE_HABIT', payload: p }),
    archiveHabit: (id: string): Promise<null> =>
      sendToWorker({ type: 'ARCHIVE_HABIT', payload: { id } }),
    deleteHabit: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_HABIT', payload: { id } }),
    getCompletionsForDate: (date: string): Promise<Completion[]> =>
      sendToWorker({ type: 'GET_COMPLETIONS_FOR_DATE', payload: { date } }),
    getCompletionsForHabit: (habit_id: string, from: string, to: string): Promise<Completion[]> =>
      sendToWorker({ type: 'GET_COMPLETIONS_FOR_HABIT', payload: { habit_id, from, to } }),
    toggleCompletion: (habit_id: string, date: string): Promise<Completion | null> =>
      sendToWorker({ type: 'TOGGLE_COMPLETION', payload: { habit_id, date } }),
    getStreak: (habit_id: string): Promise<{ current: number; longest: number }> =>
      sendToWorker({ type: 'GET_STREAK', payload: { habit_id } }),
    getAllCompletions: (): Promise<Completion[]> =>
      sendToWorker({ type: 'GET_ALL_COMPLETIONS' }),
    deleteAllHabits: (): Promise<null> =>
      sendToWorker({ type: 'DELETE_ALL_HABITS' }),
    deleteAllCheckinEntries: (): Promise<null> =>
      sendToWorker({ type: 'DELETE_ALL_CHECKIN_ENTRIES' }),
    deleteAllCheckinData: (): Promise<null> =>
      sendToWorker({ type: 'DELETE_ALL_CHECKIN_DATA' }),
    deleteAllScribbles: (): Promise<null> =>
      sendToWorker({ type: 'DELETE_ALL_SCRIBBLES' }),
    clearAppliedDefaults: (): Promise<null> =>
      sendToWorker({ type: 'CLEAR_APPLIED_DEFAULTS' }),
    getDbInfo: (): Promise<DbInfo> =>
      sendToWorker({ type: 'GET_DB_INFO' }),
    integrityCheck: (): Promise<string[]> =>
      sendToWorker({ type: 'INTEGRITY_CHECK' }),
    isDefaultApplied: (key: string): Promise<boolean> =>
      sendToWorker({ type: 'IS_DEFAULT_APPLIED', payload: { key } }),
    markDefaultApplied: (key: string): Promise<null> =>
      sendToWorker({ type: 'MARK_DEFAULT_APPLIED', payload: { key } }),
    getArchivedHabits: (): Promise<HabitWithSchedule[]> =>
      sendToWorker({ type: 'GET_ARCHIVED_HABITS' }),
    nukeOpfs: (): Promise<null> =>
      sendToWorker({ type: 'NUKE_OPFS' }),
    exportDb: (): Promise<Uint8Array> =>
      sendToWorker({ type: 'EXPORT_DB' }),
    getHabitLogsForDate: (date: string): Promise<HabitLog[]> =>
      sendToWorker({ type: 'GET_HABIT_LOGS_FOR_DATE', payload: { date } }),
    getHabitLogsForHabit: (habit_id: string, from: string, to: string): Promise<HabitLog[]> =>
      sendToWorker({ type: 'GET_HABIT_LOGS_FOR_HABIT', payload: { habit_id, from, to } }),
    logHabitValue: (habit_id: string, date: string, value: number, notes = ''): Promise<HabitLog> =>
      sendToWorker({ type: 'LOG_HABIT_VALUE', payload: { habit_id, date, value, notes } }),
    deleteHabitLog: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_HABIT_LOG', payload: { id } }),
    getScheduleForHabit: (habit_id: string): Promise<HabitSchedule | null> =>
      sendToWorker({ type: 'GET_SCHEDULE_FOR_HABIT', payload: { habit_id } }),
    updateHabitSchedule: (p: Partial<HabitSchedule> & { id: string }): Promise<HabitSchedule> =>
      sendToWorker({ type: 'UPDATE_HABIT_SCHEDULE', payload: p }),
    pauseHabit: (id: string, until: string | null): Promise<HabitWithSchedule> =>
      sendToWorker({ type: 'PAUSE_HABIT', payload: { id, until } }),
    pauseAllHabits: (until: string | null): Promise<null> =>
      sendToWorker({ type: 'PAUSE_ALL_HABITS', payload: { until } }),
    getCompletionsForDateRange: (from: string, to: string): Promise<Completion[]> =>
      sendToWorker({ type: 'GET_COMPLETIONS_FOR_DATE_RANGE', payload: { from, to } }),
    getHabitLogsForDateRange: (from: string, to: string): Promise<HabitLog[]> =>
      sendToWorker({ type: 'GET_HABIT_LOGS_FOR_DATE_RANGE', payload: { from, to } }),
    getCheckinEntry: (date: string): Promise<CheckinEntry | null> =>
      sendToWorker({ type: 'GET_CHECKIN_ENTRY', payload: { date } }),
    upsertCheckinEntry: (date: string, content: string): Promise<CheckinEntry> =>
      sendToWorker({ type: 'UPSERT_CHECKIN_ENTRY', payload: { date, content } }),
    deleteCheckinEntry: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_CHECKIN_ENTRY', payload: { id } }),
    getCheckinEntries: (from: string, to: string): Promise<CheckinEntry[]> =>
      sendToWorker({ type: 'GET_CHECKIN_ENTRIES', payload: { from, to } }),
    getCheckinTemplates: (): Promise<CheckinTemplate[]> =>
      sendToWorker({ type: 'GET_CHECKIN_TEMPLATES' }),
    createCheckinTemplate: (p: Omit<CheckinTemplate, 'id'>): Promise<CheckinTemplate> =>
      sendToWorker({ type: 'CREATE_CHECKIN_TEMPLATE', payload: p }),
    updateCheckinTemplate: (p: Partial<CheckinTemplate> & { id: string }): Promise<CheckinTemplate> =>
      sendToWorker({ type: 'UPDATE_CHECKIN_TEMPLATE', payload: p }),
    deleteCheckinTemplate: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_CHECKIN_TEMPLATE', payload: { id } }),
    getCheckinQuestions: (template_id: string): Promise<CheckinQuestion[]> =>
      sendToWorker({ type: 'GET_CHECKIN_QUESTIONS', payload: { template_id } }),
    createCheckinQuestion: (p: Omit<CheckinQuestion, 'id'>): Promise<CheckinQuestion> =>
      sendToWorker({ type: 'CREATE_CHECKIN_QUESTION', payload: p }),
    updateCheckinQuestion: (p: Partial<CheckinQuestion> & { id: string }): Promise<CheckinQuestion> =>
      sendToWorker({ type: 'UPDATE_CHECKIN_QUESTION', payload: p }),
    deleteCheckinQuestion: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_CHECKIN_QUESTION', payload: { id } }),
    getCheckinResponses: (template_id: string, date: string): Promise<CheckinResponse[]> =>
      sendToWorker({ type: 'GET_CHECKIN_RESPONSES', payload: { template_id, date } }),
    upsertCheckinResponse: (question_id: string, logged_date: string, value_numeric: number | null, value_text: string | null): Promise<CheckinResponse> =>
      sendToWorker({ type: 'UPSERT_CHECKIN_RESPONSE', payload: { question_id, logged_date, value_numeric, value_text } }),
    deleteCheckinResponse: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_CHECKIN_RESPONSE', payload: { id } }),
    getScribbles: (): Promise<Scribble[]> =>
      sendToWorker({ type: 'GET_SCRIBBLES' }),
    createScribble: (p: Omit<Scribble, 'id' | 'created_at' | 'updated_at'>): Promise<Scribble> =>
      sendToWorker({ type: 'CREATE_SCRIBBLE', payload: p }),
    updateScribble: (p: Partial<Scribble> & { id: string }): Promise<Scribble> =>
      sendToWorker({ type: 'UPDATE_SCRIBBLE', payload: p }),
    deleteScribble: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_SCRIBBLE', payload: { id } }),
    getAllReminders: (): Promise<Reminder[]> =>
      sendToWorker({ type: 'GET_ALL_REMINDERS' }),
    getRemindersForHabit: (habit_id: string): Promise<Reminder[]> =>
      sendToWorker({ type: 'GET_REMINDERS_FOR_HABIT', payload: { habit_id } }),
    createReminder: (habit_id: string, trigger_time: string, days_active: number[] | null): Promise<Reminder> =>
      sendToWorker({ type: 'CREATE_REMINDER', payload: { habit_id, trigger_time, days_active } }),
    deleteReminder: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_REMINDER', payload: { id } }),
    getAllCheckinReminders: (): Promise<CheckinReminder[]> =>
      sendToWorker({ type: 'GET_ALL_CHECKIN_REMINDERS' }),
    getCheckinRemindersForTemplate: (template_id: string): Promise<CheckinReminder[]> =>
      sendToWorker({ type: 'GET_CHECKIN_REMINDERS_FOR_TEMPLATE', payload: { template_id } }),
    createCheckinReminder: (template_id: string, trigger_time: string, days_active: number[] | null): Promise<CheckinReminder> =>
      sendToWorker({ type: 'CREATE_CHECKIN_REMINDER', payload: { template_id, trigger_time, days_active } }),
    deleteCheckinReminder: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_CHECKIN_REMINDER', payload: { id } }),
    getCheckinTemplate: (id: string): Promise<CheckinTemplate | null> =>
      sendToWorker({ type: 'GET_CHECKIN_TEMPLATE', payload: { id } }),
    getCheckinResponseDates: (): Promise<Array<{ date: string; count: number }>> =>
      sendToWorker({ type: 'GET_CHECKIN_RESPONSE_DATES' }),
    exportJsonData: (sel: ExportSelection): Promise<HabitatExport> =>
      sendToWorker({ type: 'EXPORT_JSON_DATA', payload: sel }),
    importJson: (data: HabitatExport): Promise<null> =>
      sendToWorker({ type: 'IMPORT_JSON', payload: data }),
    getCheckinSummaryForDate: (date: string): Promise<CheckinDaySummary[]> =>
      sendToWorker({ type: 'GET_CHECKIN_SUMMARY_FOR_DATE', payload: { date } }),
    getScribblesForDate: (date: string): Promise<Scribble[]> =>
      sendToWorker({ type: 'GET_SCRIBBLES_FOR_DATE', payload: { date } }),
    getBoredCategories: (): Promise<BoredCategory[]> =>
      sendToWorker({ type: 'GET_BORED_CATEGORIES' }),
    createBoredCategory: (p: Omit<BoredCategory, 'id' | 'created_at'>): Promise<BoredCategory> =>
      sendToWorker({ type: 'CREATE_BORED_CATEGORY', payload: p }),
    updateBoredCategory: (p: Partial<BoredCategory> & { id: string }): Promise<BoredCategory> =>
      sendToWorker({ type: 'UPDATE_BORED_CATEGORY', payload: p }),
    deleteBoredCategory: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_BORED_CATEGORY', payload: { id } }),
    getBoredActivities: (): Promise<BoredActivity[]> =>
      sendToWorker({ type: 'GET_BORED_ACTIVITIES' }),
    getBoredActivitiesForCategory: (category_id: string): Promise<BoredActivity[]> =>
      sendToWorker({ type: 'GET_BORED_ACTIVITIES_FOR_CATEGORY', payload: { category_id } }),
    createBoredActivity: (p: Omit<BoredActivity, 'id' | 'created_at' | 'is_done' | 'done_at' | 'done_count' | 'last_done_at' | 'archived_at'>): Promise<BoredActivity> =>
      sendToWorker({ type: 'CREATE_BORED_ACTIVITY', payload: p }),
    updateBoredActivity: (p: Partial<BoredActivity> & { id: string }): Promise<BoredActivity> =>
      sendToWorker({ type: 'UPDATE_BORED_ACTIVITY', payload: p }),
    deleteBoredActivity: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_BORED_ACTIVITY', payload: { id } }),
    archiveBoredActivity: (id: string): Promise<null> =>
      sendToWorker({ type: 'ARCHIVE_BORED_ACTIVITY', payload: { id } }),
    markBoredActivityDone: (id: string): Promise<BoredActivity> =>
      sendToWorker({ type: 'MARK_BORED_ACTIVITY_DONE', payload: { id } }),
    getBoredOracle: (excluded_category_ids: string[], max_minutes: number | null): Promise<BoredOracleResult | null> =>
      sendToWorker({ type: 'GET_BORED_ORACLE', payload: { excluded_category_ids, max_minutes } }),
    deleteAllBoredData: (): Promise<null> =>
      sendToWorker({ type: 'DELETE_ALL_BORED_DATA' }),
    getTodos: (): Promise<Todo[]> =>
      sendToWorker({ type: 'GET_TODOS' }),
    createTodo: (p: Omit<Todo, 'id' | 'created_at' | 'updated_at' | 'is_done' | 'done_at' | 'done_count' | 'last_done_at' | 'archived_at'>): Promise<Todo> =>
      sendToWorker({ type: 'CREATE_TODO', payload: p }),
    updateTodo: (p: Partial<Todo> & { id: string }): Promise<Todo> =>
      sendToWorker({ type: 'UPDATE_TODO', payload: p }),
    deleteTodo: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_TODO', payload: { id } }),
    archiveTodo: (id: string): Promise<null> =>
      sendToWorker({ type: 'ARCHIVE_TODO', payload: { id } }),
    toggleTodo: (id: string): Promise<Todo> =>
      sendToWorker({ type: 'TOGGLE_TODO', payload: { id } }),
    deleteAllTodos: (): Promise<null> =>
      sendToWorker({ type: 'DELETE_ALL_TODOS' }),
  }
}
