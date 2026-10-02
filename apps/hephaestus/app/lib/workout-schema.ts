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
`

/** Idempotent, retryable schema setup for workout recovery and finish receipts. */
export async function migrateWorkout(db: DbAdapter): Promise<void> {
  await db.exec(WORKOUT_DDL)
}
