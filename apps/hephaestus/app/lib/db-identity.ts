import { generateUuidV7, isUuidV7 } from '@palladium/core'
import { parseSerializablePrescription, structuralFingerprint } from '~/lib/prescription-domain'
import { programStructureHash } from '~/lib/program-structure'
import type { DbAdapter } from '~/types/database'
import type { ProgramDesign, SerializablePrescription } from '~/types/prescription'

export { generateUuidV7 }

/** Durable app entities whose primary identity participates in local capture. */
export const APP_ENTITY_TABLES = [
  'exercises',
  'templates',
  'template_exercises',
  'template_groups',
  'programs',
  'program_weeks',
  'program_days',
  'training_blocks',
  'workouts',
  'workout_exercises',
  'sets',
  'runs',
  'run_splits',
  'interval_templates',
  'body_weights',
  'body_measurements',
  'body_photos',
  'personal_records',
  'weekly_training_load',
  'workout_tags',
  'tags',
  'template_folders',
  'template_folder_items',
  'template_tags',
  'workout_finish_summaries',
  'workout_session_options',
  'workout_interval_sessions',
  'template_revisions',
  'saved_routines',
  'routine_revisions',
  'program_revisions',
  'training_plans',
  'training_plan_bindings',
  'workout_intents',
  'workout_intent_activities',
  'workout_intent_sets',
  'workout_set_skips',
  'history_corrections',
  'organization_appointments',
  'organization_recurrence_rules',
  'organization_rotations',
  'organization_rotation_advances',
  'organization_goals',
  'organization_goal_credits',
  'organization_source_links',
  'equipment_profiles',
] as const

/**
 * SQLite UUIDv7 expression usable as a DEFAULT in CREATE TABLE: epoch
 * milliseconds, the version 7 marker, the RFC 9562 variant nibble and random
 * bits. `hex()` returns upper-case digits, so the variant lookup uses the
 * upper-case alphabet and `max(1, …)` keeps the lookup inside the string.
 */
export const UUID_V7_SQL_DEFAULT =
  "(lower(substr(printf('%012x', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)), 1, 8) || '-' || substr(printf('%012x', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)), 9, 4) || '-7' || substr(hex(randomblob(2)), 2, 3) || '-' || substr('89ab', max(1, (instr('0123456789ABCDEF', substr(hex(randomblob(2)), 1, 1)) - 1) % 4 + 1), 1) || substr(hex(randomblob(2)), 2, 3) || '-' || hex(randomblob(6))))"

