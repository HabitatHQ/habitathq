import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import * as schema from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { DbAdapter, WorkerRequestBody } from '~/types/database'

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
  await exec('PRAGMA foreign_keys = ON')
  await exec(schema.SCHEMA_DDL)
  await schema.runMigrations(adapter)
  await schema.seedDefaults(adapter)
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
    case 'GET_ALL_TAGS':
      return shared.getAllTags(adapter)
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
