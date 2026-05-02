import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import * as schema from '~/lib/db-schema'
import * as shared from '~/lib/db-shared'
import type { DbAdapter, WorkerRequest, WorkerResponse } from '~/types/database'

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

    // ─── Schema ───────────────────────────────────────────────────────────────────

    db.exec(schema.SCHEMA_DDL)

    // ─── Migrations ───────────────────────────────────────────────────────────────

    await schema.runMigrations(adapter)

    // ─── Default seeds ────────────────────────────────────────────────────────────

    await schema.seedDefaults(adapter)

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
          case 'GET_ALL_TAGS':
            result = await shared.getAllTags(adapter)
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