const JSON_IDENTITY_FIELDS = new Set([
  'id',
  'exerciseId',
  'exercise_id',
  'templateId',
  'template_id',
  'legacyTemplateId',
  'templateRevisionId',
  'template_revision_id',
  'sourceRevisionId',
  'source_revision_id',
  'routineId',
  'routine_id',
  'routineRevisionId',
  'routine_revision_id',
  'adoptedTemplateRevisionId',
  'adopted_template_revision_id',
  'currentRevisionId',
  'current_revision_id',
  'adoptedProgramRevisionId',
  'adopted_program_revision_id',
  'programId',
  'program_id',
  'programSlotId',
  'program_slot_id',
  'weekId',
  'week_id',
  'planId',
  'plan_id',
  'executionGroupId',
  'execution_group_id',
  'inputId',
  'input_id',
  'targetId',
  'target_id',
  'workoutId',
  'workout_id',
  'runId',
  'run_id',
  'appointmentId',
  'appointment_id',
  'rotationId',
  'rotation_id',
  'goalId',
  'goal_id',
  'setId',
  'set_id',
  'workoutExerciseId',
  'workout_exercise_id',
  'deloadTemplateId',
  'deload_template_id',
  'sourceId',
  'source_id',
  'templateExerciseId',
  'template_exercise_id',
  'occurrenceKey',
  'occurrence_key',
])
const JSON_IDENTITY_ARRAYS = new Set([
  'activityIds',
  'activity_ids',
  'routineIds',
  'routine_ids',
  'routine_ids_json',
  'exerciseIds',
  'exercise_ids',
  'excludedExerciseIds',
  'excluded_exercise_ids',
  'filterExerciseIds',
  'filter_exercise_ids',
  'substitutes',
])
const JSON_COLUMNS = new Set([
  'muscles',
  'muscles_sec',
  'scheduled_days',
  'prescription_json',
  'provenance_json',
  'inputs_json',
  'adjustments_json',
  'design_json',
  'legacy_state_json',
  'filter_json',
  'routine_ids_json',
  'snapshot_json',
  'summary_json',
  'target_snapshot_json',
  'config_json',
  'intervals',
  'operation_json',
  'additional_loads_kg',
  'substitutes',
  'set_rest_seconds',
  'rpe_targets',
  'progression_rule',
])
const SOFT_REFERENCE_COLUMNS = new Set([
  'exercise_id',
  'template_id',
  'program_id',
  'week_id',
  'workout_id',
  'workout_exercise_id',
  'run_id',
  'set_id',
  'template_revision_id',
  'adopted_template_revision_id',
  'current_revision_id',
  'adopted_program_revision_id',
  'routine_id',
  'routine_revision_id',
  'plan_id',
  'program_slot_id',
  'rotation_id',
  'goal_id',
  'appointment_id',
  'source_id',
  'deload_template_id',
  'owner_id',
  'legacy_template_id',
  'intent_activity_id',
  'intent_set_id',
  'execution_group_id',
])
/**
 * Natural identity of the durable tables that carry a composite or single-column
 * primary key instead of a surrogate id. The key doubles as the stable identity
 * source for legacy rows and for imports that omit the surrogate id.
 */
const NATURAL_IDENTITY_KEYS: Record<string, string[]> = {
  weekly_training_load: ['week'],
  workout_tags: ['workout_id', 'tag_id'],
  template_folder_items: ['template_id', 'folder_id'],
  template_tags: ['template_id', 'tag_id'],
  workout_finish_summaries: ['workout_id'],
  workout_session_options: ['workout_id'],
  workout_interval_sessions: ['workout_id'],
  workout_intents: ['workout_id'],
  workout_intent_activities: ['workout_exercise_id'],
  workout_intent_sets: ['set_id'],
  workout_set_skips: ['set_id'],
  equipment_profiles: ['exercise_id'],
  organization_goal_credits: ['goal_id', 'workout_id'],
  organization_source_links: ['workout_id'],
}
/** Identity conversion invalidates preview fingerprints; ordinary startup must preserve them. */
const TRANSIENT_PREVIEW_TABLES = [
  'prescription_previews',
  'history_correction_previews',
  'routine_update_previews',
  'organization_reviews',
]
/**
 * Immutability protections are lifted for the duration of the migration and
 * restored afterwards. The identity fill of a captured row is the only update
 * they tolerate, because the surrogate identity does not exist yet.
 */
