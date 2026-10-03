import type { DbAdapter } from '@palladium/core'

/** Durable lifecycle data kept separately so legacy workout rows remain readable. */
export const WORKOUT_DDL = `
  CREATE TRIGGER IF NOT EXISTS trg_workouts_single_unfinished_insert
  BEFORE INSERT ON workouts
  WHEN NEW.ended_at IS NULL AND EXISTS (SELECT 1 FROM workouts WHERE ended_at IS NULL)
  BEGIN SELECT RAISE(ABORT, 'An unfinished workout already exists'); END;
  CREATE TRIGGER IF NOT EXISTS trg_workouts_single_unfinished_update
  BEFORE UPDATE OF ended_at ON workouts
  WHEN NEW.ended_at IS NULL AND EXISTS (SELECT 1 FROM workouts WHERE id != NEW.id AND ended_at IS NULL)
  BEGIN SELECT RAISE(ABORT, 'An unfinished workout already exists'); END;
  CREATE TABLE IF NOT EXISTS workout_finish_summaries (
    workout_id TEXT PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE,
    summary_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workout_session_options (
    workout_id TEXT PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE,
    intensity_modifier REAL NOT NULL DEFAULT 1,
    volume_modifier REAL NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS template_revisions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    revision_num INTEGER NOT NULL,
    prescription_json TEXT NOT NULL,
    structure_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (template_id, revision_num)
  );
  CREATE TABLE IF NOT EXISTS saved_routines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    template_id TEXT NOT NULL,
    adopted_template_revision_id TEXT NOT NULL,
    current_revision_id TEXT NOT NULL,
    continuation_policy TEXT NOT NULL CHECK (continuation_policy IN ('calendar_bound','carry_forward')),
    deferral_mode TEXT CHECK (deferral_mode IS NULL OR deferral_mode IN ('automatic','manual')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS routine_revisions (
    id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL,
    revision_num INTEGER NOT NULL,
    prescription_json TEXT NOT NULL,
    inputs_json TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    structure_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (routine_id, revision_num)
  );
  CREATE TABLE IF NOT EXISTS program_revisions (
    id TEXT PRIMARY KEY,
    program_id TEXT NOT NULL,
    revision_num INTEGER NOT NULL,
    design_json TEXT NOT NULL,
    structure_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (program_id, revision_num)
  );
  CREATE TABLE IF NOT EXISTS training_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    program_id TEXT,
    adopted_program_revision_id TEXT,
    start_local_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    legacy_state_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS training_plan_bindings (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    program_slot_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    routine_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('bound','unresolved')),
    issue TEXT,
    UNIQUE (plan_id, program_slot_id)
  );
  CREATE TABLE IF NOT EXISTS workout_intents (
    workout_id TEXT PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE,
    availability TEXT NOT NULL CHECK (availability IN ('captured','absent','unavailable')),
    prescription_json TEXT,
    provenance_json TEXT NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    adjustments_json TEXT,
    captured_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS trg_template_revisions_immutable_update
  BEFORE UPDATE ON template_revisions BEGIN SELECT RAISE(ABORT, 'Template revisions are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_routine_revisions_immutable_update
  BEFORE UPDATE ON routine_revisions BEGIN SELECT RAISE(ABORT, 'Routine revisions are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_program_revisions_immutable_update
  BEFORE UPDATE ON program_revisions BEGIN SELECT RAISE(ABORT, 'Program revisions are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_workout_intents_immutable_update
  BEFORE UPDATE ON workout_intents BEGIN SELECT RAISE(ABORT, 'Captured workout intent is immutable'); END;
  CREATE TABLE IF NOT EXISTS workout_intent_activities (
    workout_exercise_id TEXT PRIMARY KEY REFERENCES workout_exercises(id) ON DELETE CASCADE,
    intent_activity_id TEXT NOT NULL,
    intent_order INTEGER NOT NULL,
    execution_group_id TEXT
  );
  CREATE TABLE IF NOT EXISTS workout_intent_sets (
    set_id TEXT PRIMARY KEY REFERENCES sets(id) ON DELETE CASCADE,
    intent_set_id TEXT NOT NULL,
    target_snapshot_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workout_set_skips (
    set_id TEXT PRIMARY KEY REFERENCES sets(id) ON DELETE CASCADE,
    skipped_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS trg_workout_intent_activities_immutable_update
  BEFORE UPDATE ON workout_intent_activities BEGIN SELECT RAISE(ABORT, 'Captured activity intent is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_workout_intent_sets_immutable_update
  BEFORE UPDATE ON workout_intent_sets BEGIN SELECT RAISE(ABORT, 'Captured set intent is immutable'); END;
  CREATE INDEX IF NOT EXISTS idx_template_revisions_template ON template_revisions(template_id, revision_num);
  CREATE INDEX IF NOT EXISTS idx_routine_revisions_routine ON routine_revisions(routine_id, revision_num);
  CREATE INDEX IF NOT EXISTS idx_program_revisions_program ON program_revisions(program_id, revision_num);
  CREATE INDEX IF NOT EXISTS idx_training_plans_program ON training_plans(program_id, active);
  CREATE INDEX IF NOT EXISTS idx_training_plan_bindings_routine ON training_plan_bindings(routine_id);
  CREATE INDEX IF NOT EXISTS idx_workout_intents_availability ON workout_intents(availability);
  CREATE TABLE IF NOT EXISTS prescription_previews (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('template_adoption','program_adoption')),
    owner_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`

