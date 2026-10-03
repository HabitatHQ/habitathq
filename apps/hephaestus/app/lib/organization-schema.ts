import type { DbAdapter } from '@palladium/core'

export const ORGANIZATION_DDL = `
CREATE TABLE IF NOT EXISTS organization_appointments (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES training_plans(id), routine_id TEXT NOT NULL,
 original_date TEXT NOT NULL, planned_date TEXT NOT NULL, planned_time TEXT,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','fulfilled','skipped')),
 workout_id TEXT, postponed INTEGER NOT NULL DEFAULT 0 CHECK(postponed IN (0,1)),
 created_at TEXT NOT NULL,
 occurrence_key TEXT,
 source_kind TEXT NOT NULL DEFAULT 'manual' CHECK(source_kind IN ('manual','recurrence','program')),
 source_id TEXT,
 original_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_org_appointment_workout ON organization_appointments(workout_id) WHERE workout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_appointment_date ON organization_appointments(status,planned_date,planned_time);
CREATE INDEX IF NOT EXISTS idx_org_appointment_routine ON organization_appointments(routine_id,planned_date);
CREATE TABLE IF NOT EXISTS organization_recurrence_rules (
 id TEXT PRIMARY KEY,
 plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
 routine_id TEXT NOT NULL,
 weekdays_json TEXT NOT NULL,
 start_date TEXT NOT NULL,
 end_date TEXT,
 planned_time TEXT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_recurrence_active ON organization_recurrence_rules(active,plan_id,start_date,end_date);
CREATE TABLE IF NOT EXISTS organization_rotations (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES training_plans(id), name TEXT NOT NULL,
 routine_ids_json TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_rotation_advances (
 id TEXT PRIMARY KEY, rotation_id TEXT NOT NULL REFERENCES organization_rotations(id), generation INTEGER NOT NULL,
 workout_id TEXT, reason TEXT NOT NULL CHECK(reason IN ('finish','skip')), created_at TEXT NOT NULL,
 UNIQUE(rotation_id,generation), UNIQUE(rotation_id,workout_id)
);
CREATE TABLE IF NOT EXISTS organization_goals (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES training_plans(id), name TEXT NOT NULL,
 target_count INTEGER NOT NULL CHECK(target_count > 0), filter_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_goal_credits (
 goal_id TEXT NOT NULL REFERENCES organization_goals(id), workout_id TEXT NOT NULL, week_start TEXT NOT NULL,
 PRIMARY KEY(goal_id,workout_id)
);
CREATE INDEX IF NOT EXISTS idx_org_goal_week ON organization_goal_credits(goal_id,week_start);
CREATE TABLE IF NOT EXISTS organization_reviews (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('schedule','recurrence','program')),
 owner_id TEXT NOT NULL, fingerprint TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_source_links (
 workout_id TEXT PRIMARY KEY, appointment_id TEXT, rotation_id TEXT, rotation_generation INTEGER
);
`

export async function migrateOrganization(db: DbAdapter): Promise<void> {
  await db.exec(ORGANIZATION_DDL)
  const columns = async (table: string) =>
    db.queryAll<{ name: string }>('SELECT name FROM pragma_table_info(?)', [table])
  const addColumn = async (table: string, name: string, definition: string) => {
    if (!(await columns(table)).some((column) => column.name === name)) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
    }
  }
  await addColumn('organization_appointments', 'occurrence_key', 'TEXT')
  await addColumn('organization_appointments', 'source_kind', "TEXT NOT NULL DEFAULT 'manual'")
  await addColumn('organization_appointments', 'source_id', 'TEXT')
  await addColumn('organization_appointments', 'original_time', 'TEXT')
  await db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_org_appointment_occurrence ON organization_appointments(occurrence_key) WHERE occurrence_key IS NOT NULL',
  )
  const reviewColumns = await columns('organization_reviews')
  const kindColumn = reviewColumns.find((column) => column.name === 'kind')
  if (kindColumn) {
    const sql = await db.queryOne<{ sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='organization_reviews'",
    )
    if (sql?.sql?.includes("kind IN ('schedule','program')")) {
      await db.exec('ALTER TABLE organization_reviews RENAME TO organization_reviews_legacy')
      await db.exec(
        `CREATE TABLE organization_reviews (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('schedule','recurrence','program')), owner_id TEXT NOT NULL, fingerprint TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
      )
      await db.exec('INSERT INTO organization_reviews SELECT * FROM organization_reviews_legacy')
      await db.exec('DROP TABLE organization_reviews_legacy')
    }
  }
}