const IMMUTABLE_TRIGGERS: Array<{ name: string; table: string; sql: string }> = [
  {
    name: 'trg_template_revisions_immutable_update',
    table: 'template_revisions',
    sql: "CREATE TRIGGER trg_template_revisions_immutable_update BEFORE UPDATE ON template_revisions BEGIN SELECT RAISE(ABORT, 'Template revisions are immutable'); END;",
  },
  {
    name: 'trg_routine_revisions_immutable_update',
    table: 'routine_revisions',
    sql: "CREATE TRIGGER trg_routine_revisions_immutable_update BEFORE UPDATE ON routine_revisions BEGIN SELECT RAISE(ABORT, 'Routine revisions are immutable'); END;",
  },
  {
    name: 'trg_program_revisions_immutable_update',
    table: 'program_revisions',
    sql: "CREATE TRIGGER trg_program_revisions_immutable_update BEFORE UPDATE ON program_revisions BEGIN SELECT RAISE(ABORT, 'Program revisions are immutable'); END;",
  },
  {
    name: 'trg_workout_intents_immutable_update',
    table: 'workout_intents',
    sql: "CREATE TRIGGER trg_workout_intents_immutable_update BEFORE UPDATE ON workout_intents WHEN NOT (NEW.id IS NOT OLD.id AND OLD.id IS NULL AND NEW.workout_id IS OLD.workout_id AND NEW.availability IS OLD.availability AND NEW.prescription_json IS OLD.prescription_json AND NEW.provenance_json IS OLD.provenance_json AND NEW.inputs_json IS OLD.inputs_json AND NEW.adjustments_json IS OLD.adjustments_json AND NEW.captured_at IS OLD.captured_at) BEGIN SELECT RAISE(ABORT, 'Captured workout intent is immutable'); END;",
  },
  {
    name: 'trg_workout_intent_activities_immutable_update',
    table: 'workout_intent_activities',
    sql: "CREATE TRIGGER trg_workout_intent_activities_immutable_update BEFORE UPDATE ON workout_intent_activities WHEN NOT (NEW.id IS NOT OLD.id AND OLD.id IS NULL AND NEW.workout_exercise_id IS OLD.workout_exercise_id AND NEW.intent_activity_id IS OLD.intent_activity_id AND NEW.intent_order IS OLD.intent_order AND NEW.execution_group_id IS OLD.execution_group_id) BEGIN SELECT RAISE(ABORT, 'Captured activity intent is immutable'); END;",
  },
  {
    name: 'trg_workout_intent_sets_immutable_update',
    table: 'workout_intent_sets',
    sql: "CREATE TRIGGER trg_workout_intent_sets_immutable_update BEFORE UPDATE ON workout_intent_sets WHEN NOT (NEW.id IS NOT OLD.id AND OLD.id IS NULL AND NEW.set_id IS OLD.set_id AND NEW.intent_set_id IS OLD.intent_set_id AND NEW.target_snapshot_json IS OLD.target_snapshot_json) BEGIN SELECT RAISE(ABORT, 'Captured set intent is immutable'); END;",
  },
]
const LEGACY_HASH = 0x811c9dc5

interface TableColumn {
  name: string
  pk: number
  dflt_value: unknown
}

/** Deterministic UUIDv7 derived from a legacy identifier, so retries never churn ids. */
export function stableLegacyUuidV7(value: string): string {
  const hashes = [LEGACY_HASH, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    for (let part = 0; part < hashes.length; part++) {
      const valueAt = hashes[part] ?? 0
      hashes[part] =
        Math.imul(valueAt ^ (code + part * 31), part % 2 ? 0x85ebca6b : 0x01000193) >>> 0
    }
  }
  const timestamp = Date.UTC(2000, 0, 1).toString(16).padStart(12, '0')
  const random = hashes.map((valueAt) => valueAt.toString(16).padStart(8, '0')).join('')
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(1, 4)}-${((Number.parseInt(random[4] ?? '8', 16) & 3) | 8).toString(16)}${random.slice(5, 8)}-${random.slice(8, 20)}`
}

/** Deterministic UUIDv7 for a natural-key row, matching the identity the migration assigns. */
export function naturalRowUuidV7(table: string, row: Record<string, unknown>): string {
  const keyColumns = NATURAL_IDENTITY_KEYS[table]
  if (!keyColumns) throw new Error(`No stable natural identity contract for ${table}.`)
  return stableLegacyUuidV7(`${table}:${JSON.stringify(keyColumns.map((column) => row[column]))}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function remapJson(value: unknown, identities: Map<string, string>, key = ''): unknown {
  if (typeof value === 'string' && (key === 'occurrenceKey' || key === 'occurrence_key')) {
    let result = value
    for (const [legacy, id] of identities)
      if (!legacy.includes(':')) result = result.replaceAll(legacy, id)
    return result
  }
  if (typeof value === 'string' && JSON_IDENTITY_FIELDS.has(key))
    return identities.get(value) ?? value
  if (Array.isArray(value)) {
    if (JSON_IDENTITY_ARRAYS.has(key))
      return value.map((entry) =>
        typeof entry === 'string' ? (identities.get(entry) ?? entry) : entry,
      )
    return value.map((entry) => remapJson(entry, identities))
  }
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [
      childKey,
      remapJson(child, identities, childKey),
    ]),
  )
}

