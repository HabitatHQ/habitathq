import type { DbAdapter } from '~/types/database'

export const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS exercises (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    slug           TEXT NOT NULL UNIQUE,
    equipment      TEXT NOT NULL,
    equipment_sub  TEXT NOT NULL DEFAULT 'other',
    movement       TEXT NOT NULL,
    muscles        TEXT NOT NULL DEFAULT '[]',
    muscles_sec    TEXT NOT NULL DEFAULT '[]',
    cues           TEXT,
    icon           TEXT,
    logging_mode   TEXT NOT NULL DEFAULT 'strength',
    is_custom      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL,
    archived_at TEXT,
    sort_order  INT DEFAULT 0,
    pinned_at   TEXT,
    last_used_at TEXT,
    use_count   INT DEFAULT 0,
    cover_emoji TEXT,
    scheduled_days TEXT,
    notification_enabled INTEGER DEFAULT 0,
    notification_time TEXT
  );

  CREATE TABLE IF NOT EXISTS template_exercises (
    id                  TEXT PRIMARY KEY,
    template_id         TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    exercise_id         TEXT NOT NULL REFERENCES exercises(id),
    order_num           INTEGER NOT NULL,
    superset_group      TEXT,
    sets_planned        INTEGER,
    reps_planned        TEXT,
    rpe_target          REAL,
    increment_kg        REAL DEFAULT 2.5,
    rest_seconds        INTEGER DEFAULT 120,
    set_rest_seconds    TEXT,
    transition_rest_sec INTEGER,
    warmup_counts       INTEGER NOT NULL DEFAULT 0,
    set_scheme          TEXT,
    notes               TEXT,
    failure_target      INTEGER DEFAULT 0,
    rpe_targets         TEXT,
    progression_rule    TEXT,
    deload_template_id  TEXT,
    substitutes         TEXT,
    tempo               TEXT,
    resistance_note     TEXT,
    unilateral          INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS template_groups (
    id                   TEXT PRIMARY KEY,
    template_id          TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    label                TEXT NOT NULL,
    name                 TEXT,
    group_type           TEXT NOT NULL DEFAULT 'superset',
    transition_rest_sec  INTEGER NOT NULL DEFAULT 15,
    rest_after_round_sec INTEGER NOT NULL DEFAULT 120,
    circuit_rest_mode    TEXT NOT NULL DEFAULT 'after_round',
    sort_order           INTEGER DEFAULT 0,
    display_name         TEXT,
    rounds               INTEGER DEFAULT 1,
    amrap                INTEGER DEFAULT 0,
    time_cap_sec         INTEGER
  );

  CREATE TABLE IF NOT EXISTS programs (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    weeks        INTEGER NOT NULL,
    is_builtin   INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    current_week INTEGER DEFAULT 1,
    started_at   TEXT,
    active       INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS program_weeks (
    id                  TEXT PRIMARY KEY,
    program_id          TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    week_num            INTEGER NOT NULL,
    is_deload           INTEGER DEFAULT 0,
    intensity_modifier  REAL DEFAULT 1.0,
    volume_modifier     REAL DEFAULT 1.0,
    phase               TEXT
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
    environment       TEXT,
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
    logged_at           TEXT,
    distance_m          REAL,
    duration_sec        INTEGER,
    speed_kmh           REAL,
    level               INTEGER,
    technique_flag      TEXT,
    body_feel           TEXT,
    failure_flag        INTEGER NOT NULL DEFAULT 0,
    failure_type        TEXT,
    partial_reps        INTEGER
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
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    intervals    TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    type         TEXT DEFAULT 'custom',
    work_sec     INTEGER,
    rest_sec     INTEGER,
    rounds       INTEGER
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
    run_duration_sec INTEGER
  );

  CREATE TABLE IF NOT EXISTS tags (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    category      TEXT NOT NULL DEFAULT 'custom',
    is_predefined INTEGER NOT NULL DEFAULT 0,
    color         TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workout_tags (
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (workout_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS template_folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    color      TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS template_folder_items (
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    folder_id   TEXT NOT NULL REFERENCES template_folders(id) ON DELETE CASCADE,
    sort_order  INTEGER DEFAULT 0,
    PRIMARY KEY (template_id, folder_id)
  );

  CREATE TABLE IF NOT EXISTS template_tags (
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (template_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS applied_defaults (
    key TEXT PRIMARY KEY
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
  CREATE INDEX IF NOT EXISTS idx_template_folder_items_folder ON template_folder_items(folder_id);
  CREATE INDEX IF NOT EXISTS idx_template_tags_template ON template_tags(template_id);
  CREATE INDEX IF NOT EXISTS idx_sets_workout_exercise ON sets(workout_exercise_id);
  CREATE INDEX IF NOT EXISTS idx_personal_records_exercise ON personal_records(exercise_id);
  CREATE INDEX IF NOT EXISTS idx_body_weights_date ON body_weights(date);
  CREATE INDEX IF NOT EXISTS idx_runs_workout ON runs(workout_id);
  CREATE INDEX IF NOT EXISTS idx_template_groups_template ON template_groups(template_id);
  CREATE INDEX IF NOT EXISTS idx_workout_tags_workout ON workout_tags(workout_id);
`

/**
 * Idempotent migrations — runs on every startup via addColumn which
 * checks pragma_table_info before ALTER. This keeps existing installs
 * in sync with the squashed schema above.
 */
export async function runMigrations(db: DbAdapter): Promise<void> {
  // Helper — skips ALTER TABLE when the column already exists
  async function addColumn(table: string, col: string, definition: string) {
    const found = await db.queryAll<{ name: string }>(
      'SELECT 1 FROM pragma_table_info(?) WHERE name = ?',
      [table, col],
    )
    if (found.length === 0) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`)
    }
  }

  // Exercises
  await addColumn('exercises', 'logging_mode', "TEXT NOT NULL DEFAULT 'strength'")
  await addColumn('exercises', 'equipment_sub', "TEXT NOT NULL DEFAULT 'other'")

  // Template exercises
  await addColumn('template_exercises', 'set_rest_seconds', 'TEXT')
  await addColumn('template_exercises', 'transition_rest_sec', 'INTEGER')
  await addColumn('template_exercises', 'warmup_counts', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('template_exercises', 'set_scheme', 'TEXT')
  await addColumn('template_exercises', 'notes', 'TEXT')
  await addColumn('template_exercises', 'failure_target', 'INTEGER DEFAULT 0')
  await addColumn('template_exercises', 'rpe_targets', 'TEXT')
  await addColumn('template_exercises', 'progression_rule', 'TEXT')
  await addColumn('template_exercises', 'deload_template_id', 'TEXT')
  await addColumn('template_exercises', 'substitutes', 'TEXT')
  await addColumn('template_exercises', 'tempo', 'TEXT')
  await addColumn('template_exercises', 'resistance_note', 'TEXT')
  await addColumn('template_exercises', 'unilateral', 'INTEGER DEFAULT 0')

  // Template groups
  await addColumn('template_groups', 'name', 'TEXT')
  await addColumn('template_groups', 'sort_order', 'INTEGER DEFAULT 0')
  await addColumn('template_groups', 'display_name', 'TEXT')
  await addColumn('template_groups', 'rounds', 'INTEGER DEFAULT 1')
  await addColumn('template_groups', 'amrap', 'INTEGER DEFAULT 0')
  await addColumn('template_groups', 'time_cap_sec', 'INTEGER')

  // Sets
  await addColumn('sets', 'distance_m', 'REAL')
  await addColumn('sets', 'duration_sec', 'INTEGER')
  await addColumn('sets', 'speed_kmh', 'REAL')
  await addColumn('sets', 'level', 'INTEGER')
  await addColumn('sets', 'technique_flag', 'TEXT')
  await addColumn('sets', 'body_feel', 'TEXT')
  await addColumn('sets', 'failure_flag', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('sets', 'failure_type', 'TEXT')
  await addColumn('sets', 'partial_reps', 'INTEGER')

  // Workouts
  await addColumn('workouts', 'environment', 'TEXT')

  // Interval templates
  await addColumn('interval_templates', 'type', "TEXT DEFAULT 'custom'")
  await addColumn('interval_templates', 'work_sec', 'INTEGER')
  await addColumn('interval_templates', 'rest_sec', 'INTEGER')
  await addColumn('interval_templates', 'rounds', 'INTEGER')

  // Programs
  await addColumn('programs', 'current_week', 'INTEGER DEFAULT 1')
  await addColumn('programs', 'started_at', 'TEXT')
  await addColumn('programs', 'active', 'INTEGER DEFAULT 0')
  await addColumn('program_weeks', 'intensity_modifier', 'REAL DEFAULT 1.0')
  await addColumn('program_weeks', 'volume_modifier', 'REAL DEFAULT 1.0')
  await addColumn('program_weeks', 'phase', 'TEXT')

  // Templates
  await addColumn('templates', 'scheduled_days', 'TEXT')
  await addColumn('templates', 'notification_enabled', 'INTEGER DEFAULT 0')
  await addColumn('templates', 'notification_time', 'TEXT')
  await addColumn('templates', 'archived_at', 'TEXT')
  await addColumn('templates', 'sort_order', 'INT DEFAULT 0')
  await addColumn('templates', 'pinned_at', 'TEXT')
  await addColumn('templates', 'last_used_at', 'TEXT')
  await addColumn('templates', 'use_count', 'INT DEFAULT 0')
  await addColumn('templates', 'cover_emoji', 'TEXT')
}
