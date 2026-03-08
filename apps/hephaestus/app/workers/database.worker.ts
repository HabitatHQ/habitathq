import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { WorkerResponse } from '~/types/database'

// ─── Exclusive lock ───────────────────────────────────────────────────────────
await (async () => {
  async function tryAcquireDbLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
      const got = await new Promise<boolean>((resolve) => {
        void navigator.locks.request('hephaestus-db', { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false)
            return Promise.resolve()
          }
          resolve(true)
          return new Promise(() => {}) // hold until worker terminates
        })
      })
      if (got) return true
    }
    return false
  }

  const hasLock = await tryAcquireDbLock()
  if (!hasLock) {
    self.postMessage({ type: 'LOCK_UNAVAILABLE' } satisfies WorkerResponse as WorkerResponse)
    return
  }

  try {
    // ─── DB init ──────────────────────────────────────────────────────────────
    // @ts-expect-error — sqlite-wasm types omit the optional config argument
    const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} })

    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/hephaestus',
      clearOnInit: false,
    })
    const db = new poolUtil.OpfsSAHPoolDb('/hephaestus.db')
    db.exec('PRAGMA foreign_keys = ON')

    // ─── Schema ───────────────────────────────────────────────────────────────

    db.exec(`
      CREATE TABLE IF NOT EXISTS exercises (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        slug        TEXT NOT NULL UNIQUE,
        equipment   TEXT NOT NULL,
        movement    TEXT NOT NULL,
        muscles     TEXT NOT NULL DEFAULT '[]',
        muscles_sec TEXT NOT NULL DEFAULT '[]',
        cues        TEXT,
        is_custom   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS templates (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS template_exercises (
        id            TEXT PRIMARY KEY,
        template_id   TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        exercise_id   TEXT NOT NULL REFERENCES exercises(id),
        order_num     INTEGER NOT NULL,
        superset_group TEXT,
        sets_planned  INTEGER,
        reps_planned  TEXT,
        rpe_target    REAL,
        increment_kg  REAL DEFAULT 2.5,
        rest_seconds  INTEGER DEFAULT 120
      );

      CREATE TABLE IF NOT EXISTS programs (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        weeks       INTEGER NOT NULL,
        is_builtin  INTEGER DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS program_weeks (
        id          TEXT PRIMARY KEY,
        program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        week_num    INTEGER NOT NULL,
        is_deload   INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS program_days (
        id           TEXT PRIMARY KEY,
        week_id      TEXT NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
        day_num      INTEGER NOT NULL,
        template_id  TEXT REFERENCES templates(id),
        label        TEXT
      );

      CREATE TABLE IF NOT EXISTS training_blocks (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        phase       TEXT,
        program_id  TEXT REFERENCES programs(id),
        start_date  TEXT NOT NULL,
        end_date    TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workouts (
        id                TEXT PRIMARY KEY,
        date              TEXT NOT NULL,
        started_at        TEXT NOT NULL,
        ended_at          TEXT,
        session_type      TEXT NOT NULL DEFAULT 'gym',
        training_block_id TEXT REFERENCES training_blocks(id),
        template_id       TEXT REFERENCES templates(id),
        mood_rating       INTEGER,
        energy_rating     INTEGER,
        notes             TEXT,
        created_at        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workout_exercises (
        id             TEXT PRIMARY KEY,
        workout_id     TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
        exercise_id    TEXT NOT NULL REFERENCES exercises(id),
        order_num      INTEGER NOT NULL,
        superset_group TEXT,
        rest_seconds   INTEGER DEFAULT 120
      );

      CREATE TABLE IF NOT EXISTS sets (
        id                  TEXT PRIMARY KEY,
        workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
        set_num             INTEGER NOT NULL,
        is_warmup           INTEGER DEFAULT 0,
        weight_kg           REAL,
        reps                INTEGER,
        rpe                 REAL,
        rir                 INTEGER,
        notes               TEXT,
        completed           INTEGER DEFAULT 0,
        logged_at           TEXT
      );

      CREATE TABLE IF NOT EXISTS runs (
        id               TEXT PRIMARY KEY,
        workout_id       TEXT NOT NULL UNIQUE REFERENCES workouts(id) ON DELETE CASCADE,
        run_type         TEXT NOT NULL DEFAULT 'easy',
        distance_m       REAL,
        duration_sec     INTEGER,
        avg_pace_sec_km  REAL,
        avg_hr           INTEGER,
        max_hr           INTEGER,
        elevation_gain_m REAL,
        avg_cadence      INTEGER,
        avg_power_w      INTEGER,
        manual_entry     INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS run_splits (
        id           TEXT PRIMARY KEY,
        run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        split_num    INTEGER NOT NULL,
        distance_m   REAL NOT NULL,
        duration_sec INTEGER NOT NULL,
        pace_sec_km  REAL,
        hr_avg       INTEGER,
        elevation_m  REAL
      );

      CREATE TABLE IF NOT EXISTS interval_templates (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        intervals  TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS body_weights (
        id        TEXT PRIMARY KEY,
        date      TEXT NOT NULL UNIQUE,
        weight_kg REAL NOT NULL,
        notes     TEXT
      );

      CREATE TABLE IF NOT EXISTS body_measurements (
        id       TEXT PRIMARY KEY,
        date     TEXT NOT NULL,
        metric   TEXT NOT NULL,
        value_cm REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS body_photos (
        id       TEXT PRIMARY KEY,
        date     TEXT NOT NULL,
        angle    TEXT,
        blob_key TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS personal_records (
        id          TEXT PRIMARY KEY,
        exercise_id TEXT NOT NULL REFERENCES exercises(id),
        record_type TEXT NOT NULL,
        value       REAL NOT NULL,
        set_id      TEXT REFERENCES sets(id),
        date        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS weekly_training_load (
        week             TEXT PRIMARY KEY,
        gym_volume       REAL,
        gym_sets         INTEGER,
        run_distance_m   REAL,
        run_duration_sec INTEGER,
        acute_load       REAL,
        chronic_load     REAL
      );

      CREATE TABLE IF NOT EXISTS applied_defaults (
        key TEXT PRIMARY KEY
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
      CREATE INDEX IF NOT EXISTS idx_sets_workout_exercise ON sets(workout_exercise_id);
      CREATE INDEX IF NOT EXISTS idx_personal_records_exercise ON personal_records(exercise_id);
      CREATE INDEX IF NOT EXISTS idx_body_weights_date ON body_weights(date);
      CREATE INDEX IF NOT EXISTS idx_runs_workout ON runs(workout_id);
    `)

    self.postMessage({ type: 'READY' } satisfies WorkerResponse as WorkerResponse)

    // ─── Message handler ──────────────────────────────────────────────────────

    self.addEventListener('message', (event: MessageEvent) => {
      const { id, type, payload } = event.data as {
        id: string
        type: string
        payload?: unknown
      }

      function reply(data: unknown) {
        self.postMessage({
          id,
          type: `${type}_RESULT`,
          payload: data,
        } satisfies WorkerResponse as WorkerResponse)
      }

      function error(msg: string) {
        self.postMessage({
          id,
          type: 'ERROR',
          error: msg,
        } satisfies WorkerResponse as WorkerResponse)
      }

      try {
        switch (type) {
          case 'EXEC': {
            const { sql } = payload as { sql: string }
            db.exec(sql)
            reply(null)
            break
          }

          case 'QUERY': {
            const { sql, bind } = payload as { sql: string; bind?: unknown[] }
            const rows: unknown[] = []
            db.exec({
              sql,
              bind,
              rowMode: 'object',
              callback: (row: unknown) => rows.push(row),
            })
            reply(rows)
            break
          }

          case 'IS_DEFAULT_APPLIED': {
            const { key } = payload as { key: string }
            const rows: unknown[] = []
            db.exec({
              sql: 'SELECT key FROM applied_defaults WHERE key = ?',
              bind: [key],
              rowMode: 'object',
              callback: (row: unknown) => rows.push(row),
            })
            reply(rows.length > 0)
            break
          }

          case 'MARK_DEFAULT_APPLIED': {
            const { key } = payload as { key: string }
            db.exec({ sql: 'INSERT OR IGNORE INTO applied_defaults (key) VALUES (?)', bind: [key] })
            reply(null)
            break
          }

          default:
            error(`Unknown message type: ${type}`)
        }
      } catch (err) {
        error(err instanceof Error ? err.message : String(err))
      }
    })
  } catch (err) {
    self.postMessage({
      type: 'INIT_ERROR',
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse as WorkerResponse)
  }
})()