async function tableColumns(db: DbAdapter, table: string): Promise<TableColumn[]> {
  return db.queryAll<TableColumn>(`PRAGMA table_info("${table}")`)
}

async function dropImmutableTriggers(db: DbAdapter): Promise<void> {
  for (const trigger of IMMUTABLE_TRIGGERS) await db.exec(`DROP TRIGGER IF EXISTS ${trigger.name};`)
}

async function restoreImmutableTriggers(db: DbAdapter): Promise<void> {
  for (const trigger of IMMUTABLE_TRIGGERS) {
    const exists = await db.queryOne<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [trigger.table],
    )
    if (!exists) continue
    await db.exec(trigger.sql)
  }
}

/** Legacy identifiers of every durable row that is not a UUIDv7 yet. */
async function collectLegacyIdentities(db: DbAdapter): Promise<Map<string, string>> {
  const identities = new Map<string, string>()
  for (const table of APP_ENTITY_TABLES) {
    const columns = await tableColumns(db, table)
    if (columns.length === 0) continue
    if (!columns.some((column) => column.name === 'id')) continue
    const rows = await db.queryAll<{ id: string }>(`SELECT id FROM "${table}" WHERE id IS NOT NULL`)
    for (const row of rows) {
      if (isUuidV7(row.id)) continue
      if (identities.has(row.id)) continue
      identities.set(row.id, stableLegacyUuidV7(row.id))
    }
  }
  return identities
}

function primaryKeyColumns(columns: TableColumn[]): string[] {
  return columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name)
}

/**
 * Adds the surrogate identity column to durable natural-key tables that predate
 * it and backfills every row from its natural key, so the same row always
 * resolves to the same identity after a migration or a restore.
 */
async function ensureIdentityColumns(db: DbAdapter): Promise<void> {
  for (const table of APP_ENTITY_TABLES) {
    const columns = await tableColumns(db, table)
    if (columns.length === 0) continue
    if (columns.some((column) => column.name === 'id')) continue
    await db.exec(`ALTER TABLE "${table}" ADD COLUMN id TEXT`)
    await backfillNaturalIdentities(db, table, columns)
  }
}

async function backfillNaturalIdentities(
  db: DbAdapter,
  table: string,
  columns: TableColumn[],
): Promise<void> {
  const keyColumns = NATURAL_IDENTITY_KEYS[table] ?? primaryKeyColumns(columns)
  if (keyColumns.length === 0)
    throw new Error(`Cannot derive stable identity for ${table} without a primary key.`)
  const rows = await db.queryAll<Record<string, unknown>>(`SELECT rowid, * FROM "${table}"`)
  for (const row of rows) {
    const key = JSON.stringify(keyColumns.map((column) => row[column]))
    await db.exec(`UPDATE "${table}" SET id=? WHERE rowid=?`, [
      stableLegacyUuidV7(`${table}:${key}`),
      row['rowid'],
    ])
  }
}

/** Bulk-lookup table that turns per-identifier updates into one statement per column. */
async function installIdentityMap(db: DbAdapter, identities: Map<string, string>): Promise<void> {
  await db.exec(
    'CREATE TEMP TABLE IF NOT EXISTS _hephaestus_identity_map (legacy TEXT PRIMARY KEY, canonical TEXT NOT NULL); DELETE FROM _hephaestus_identity_map;',
  )
  const entries = [...identities.entries()]
  const chunkSize = 500
  for (let index = 0; index < entries.length; index += chunkSize) {
    const chunk = entries.slice(index, index + chunkSize)
    await db.exec(
      `INSERT INTO _hephaestus_identity_map (legacy, canonical) VALUES ${chunk.map(() => '(?, ?)').join(', ')}`,
      chunk.flat(),
    )
  }
}