/** Idempotent, retryable schema setup for workout recovery and finish receipts. */
export async function migrateWorkout(db: DbAdapter): Promise<void> {
  await db.exec(WORKOUT_DDL)
  const activityColumns = await db.queryAll<{ name: string }>(
    'PRAGMA table_info(workout_exercises)',
  )
  if (!activityColumns.some((column) => column.name === 'logging_mode')) {
    await db.exec(
      "ALTER TABLE workout_exercises ADD COLUMN logging_mode TEXT NOT NULL DEFAULT 'strength'",
    )
    await db.exec(`UPDATE workout_exercises SET logging_mode=COALESCE(
      (SELECT json_extract(activity.value,'$.loggingMode')
       FROM workout_intent_activities link JOIN workout_intents intent ON intent.workout_id=workout_exercises.workout_id
       JOIN json_each(intent.prescription_json,'$.activities') activity ON json_extract(activity.value,'$.id')=link.intent_activity_id
       WHERE link.workout_exercise_id=workout_exercises.id),
      (SELECT logging_mode FROM exercises WHERE id=workout_exercises.exercise_id AND logging_mode IN ('strength','cardio','distance')),'strength')`)
  }
  await db.exec(`UPDATE workout_exercises SET logging_mode=COALESCE(
    (SELECT logging_mode FROM exercises WHERE id=workout_exercises.exercise_id AND logging_mode IN ('strength','cardio','distance')),'strength')
    WHERE logging_mode IS NULL OR logging_mode NOT IN ('strength','cardio','distance')`)
  for (const [table, additions] of Object.entries({
    workouts: { title: 'TEXT', correction_version: 'INTEGER NOT NULL DEFAULT 0' },
    workout_exercises: { removed_at: 'TEXT', removed_by_correction_id: 'TEXT' },
    sets: { removed_at: 'TEXT', removed_by_correction_id: 'TEXT' },
  })) {
    const columns = new Set(
      (await db.queryAll<{ name: string }>(`PRAGMA table_info(${table})`)).map(
        (column) => column.name,
      ),
    )
    for (const [column, definition] of Object.entries(additions)) {
      if (!columns.has(column))
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
}

export async function migrateHistoryCorrection(db: DbAdapter): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS history_correction_previews (
      id TEXT PRIMARY KEY,
      workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history_corrections (
      id TEXT PRIMARY KEY,
      workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      base_version INTEGER NOT NULL,
      operation_json TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
}