async function referenceColumns(
  db: DbAdapter,
  table: string,
  names: Set<string>,
): Promise<string[]> {
  const columns = new Set([...names].filter((name) => SOFT_REFERENCE_COLUMNS.has(name)))
  const foreignKeys = await db.queryAll<{ from: string; table: string; to: string }>(
    `PRAGMA foreign_key_list("${table}")`,
  )
  for (const reference of foreignKeys) {
    if (reference.to !== 'id') continue
    if (!APP_ENTITY_TABLES.includes(reference.table as (typeof APP_ENTITY_TABLES)[number])) continue
    columns.add(reference.from)
  }
  return [...columns]
}

async function rewriteReferenceColumns(
  db: DbAdapter,
  table: string,
  columns: string[],
): Promise<void> {
  for (const column of columns)
    await db.exec(
      `UPDATE "${table}" SET "${column}"=(SELECT canonical FROM _hephaestus_identity_map WHERE legacy="${table}"."${column}") WHERE "${column}" IN (SELECT legacy FROM _hephaestus_identity_map)`,
    )
}

async function rewriteOccurrenceKeys(
  db: DbAdapter,
  table: string,
  identities: Map<string, string>,
): Promise<void> {
  const rows = await db.queryAll<{ rowid: number; value: string }>(
    `SELECT rowid, occurrence_key AS value FROM "${table}" WHERE occurrence_key IS NOT NULL`,
  )
  for (const row of rows) {
    let next = row.value
    for (const [legacy, canonical] of identities) {
      if (legacy.includes(':')) continue
      if (next.includes(legacy)) next = next.replaceAll(legacy, canonical)
    }
    if (next === row.value) continue
    await db.exec(`UPDATE "${table}" SET occurrence_key=? WHERE rowid=?`, [next, row.rowid])
  }
}

async function rewriteJsonColumns(
  db: DbAdapter,
  table: string,
  columns: TableColumn[],
  identities: Map<string, string>,
): Promise<void> {
  for (const column of columns) {
    if (!JSON_COLUMNS.has(column.name)) continue
    await rewriteJsonColumn(db, table, column.name, identities)
  }
}

async function rewriteJsonColumn(
  db: DbAdapter,
  table: string,
  column: string,
  identities: Map<string, string>,
): Promise<void> {
  const rows = await db.queryAll<{ rowid: number; value: string }>(
    `SELECT rowid, "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`,
  )
  for (const row of rows) {
    const parsed = parseJson(row.value)
    if (parsed === undefined) continue
    const remapped = remapJson(remapInputKeys(column, parsed, identities), identities, column)
    const next = JSON.stringify(remapped)
    if (next === row.value) continue
    await db.exec(`UPDATE "${table}" SET "${column}"=? WHERE rowid=?`, [next, row.rowid])
    await refreshStructureHash(db, table, column, remapped, row.rowid)
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Captured inputs are keyed by the identifier that produced them. */
function remapInputKeys(column: string, parsed: unknown, identities: Map<string, string>): unknown {
  if (column !== 'inputs_json') return parsed
  if (!isPlainObject(parsed)) return parsed
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [identities.get(key) ?? key, value]),
  )
}

/** Structural fingerprints cover the remapped payload, so they are refreshed with it. */
async function refreshStructureHash(
  db: DbAdapter,
  table: string,
  column: string,
  remapped: unknown,
  rowid: number,
): Promise<void> {
  if (table === 'template_revisions' || table === 'routine_revisions') {
    if (column !== 'prescription_json') return
    const prescription = parsePrescription(remapped)
    if (!prescription) return
    const hash = structuralFingerprint(prescription)
    await db.exec(`UPDATE "${table}" SET structure_hash=? WHERE rowid=?`, [hash, rowid])
    return
  }
  if (table !== 'program_revisions' || column !== 'design_json') return
  const design = remapped as ProgramDesign
  if (!Array.isArray(design?.slots)) return
  const hash = programStructureHash(design)
  await db.exec(`UPDATE "${table}" SET structure_hash=? WHERE rowid=?`, [hash, rowid])
}

/**
 * A payload that no longer parses was already unreadable before the migration,
 * so its stored fingerprint is kept instead of blocking the whole upgrade.
 */
function parsePrescription(remapped: unknown): SerializablePrescription | null {
  try {
    return parseSerializablePrescription(remapped)
  } catch {
    return null
  }
}

/** Rewrites every soft reference, occurrence key and identity-bearing payload of one table. */
async function rewriteTableReferences(
  db: DbAdapter,
  table: string,
  identities: Map<string, string>,
): Promise<void> {
  if (identities.size === 0) return
  const columns = await tableColumns(db, table)
  if (columns.length === 0) return
  const names = new Set(columns.map((column) => column.name))
  await rewriteReferenceColumns(db, table, await referenceColumns(db, table, names))
  if (names.has('occurrence_key')) await rewriteOccurrenceKeys(db, table, identities)
  await rewriteJsonColumns(db, table, columns, identities)
}

/** Completes the identity of one table: fills gaps, applies the map and guards uniqueness. */
async function finalizeTableIdentity(
  db: DbAdapter,
  table: string,
  hasLegacyIdentities: boolean,
): Promise<void> {
  const columns = await tableColumns(db, table)
  if (columns.length === 0) return
  const idColumn = columns.find((column) => column.name === 'id')
  if (!idColumn) return
  await backfillNullIdentities(db, table, columns)
  if (hasLegacyIdentities)
    await db.exec(
      `UPDATE "${table}" SET id=(SELECT canonical FROM _hephaestus_identity_map WHERE legacy="${table}".id) WHERE id IN (SELECT legacy FROM _hephaestus_identity_map)`,
    )
  // Identity columns added by the migration have no default, so inserts that omit
  // the identity are filled by a trigger and guarded by a unique index.
  if (idColumn.dflt_value !== null) return
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_identity" ON "${table}"(id)`)
  await db.exec(
    `CREATE TRIGGER IF NOT EXISTS "trg_${table}_identity_default" AFTER INSERT ON "${table}" WHEN NEW.id IS NULL BEGIN UPDATE "${table}" SET id=${UUID_V7_SQL_DEFAULT} WHERE rowid=NEW.rowid; END`,
  )
}

async function backfillNullIdentities(
  db: DbAdapter,
  table: string,
  columns: TableColumn[],
): Promise<void> {
  const pkNames = primaryKeyColumns(columns).filter((name) => name !== 'id')
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT rowid, * FROM "${table}" WHERE id IS NULL`,
  )
  for (const row of rows) {
    const key = JSON.stringify(pkNames.length ? pkNames.map((name) => row[name]) : [row['rowid']])
    await db.exec(`UPDATE "${table}" SET id=? WHERE rowid=?`, [
      stableLegacyUuidV7(`${table}:${key}`),
      row['rowid'],
    ])
  }
}

/** Drop stale references and fingerprints only when durable identities changed. */
async function clearTransientPreviews(db: DbAdapter): Promise<void> {
  for (const table of TRANSIENT_PREVIEW_TABLES) {
    const exists = await db.queryOne<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [table],
    )
    if (exists) await db.exec(`DELETE FROM "${table}"`)
  }
}

/**
 * Rewrites durable identities to UUIDv7 in place, remapping every reference.
 * The caller owns the surrounding transaction (startup, restore or capture boundary).
 */
export async function migrateAppIdentities(db: DbAdapter): Promise<void> {
  await db.exec('PRAGMA defer_foreign_keys = ON')
  await dropImmutableTriggers(db)
  const identities = await collectLegacyIdentities(db)
  await ensureIdentityColumns(db)
  await installIdentityMap(db, identities)
  for (const table of APP_ENTITY_TABLES) {
    await rewriteTableReferences(db, table, identities)
    await finalizeTableIdentity(db, table, identities.size > 0)
  }
  await db.exec('DROP TABLE IF EXISTS _hephaestus_identity_map')
  await restoreImmutableTriggers(db)
  if (identities.size > 0) await clearTransientPreviews(db)
}
