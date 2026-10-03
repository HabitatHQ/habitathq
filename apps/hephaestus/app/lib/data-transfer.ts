import {
  parseSerializablePrescription,
  structuralFingerprint,
  validateRoutineInputs,
} from '~/lib/prescription-domain'
import { validatePrescriptionExpressions } from '~/lib/prescription-evaluator'
import { migratePrescriptionDomain } from '~/lib/prescription-storage'
import { type LegacyTemplatePayload, parseLegacyTemplatePayload } from '~/lib/template-export'
import type { DbAdapter } from '~/types/database'
import type { ProgramDesign } from '~/types/prescription'

export const BACKUP_FORMAT = 'hephaestus-backup'
export const BACKUP_VERSION = 2
export const PORTABLE_FORMAT = 'hephaestus-portable'
export const PORTABLE_VERSION = 2

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  settings: unknown
  tables: Record<string, { columns: string[]; rows: Array<Record<string, unknown>> }>
}

export interface RestorePreview {
  valid: boolean
  exportedAt?: string
  workoutCount?: number
  templateCount?: number
  programCount?: number
  routineCount?: number
  planCount?: number
  organizationCount?: number
  catalogExerciseReuseCount?: number
  rowCount?: number
  restoreMode?: 'replace' | 'additive'
  legacy?: boolean
  error?: string
}

interface SqliteTable {
  name: string
}

interface SqliteColumn {
  name: string
  notnull: number
  pk: number
  dflt_value: unknown
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const EXCLUDED_TABLE_PREFIXES = ['sqlite_', '_palladium', 'palladium_', '_sync_']

function isTransferObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function quoteIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`Unsafe SQLite identifier: ${value}`)
  return `"${value}"`
}

function isTransferTable(name: string): boolean {
  return (
    SAFE_IDENTIFIER.test(name) &&
    !EXCLUDED_TABLE_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
    name !== 'sqlite_sequence'
  )
}

async function discoverTables(db: DbAdapter): Promise<string[]> {
  const rows = await db.queryAll<SqliteTable>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  )
  return rows.map((row) => row.name).filter(isTransferTable)
}

async function columnsFor(db: DbAdapter, table: string): Promise<SqliteColumn[]> {
  const rows = await db.queryAll<SqliteColumn>(`PRAGMA table_info(${quoteIdentifier(table)})`)
  if (rows.length === 0) throw new Error(`Backup table does not exist: ${table}`)
  return rows
}

function validateBackupColumns(name: string, columns: unknown): string[] {
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    !columns.every(
      (column): column is string => typeof column === 'string' && SAFE_IDENTIFIER.test(column),
    ) ||
    new Set(columns).size !== columns.length
  ) {
    throw new Error(`Invalid column list for ${name}.`)
  }
  return columns
}

function validateBackupRow(
  name: string,
  columns: string[],
  candidate: unknown,
): Record<string, unknown> {
  if (!isTransferObject(candidate)) throw new Error(`Invalid row in ${name}.`)
  const keys = Object.keys(candidate)
  if (keys.length !== columns.length || keys.some((column) => !columns.includes(column))) {
    throw new Error(`Missing or unexpected column in ${name}.`)
  }
  if (
    Object.values(candidate).some(
      (cell) =>
        cell !== null &&
        ((typeof cell !== 'string' && typeof cell !== 'number') ||
          (typeof cell === 'number' && !Number.isFinite(cell))),
    )
  ) {
    throw new Error(`Unsupported cell value in ${name}.`)
  }
  return candidate
}

function validateBackupTable(name: string, candidate: unknown): BackupEnvelope['tables'][string] {
  if (!isTransferTable(name) || !isTransferObject(candidate)) {
    throw new Error(`Invalid backup table: ${name}`)
  }
  const columns = validateBackupColumns(name, candidate['columns'])
  const candidateRows = candidate['rows']
  if (!Array.isArray(candidateRows)) throw new Error(`Invalid rows for ${name}.`)
  return { columns, rows: candidateRows.map((row) => validateBackupRow(name, columns, row)) }
}

function validateBackup(value: unknown): { backup: BackupEnvelope; rowCount: number } {
  if (
    !isTransferObject(value) ||
    value['format'] !== BACKUP_FORMAT ||
    ![1, BACKUP_VERSION].includes(Number(value['version']))
  ) {
    throw new Error('Unsupported or malformed backup format/version.')
  }
  const exportedAt = value['exportedAt']
  if (typeof exportedAt !== 'string' || !Number.isFinite(Date.parse(exportedAt))) {
    throw new Error('Backup export timestamp is invalid.')
  }
  const candidateTables = value['tables']
  if (!isTransferObject(candidateTables)) throw new Error('Backup tables are missing.')
  const tables: BackupEnvelope['tables'] = {}
  let rowCount = 0
  for (const [name, candidate] of Object.entries(candidateTables)) {
    const table = validateBackupTable(name, candidate)
    tables[name] = table
    rowCount += table.rows.length
  }
  return {
    backup: {
      format: BACKUP_FORMAT,
      version: Number(value['version']),
      exportedAt,
      settings: value['settings'],
      tables,
    },
    rowCount,
  }
}

async function exportBackup(db: DbAdapter, settings: unknown): Promise<BackupEnvelope> {
  const validatedSettings = parseBackupSettings(settings)
  const tables: BackupEnvelope['tables'] = {}
  for (const name of await discoverTables(db)) {
    const columns = await columnsFor(db, name)
    const names = columns.map((column) => column.name)
    const rows = await db.queryAll<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(name)}`,
    )
    tables[name] = { columns: names, rows }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: validatedSettings,
    tables,
  }
}

export interface WorkoutCsvRow {
  date: string
  session_type: string
  started_at: string
  ended_at: string
  exercise_name: string | null
  set_num: number | null
  weight_kg: number | null
  reps: number | null
  distance_m: number | null
  duration_sec: number | null
  notes: string | null
}

export function buildWorkoutCsv(rows: WorkoutCsvRow[]): string {
  const columns: Array<keyof WorkoutCsvRow> = [
    'date',
    'session_type',
    'started_at',
    'ended_at',
    'exercise_name',
    'set_num',
    'weight_kg',
    'reps',
    'distance_m',
    'duration_sec',
    'notes',
  ]
  const csvCell = (value: string | number | null): string => {
    const text = value === null ? '\\N' : String(value)
    return /[",\r\n]/.test(text) || text === '' ? `"${text.replaceAll('"', '""')}"` : text
  }
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\r\n')
}

function parseBackupSettings(settings: unknown): AppSettings {
  if (!isTransferObject(settings)) throw new Error('Backup app settings are missing.')
  const booleanKeys = [
    'use24HourTime',
    'reduceMotion',
    'showRpe',
    'showRir',
    'showWarmupSuggestions',
    'showFailurePrompt',
    'showSessionNotes',
    'showSetSchemes',
    'showVariableRest',
    'showSupersets',
  ]
  const allowed = new Set([
    'theme',
    'weightUnit',
    'distanceUnit',
    'use24HourTime',
    'reduceMotion',
    'defaultRestSeconds',
    'showRpe',
    'showRir',
    'warmupRamps',
    'showWarmupSuggestions',
    'showFailurePrompt',
    'showSessionNotes',
    'showSetSchemes',
    'showVariableRest',
    'showSupersets',
  ])
  if (Object.keys(settings).length !== allowed.size) {
    throw new Error('Backup app settings are incomplete.')
  }
  if (Object.keys(settings).some((key) => !allowed.has(key))) {
    throw new Error('Backup contains unsupported app settings.')
  }
  if (!['hephaestus', 'forge', 'daylight'].includes(String(settings['theme']))) {
    throw new Error('Backup theme setting is invalid.')
  }
  if (!['kg', 'lbs'].includes(String(settings['weightUnit']))) {
    throw new Error('Backup weight unit is invalid.')
  }
  if (!['km', 'mi'].includes(String(settings['distanceUnit']))) {
    throw new Error('Backup distance unit is invalid.')
  }
  for (const key of booleanKeys) {
    if (typeof settings[key] !== 'boolean') throw new Error(`Backup setting ${key} is invalid.`)
  }
  const rest = settings['defaultRestSeconds']
  const ramps = settings['warmupRamps']
  if (typeof rest !== 'number' || !Number.isFinite(rest) || rest < 1 || rest > 3600) {
    throw new Error('Backup default rest setting is invalid.')
  }
  if (
    !Array.isArray(ramps) ||
    ramps.length === 0 ||
    ramps.length > 10 ||
    ramps.some(
      (ramp) => typeof ramp !== 'number' || !Number.isFinite(ramp) || ramp <= 0 || ramp >= 100,
    )
  ) {
    throw new Error('Backup warm-up ramps are invalid.')
  }
  // Every key and value was checked above; return a detached settings snapshot.
  return structuredClone(settings) as unknown as AppSettings
}

export function parseBackupSettingsFromEnvelope(input: unknown): AppSettings {
  return parseBackupSettings(validateBackup(input).backup.settings)
}
function validateBackupTableColumns(
  name: string,
  table: BackupEnvelope['tables'][string],
  metadata: SqliteColumn[],
  version: number,
): void {
  const hasUnsupportedColumn = table.columns.some(
    (column) => !metadata.some((item) => item.name === column),
  )
  const hasDuplicateColumn = new Set(table.columns).size !== table.columns.length
  const isIncompleteCurrentSchema =
    version >= 2 &&
    (table.columns.length !== metadata.length ||
      metadata.some((column) => !table.columns.includes(column.name)))
  if (hasUnsupportedColumn || hasDuplicateColumn || isIncompleteCurrentSchema)
    throw new Error(`Backup does not contain the complete supported schema for ${name}.`)
}

function validateRequiredBackupValues(
  name: string,
  rows: Array<Record<string, unknown>>,
  metadata: SqliteColumn[],
  version: number,
): void {
  for (const row of rows)
    for (const column of metadata)
      if (
        !Object.hasOwn(row, column.name) &&
        (version >= 2 || (column.notnull === 1 && column.dflt_value === null))
      )
        throw new Error(`Required backup value is missing for ${name}.${column.name}.`)
}

async function validateBackupSchema(db: DbAdapter, backup: BackupEnvelope): Promise<void> {
  const current = new Set(await discoverTables(db))
  const included = new Set(Object.keys(backup.tables))
  for (const name of current)
    if (backup.version >= 2 && !included.has(name))
      throw new Error(`Backup is missing supported app table ${name}.`)
  for (const [name, table] of Object.entries(backup.tables)) {
    if (!current.has(name))
      throw new Error(`This app version does not support backup table ${name}.`)
    const metadata = await columnsFor(db, name)
    validateBackupTableColumns(name, table, metadata, backup.version)
    validateRequiredBackupValues(name, table.rows, metadata, backup.version)
    validateBackupValues(
      name,
      table.rows,
      metadata.filter((column) => table.columns.includes(column.name)),
    )
  }
}

function validateBackupValues(
  name: string,
  rows: Array<Record<string, unknown>>,
  metadata: SqliteColumn[],
): void {
  for (const row of rows) {
    for (const column of metadata) {
      const cell = row[column.name]
      if (cell === null && (column.notnull === 1 || column.pk > 0)) {
        throw new Error(`Required backup value is missing for ${name}.${column.name}.`)
      }
      if (cell !== null && typeof cell !== 'string' && typeof cell !== 'number') {
        throw new Error(`Invalid data for ${name}.${column.name}.`)
      }
    }
  }
}

function validateBackupOrganizationGraph(
  rows: (table: string) => Array<Record<string, unknown>>,
  plans: Set<string>,
  routines: Map<string, Record<string, unknown>>,
): void {
  for (const table of [
    'organization_appointments',
    'organization_recurrence_rules',
    'organization_rotations',
    'organization_goals',
  ])
    for (const row of rows(table))
      if (!plans.has(String(row['plan_id'])))
        throw new Error(`Backup ${table} row has no training plan.`)
  for (const row of rows('organization_appointments'))
    if (!routines.has(String(row['routine_id'])))
      throw new Error('Backup appointment has no routine.')
  for (const row of rows('organization_recurrence_rules'))
    if (!routines.has(String(row['routine_id'])))
      throw new Error('Backup recurrence rule has no routine.')
  for (const row of rows('organization_rotations')) {
    const routineIds: unknown = JSON.parse(String(row['routine_ids_json']))
    if (
      !Array.isArray(routineIds) ||
      !routineIds.length ||
      routineIds.some((id) => typeof id !== 'string' || !routines.has(id))
    )
      throw new Error('Backup rotation has invalid routine references.')
  }
  for (const row of rows('organization_goal_credits'))
    if (!rows('organization_goals').some((goal) => goal['id'] === row['goal_id']))
      throw new Error('Backup goal credit has no goal.')
  const workouts = new Set(rows('workouts').map((row) => String(row['id'])))
  const appointments = new Map(
    rows('organization_appointments').map((row) => [String(row['id']), row]),
  )
  const rotations = new Map(rows('organization_rotations').map((row) => [String(row['id']), row]))
  validateBackupAppointments(rows, workouts)
  validateBackupRecurrenceRules(rows)
  validateBackupRotationAdvances(rows, rotations, workouts)
  validateBackupGoalCredits(rows, workouts)
  validateBackupSourceLinks(rows, appointments, rotations, workouts)
}

function validateBackupAppointments(
  rows: (table: string) => Array<Record<string, unknown>>,
  workouts: Set<string>,
): void {
  for (const row of rows('organization_appointments')) {
    if (row['workout_id'] !== null && !workouts.has(String(row['workout_id'])))
      throw new Error('Backup appointment refers to a missing workout.')
    if (
      row['source_kind'] === 'recurrence' &&
      !rows('organization_recurrence_rules').some((rule) => rule['id'] === row['source_id'])
    )
      throw new Error('Backup appointment refers to a missing recurrence rule.')
    if (!['manual', 'recurrence', 'program'].includes(String(row['source_kind'])))
      throw new Error('Backup appointment has an unsupported source kind.')
  }
}

function validateBackupRecurrenceRules(
  rows: (table: string) => Array<Record<string, unknown>>,
): void {
  for (const row of rows('organization_recurrence_rules')) {
    const weekdays: unknown = JSON.parse(String(row['weekdays_json']))
    if (
      !Array.isArray(weekdays) ||
      weekdays.length === 0 ||
      weekdays.some((day) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 7) ||
      new Set(weekdays).size !== weekdays.length
    )
      throw new Error('Backup recurrence rule contains invalid weekdays.')
  }
}

function validateBackupRotationAdvances(
  rows: (table: string) => Array<Record<string, unknown>>,
  rotations: Map<string, Record<string, unknown>>,
  workouts: Set<string>,
): void {
  for (const row of rows('organization_rotation_advances'))
    if (
      !rotations.has(String(row['rotation_id'])) ||
      (row['workout_id'] !== null && !workouts.has(String(row['workout_id']))) ||
      !['finish', 'skip'].includes(String(row['reason']))
    )
      throw new Error('Backup rotation advance has a dangling reference or invalid reason.')
}

function validateBackupGoalCredits(
  rows: (table: string) => Array<Record<string, unknown>>,
  workouts: Set<string>,
): void {
  for (const row of rows('organization_goal_credits'))
    if (
      !rows('organization_goals').some((goal) => goal['id'] === row['goal_id']) ||
      !workouts.has(String(row['workout_id']))
    )
      throw new Error('Backup goal credit has a dangling goal or workout reference.')
}

function validateBackupSourceLinks(
  rows: (table: string) => Array<Record<string, unknown>>,
  appointments: Map<string, Record<string, unknown>>,
  rotations: Map<string, Record<string, unknown>>,
  workouts: Set<string>,
): void {
  for (const row of rows('organization_source_links')) {
    const appointment =
      row['appointment_id'] === null ? null : appointments.get(String(row['appointment_id']))
    if (
      !workouts.has(String(row['workout_id'])) ||
      (row['appointment_id'] !== null &&
        (!appointment || appointment['workout_id'] !== row['workout_id'])) ||
      (row['rotation_id'] !== null && !rotations.has(String(row['rotation_id'])))
    )
      throw new Error('Backup organization source link has a dangling reference.')
  }
}
function validateBackupTemplateDefinitions(
  rows: (table: string) => Array<Record<string, unknown>>,
  exercises: Set<string>,
  templates: Set<string>,
): void {
  for (const row of rows('template_exercises')) {
    if (
      !templates.has(String(row['template_id'])) ||
      !exercises.has(String(row['exercise_id'])) ||
      (row['deload_template_id'] !== null && !templates.has(String(row['deload_template_id']))) ||
      (row['superset_group'] !== null &&
        !rows('template_groups').some(
          (group) =>
            group['template_id'] === row['template_id'] && group['label'] === row['superset_group'],
        ))
    )
      throw new Error('Backup template exercise has a dangling template, exercise, or group.')
    const substitutes: unknown =
      row['substitutes'] === null ? [] : JSON.parse(String(row['substitutes']))
    if (
      !Array.isArray(substitutes) ||
      substitutes.some((id) => typeof id !== 'string' || !exercises.has(id))
    )
      throw new Error('Backup template exercise has invalid substitutes.')
  }
}

function validateBackupTemplateRevisions(
  rows: (table: string) => Array<Record<string, unknown>>,
  exercises: Set<string>,
  templates: Set<string>,
): void {
  for (const row of rows('template_revisions')) {
    if (!templates.has(String(row['template_id'])))
      throw new Error('Backup template revision has no template.')
    const prescription = parseSerializablePrescription(JSON.parse(String(row['prescription_json'])))
    validatePrescriptionExpressions(prescription)
    if (prescription.activities.some((activity) => !exercises.has(activity.exerciseId)))
      throw new Error('Backup template revision refers to a missing exercise.')
    if (structuralFingerprint(prescription) !== row['structure_hash'])
      throw new Error('Backup template revision fingerprint is inconsistent.')
  }
}

function validateBackupRoutines(
  templates: Set<string>,
  templateRevisions: Map<string, Record<string, unknown>>,
  routines: Map<string, Record<string, unknown>>,
  routineRevisions: Map<string, Record<string, unknown>>,
): void {
  for (const [id, row] of routines)
    if (
      !templates.has(String(row['template_id'])) ||
      !templateRevisions.has(String(row['adopted_template_revision_id'])) ||
      routineRevisions.get(String(row['current_revision_id']))?.['routine_id'] !== id
    )
      throw new Error('Backup routine has a dangling template or revision.')
}

function validateBackupRoutineRevisions(
  rows: (table: string) => Array<Record<string, unknown>>,
  exercises: Set<string>,
  templates: Set<string>,
  templateRevisions: Map<string, Record<string, unknown>>,
  routines: Map<string, Record<string, unknown>>,
): void {
  for (const row of rows('routine_revisions')) {
    if (!routines.has(String(row['routine_id'])))
      throw new Error('Backup routine revision has no routine.')
    const prescription = parseSerializablePrescription(JSON.parse(String(row['prescription_json'])))
    validatePrescriptionExpressions(prescription)
    const inputs: unknown = JSON.parse(String(row['inputs_json']))
    if (!isTransferObject(inputs)) throw new Error('Backup routine inputs are malformed.')
    validateRoutineInputs(prescription, inputs as Record<string, number | boolean>)
    const provenance: unknown = JSON.parse(String(row['provenance_json']))
    if (
      !isTransferObject(provenance) ||
      !templates.has(String(provenance['templateId'])) ||
      !templateRevisions.has(String(provenance['adoptedTemplateRevisionId']))
    )
      throw new Error('Backup routine provenance is dangling.')
    if (prescription.activities.some((activity) => !exercises.has(activity.exerciseId)))
      throw new Error('Backup routine revision refers to a missing exercise.')
    if (structuralFingerprint(prescription) !== row['structure_hash'])
      throw new Error('Backup routine revision fingerprint is inconsistent.')
  }
}
function validateBackupProgramSlots(
  rows: (table: string) => PortableRow[],
  programs: Set<string>,
  templates: Set<string>,
  templateRevisions: Map<string, PortableRow>,
): Set<string> {
  const slots = new Set<string>()
  for (const row of rows('program_revisions')) {
    if (!programs.has(String(row['program_id'])))
      throw new Error('Backup Program revision has no Program.')
    const design = validateProgramDesign(JSON.parse(String(row['design_json'])))
    if (programStructureHash(design) !== row['structure_hash'])
      throw new Error('Backup Program revision structure fingerprint is inconsistent.')
    for (const slot of design.slots) {
      if (slots.has(slot.id)) throw new Error('Backup Program slot identity is duplicated.')
      slots.add(slot.id)
      if (slot.templateId !== null && !templates.has(slot.templateId))
        throw new Error('Backup Program slot template is dangling.')
      if (slot.templateRevisionId !== null && !templateRevisions.has(slot.templateRevisionId))
        throw new Error('Backup Program slot revision is dangling.')
    }
  }
  return slots
}

function validateBackupPlanBindings(
  rows: (table: string) => PortableRow[],
  plans: Set<string>,
  templates: Set<string>,
  routines: Map<string, PortableRow>,
  slots: Set<string>,
): void {
  for (const row of rows('training_plan_bindings')) {
    if (
      !plans.has(String(row['plan_id'])) ||
      !templates.has(String(row['template_id'])) ||
      (row['routine_id'] !== null && !routines.has(String(row['routine_id']))) ||
      !slots.has(String(row['program_slot_id']))
    )
      throw new Error('Backup training plan binding is dangling.')
  }
}

function validateBackupProgramGraph(
  rows: (table: string) => Array<Record<string, unknown>>,
  programs: Set<string>,
  programRevisions: Set<string>,
  templates: Set<string>,
  templateRevisions: Map<string, Record<string, unknown>>,
  weeks: Set<string>,
  plans: Set<string>,
  routines: Map<string, Record<string, unknown>>,
): void {
  const slots = validateBackupProgramSlots(rows, programs, templates, templateRevisions)
  for (const row of rows('program_weeks'))
    if (!programs.has(String(row['program_id'])))
      throw new Error('Backup Program week has no Program.')
  for (const row of rows('program_days'))
    if (
      !weeks.has(String(row['week_id'])) ||
      (row['template_id'] !== null && !templates.has(String(row['template_id'])))
    )
      throw new Error('Backup Program day has a dangling week or template.')
  for (const row of rows('training_plans'))
    if (
      (row['program_id'] !== null && !programs.has(String(row['program_id']))) ||
      (row['adopted_program_revision_id'] !== null &&
        !programRevisions.has(String(row['adopted_program_revision_id'])))
    )
      throw new Error('Backup training plan has a dangling Program reference.')
  validateBackupPlanBindings(rows, plans, templates, routines, slots)
}
function validateBackupDomainGraph(backup: BackupEnvelope): void {
  const rows = (table: string) => backup.tables[table]?.rows ?? []
  const exercises = new Set(rows('exercises').map((row) => String(row['id'])))
  const templates = new Set(rows('templates').map((row) => String(row['id'])))
  const templateRevisions = new Map(
    rows('template_revisions').map((row) => [String(row['id']), row]),
  )
  const routines = new Map(rows('saved_routines').map((row) => [String(row['id']), row]))
  const routineRevisions = new Map(rows('routine_revisions').map((row) => [String(row['id']), row]))
  const programs = new Set(rows('programs').map((row) => String(row['id'])))
  const programRevisions = new Set(rows('program_revisions').map((row) => String(row['id'])))
  const plans = new Set(rows('training_plans').map((row) => String(row['id'])))
  const weeks = new Set(rows('program_weeks').map((row) => String(row['id'])))
  validateBackupTemplateDefinitions(rows, exercises, templates)
  validateBackupTemplateRevisions(rows, exercises, templates)
  validateBackupRoutines(templates, templateRevisions, routines, routineRevisions)
  validateBackupRoutineRevisions(rows, exercises, templates, templateRevisions, routines)
  validateBackupProgramGraph(
    rows,
    programs,
    programRevisions,
    templates,
    templateRevisions,
    weeks,
    plans,
    routines,
  )
  validateBackupOrganizationGraph(rows, plans, routines)
}

async function preflightRestore(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  try {
    const { backup, rowCount } = validateBackup(input)
    parseBackupSettings(backup.settings)
    await validateBackupSchema(db, backup)
    if (backup.version >= 2) validateBackupDomainGraph(backup)
    return {
      valid: true,
      exportedAt: backup.exportedAt,
      workoutCount: backup.tables['workouts']?.rows.length ?? 0,
      templateCount: backup.tables['templates']?.rows.length ?? 0,
      programCount: backup.tables['programs']?.rows.length ?? 0,
      routineCount: backup.tables['saved_routines']?.rows.length ?? 0,
      planCount: backup.tables['training_plans']?.rows.length ?? 0,
      rowCount,
      restoreMode: backup.version === 1 ? 'additive' : 'replace',
      legacy: backup.version === 1,
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export interface PortableBundle {
  format: typeof PORTABLE_FORMAT
  version: number
  exportedAt: string
  tables: Record<string, Array<Record<string, unknown>>>
}

const PORTABLE_TABLES = [
  'exercises',
  'equipment_profiles',
  'templates',
  'template_revisions',
  'template_groups',
  'template_exercises',
  'programs',
  'program_weeks',
  'program_days',
  'program_revisions',
  'saved_routines',
  'routine_revisions',
  'training_plans',
  'training_plan_bindings',
  'organization_appointments',
  'organization_recurrence_rules',
  'organization_rotations',
  'organization_rotation_advances',
  'organization_goals',
  'organization_goal_credits',
  'organization_source_links',
] as const
type PortableTable = (typeof PORTABLE_TABLES)[number]
type PortableRow = Record<string, unknown>
type PortableRows = (table: PortableTable) => PortableRow[]
const PORTABLE_ENTITY_ID_TABLES = [
  'templates',
  'template_revisions',
  'template_groups',
  'template_exercises',
  'programs',
  'program_weeks',
  'program_days',
  'program_revisions',
  'saved_routines',
  'routine_revisions',
  'training_plans',
  'training_plan_bindings',
  'organization_appointments',
  'organization_recurrence_rules',
  'organization_rotations',
  'organization_rotation_advances',
  'organization_goals',
] as const

function normalizePortableTables(
  value: Record<string, unknown>,
  version: number,
): Record<string, unknown> {
  const tables = { ...value }
  if (version === 1) {
    for (const table of PORTABLE_TABLES) if (tables[table] === undefined) tables[table] = []
  }
  return tables
}

function validateProgramDesign(value: unknown): ProgramDesign {
  const exactKeys = (record: Record<string, unknown>, expected: string[]) =>
    Object.keys(record).length === expected.length &&
    expected.every((key) => Object.hasOwn(record, key))
  const validPhases = ['accumulation', 'intensification', 'deload', 'peak']
  const parseProgression = (input: unknown): boolean => {
    if (
      !isTransferObject(input) ||
      !exactKeys(input, [
        'intensityModifier',
        'volumeModifier',
        'isDeload',
        'phase',
        'legacyCurrentWeek',
      ])
    )
      return false
    return (
      typeof input['intensityModifier'] === 'number' &&
      Number.isFinite(input['intensityModifier']) &&
      input['intensityModifier'] >= 0 &&
      typeof input['volumeModifier'] === 'number' &&
      Number.isFinite(input['volumeModifier']) &&
      input['volumeModifier'] >= 0 &&
      typeof input['isDeload'] === 'boolean' &&
      (input['phase'] === null ||
        (typeof input['phase'] === 'string' && validPhases.includes(input['phase']))) &&
      (input['legacyCurrentWeek'] === null ||
        (Number.isInteger(input['legacyCurrentWeek']) && Number(input['legacyCurrentWeek']) >= 0))
    )
  }
  if (
    !isTransferObject(value) ||
    !exactKeys(value, ['schemaVersion', 'weeks', 'weekProgression', 'slots']) ||
    value['schemaVersion'] !== 1 ||
    !Number.isInteger(value['weeks']) ||
    Number(value['weeks']) < 1 ||
    !Array.isArray(value['weekProgression']) ||
    !Array.isArray(value['slots'])
  )
    throw new Error('Program design is malformed or unsupported.')
  const progressionWeeks = new Set<number>()
  for (const week of value['weekProgression']) {
    if (
      !isTransferObject(week) ||
      !exactKeys(week, ['week', 'progression']) ||
      !Number.isInteger(week['week']) ||
      Number(week['week']) < 1 ||
      Number(week['week']) > Number(value['weeks']) ||
      progressionWeeks.has(Number(week['week'])) ||
      !parseProgression(week['progression'])
    )
      throw new Error('Program design contains invalid week progression.')
    progressionWeeks.add(Number(week['week']))
  }
  const slotIds = new Set<string>()
  for (const slot of value['slots']) {
    if (
      !isTransferObject(slot) ||
      !exactKeys(slot, [
        'id',
        'templateId',
        'templateRevisionId',
        'assignmentResolved',
        'week',
        'day',
        'label',
        'progression',
      ]) ||
      typeof slot['id'] !== 'string' ||
      slot['id'].length === 0 ||
      slotIds.has(slot['id']) ||
      (slot['templateId'] !== null && typeof slot['templateId'] !== 'string') ||
      (slot['templateRevisionId'] !== null && typeof slot['templateRevisionId'] !== 'string') ||
      typeof slot['assignmentResolved'] !== 'boolean' ||
      !Number.isInteger(slot['week']) ||
      Number(slot['week']) < 1 ||
      Number(slot['week']) > Number(value['weeks']) ||
      !Number.isInteger(slot['day']) ||
      Number(slot['day']) < 1 ||
      Number(slot['day']) > 7 ||
      (slot['label'] !== null && typeof slot['label'] !== 'string') ||
      !parseProgression(slot['progression'])
    )
      throw new Error('Program design contains an invalid or unsupported slot.')
    slotIds.add(slot['id'])
  }
  return value as unknown as ProgramDesign
}

function programStructureHash(design: ProgramDesign): string {
  return structuralFingerprint({
    schemaVersion: 1,
    evaluatorVersion: 'program-v1',
    inputs: [],
    defaults: { incrementKg: 1, restSec: 0 },
    groups: [],
    activities: design.slots.map((slot, index) => ({
      id: slot.id,
      exerciseId: slot.templateId ?? '',
      order: index + 1,
      loggingMode: 'strength',
      executionGroupId: null,
      sets: [],
      targets: { durationSec: null, distanceM: null },
      notes: null,
    })),
    provenance: {
      kind: 'authored',
      migratedAt: null,
      legacyTemplateId: null,
      unresolvedFields: [],
    },
  })
}

interface PortableSelection {
  templateIds: Set<string>
  routineIds: Set<string>
  programIds: Set<string>
  planIds: Set<string>
}

function addSelectedId(ids: Set<string>, id: string): boolean {
  if (ids.has(id)) return false
  ids.add(id)
  return true
}

function programTemplateIds(tables: PortableBundle['tables'], programId: string): string[] {
  const weeks = new Set(
    (tables['program_weeks'] ?? [])
      .filter((row) => row['program_id'] === programId)
      .map((row) => String(row['id'])),
  )
  const days = (tables['program_days'] ?? [])
    .filter((row) => weeks.has(String(row['week_id'])) && row['template_id'] !== null)
    .map((row) => String(row['template_id']))
  const revisions = (tables['program_revisions'] ?? [])
    .filter((row) => row['program_id'] === programId)
    .flatMap((row) =>
      validateProgramDesign(JSON.parse(String(row['design_json'])))
        .slots.map((slot) => slot.templateId)
        .filter((id): id is string => id !== null),
    )
  return [...days, ...revisions]
}

function expandPortableRoutines(
  tables: PortableBundle['tables'],
  selection: PortableSelection,
): boolean {
  let changed = false
  for (const routine of tables['saved_routines'] ?? []) {
    const id = String(routine['id'])
    const templateId = String(routine['template_id'])
    if (selection.templateIds.has(templateId))
      changed = addSelectedId(selection.routineIds, id) || changed
    if (selection.routineIds.has(id))
      changed = addSelectedId(selection.templateIds, templateId) || changed
  }
  return changed
}

function expandPortablePrograms(
  tables: PortableBundle['tables'],
  selection: PortableSelection,
): boolean {
  let changed = false
  for (const program of tables['programs'] ?? []) {
    if (program['is_builtin'] !== 0) continue
    const id = String(program['id'])
    const templates = programTemplateIds(tables, id)
    if (templates.some((templateId) => selection.templateIds.has(templateId))) {
      changed = addSelectedId(selection.programIds, id) || changed
    }
    if (!selection.programIds.has(id)) continue
    for (const templateId of templates)
      changed = addSelectedId(selection.templateIds, templateId) || changed
  }
  return changed
}

function planReferencesSelection(
  tables: PortableBundle['tables'],
  plan: PortableRow,
  bindings: PortableRow[],
  selection: PortableSelection,
): boolean {
  if (plan['program_id'] !== null && selection.programIds.has(String(plan['program_id'])))
    return true
  if (
    bindings.some(
      (binding) =>
        selection.templateIds.has(String(binding['template_id'])) ||
        (binding['routine_id'] !== null && selection.routineIds.has(String(binding['routine_id']))),
    )
  )
    return true
  for (const table of ['organization_appointments', 'organization_recurrence_rules'] as const) {
    if (
      (tables[table] ?? []).some(
        (row) =>
          row['plan_id'] === plan['id'] && selection.routineIds.has(String(row['routine_id'])),
      )
    )
      return true
  }
  return (tables['organization_rotations'] ?? []).some((row) => {
    if (row['plan_id'] !== plan['id']) return false
    const ids: unknown = JSON.parse(String(row['routine_ids_json']))
    return (
      Array.isArray(ids) && ids.some((id) => typeof id === 'string' && selection.routineIds.has(id))
    )
  })
}

function expandPortableBindings(bindings: PortableRow[], selection: PortableSelection): boolean {
  let changed = false
  for (const binding of bindings) {
    if (typeof binding['template_id'] === 'string')
      changed = addSelectedId(selection.templateIds, binding['template_id']) || changed
    if (typeof binding['routine_id'] === 'string')
      changed = addSelectedId(selection.routineIds, binding['routine_id']) || changed
  }
  return changed
}

function expandPortablePlans(
  tables: PortableBundle['tables'],
  selection: PortableSelection,
): boolean {
  let changed = false
  for (const plan of tables['training_plans'] ?? []) {
    const id = String(plan['id'])
    const bindings = (tables['training_plan_bindings'] ?? []).filter((row) => row['plan_id'] === id)
    if (planReferencesSelection(tables, plan, bindings, selection))
      changed = addSelectedId(selection.planIds, id) || changed
    if (!selection.planIds.has(id)) continue
    if (plan['program_id'] !== null)
      changed = addSelectedId(selection.programIds, String(plan['program_id'])) || changed
    changed = expandPortableBindings(bindings, selection) || changed
  }
  return changed
}

function expandPortableOrganization(
  tables: PortableBundle['tables'],
  selection: PortableSelection,
): boolean {
  let changed = false
  for (const table of ['organization_appointments', 'organization_recurrence_rules'] as const) {
    for (const row of tables[table] ?? []) {
      if (selection.planIds.has(String(row['plan_id'])))
        changed = addSelectedId(selection.routineIds, String(row['routine_id'])) || changed
    }
  }
  for (const row of tables['organization_rotations'] ?? []) {
    if (!selection.planIds.has(String(row['plan_id']))) continue
    const ids: unknown = JSON.parse(String(row['routine_ids_json']))
    if (!Array.isArray(ids)) continue
    for (const id of ids) {
      if (typeof id === 'string') changed = addSelectedId(selection.routineIds, id) || changed
    }
  }
  return changed
}

function selectAllPortableGraph(
  tables: PortableBundle['tables'],
  selection: PortableSelection,
): void {
  for (const row of tables['saved_routines'] ?? []) selection.routineIds.add(String(row['id']))
  for (const row of tables['programs'] ?? []) {
    if (row['is_builtin'] === 0) selection.programIds.add(String(row['id']))
  }
  for (const row of tables['training_plans'] ?? []) {
    if (row['program_id'] === null || selection.programIds.has(String(row['program_id'])))
      selection.planIds.add(String(row['id']))
  }
}

function selectPortableGraph(
  tables: PortableBundle['tables'],
  templateId?: string,
): PortableSelection {
  const selection: PortableSelection = {
    templateIds: new Set(
      templateId ? [templateId] : (tables['templates'] ?? []).map((row) => String(row['id'])),
    ),
    routineIds: new Set(),
    programIds: new Set(),
    planIds: new Set(),
  }
  if (!templateId) {
    selectAllPortableGraph(tables, selection)
    return selection
  }
  if (!(tables['templates'] ?? []).some((row) => row['id'] === templateId))
    throw new Error('Template does not exist.')
  let changed: boolean
  do {
    changed = expandPortableRoutines(tables, selection)
    changed = expandPortablePrograms(tables, selection) || changed
    changed = expandPortablePlans(tables, selection) || changed
    changed = expandPortableOrganization(tables, selection) || changed
  } while (changed)
  return selection
}

function retainPortableRows(
  tables: PortableBundle['tables'],
  table: PortableTable,
  column: string,
  ids: Set<string>,
): void {
  tables[table] = (tables[table] ?? []).filter((row) => ids.has(String(row[column])))
}

function filterPortableDomain(
  tables: PortableBundle['tables'],
  selection: PortableSelection,
): void {
  retainPortableRows(tables, 'templates', 'id', selection.templateIds)
  for (const table of ['template_exercises', 'template_groups', 'template_revisions'] as const)
    retainPortableRows(tables, table, 'template_id', selection.templateIds)
  retainPortableRows(tables, 'saved_routines', 'id', selection.routineIds)
  retainPortableRows(tables, 'routine_revisions', 'routine_id', selection.routineIds)
  retainPortableRows(tables, 'programs', 'id', selection.programIds)
  for (const table of ['program_revisions', 'program_weeks'] as const)
    retainPortableRows(tables, table, 'program_id', selection.programIds)
  const weekIds = new Set((tables['program_weeks'] ?? []).map((row) => String(row['id'])))
  tables['program_days'] = (tables['program_days'] ?? []).filter(
    (row) =>
      weekIds.has(String(row['week_id'])) &&
      (row['template_id'] === null || selection.templateIds.has(String(row['template_id']))),
  )
  retainPortableRows(tables, 'training_plans', 'id', selection.planIds)
  const slots = selectedPortableSlots(tables, selection.templateIds)
  tables['training_plan_bindings'] = (tables['training_plan_bindings'] ?? []).filter(
    (row) =>
      selection.planIds.has(String(row['plan_id'])) &&
      selection.templateIds.has(String(row['template_id'])) &&
      (row['routine_id'] === null || selection.routineIds.has(String(row['routine_id']))) &&
      slots.has(String(row['program_slot_id'])),
  )
}

function selectedPortableSlots(
  tables: PortableBundle['tables'],
  templateIds: Set<string>,
): Set<string> {
  const slots = new Set<string>()
  const revisions = new Set((tables['template_revisions'] ?? []).map((row) => String(row['id'])))
  for (const revision of tables['program_revisions'] ?? []) {
    const design = validateProgramDesign(JSON.parse(String(revision['design_json'])))
    for (const slot of design.slots) {
      slots.add(slot.id)
      if (slot.templateId !== null && !templateIds.has(slot.templateId))
        throw new Error('Portable Program revision refers to a missing template.')
      if (slot.templateRevisionId !== null && !revisions.has(slot.templateRevisionId))
        throw new Error('Portable Program revision refers to a missing template revision.')
    }
  }
  return slots
}

function addPortableExerciseDependencies(
  row: PortableRow,
  templateIds: Set<string>,
  exerciseIds: Set<string>,
): void {
  exerciseIds.add(String(row['exercise_id']))
  if (typeof row['substitutes'] === 'string') {
    const substitutes: unknown = JSON.parse(row['substitutes'])
    if (!Array.isArray(substitutes) || substitutes.some((id) => typeof id !== 'string'))
      throw new Error('Template substitute list is malformed.')
    for (const id of substitutes) exerciseIds.add(id)
  }
  if (typeof row['deload_template_id'] === 'string' && !templateIds.has(row['deload_template_id']))
    throw new Error('Single-template export requires its deload template dependency.')
}

async function filterPortableExercises(
  db: DbAdapter,
  tables: PortableBundle['tables'],
  templateIds: Set<string>,
): Promise<void> {
  const exerciseIds = new Set<string>()
  for (const row of tables['template_exercises'] ?? [])
    addPortableExerciseDependencies(row, templateIds, exerciseIds)
  for (const table of ['template_revisions', 'routine_revisions'] as const) {
    for (const revision of tables[table] ?? []) {
      const prescription = parseSerializablePrescription(
        JSON.parse(String(revision['prescription_json'])),
      )
      validatePrescriptionExpressions(prescription)
      for (const activity of prescription.activities) exerciseIds.add(activity.exerciseId)
    }
  }
  const exercises = await db.queryAll<PortableRow>('SELECT * FROM exercises')
  const byId = new Set(exercises.map((row) => String(row['id'])))
  for (const id of exerciseIds) {
    if (!byId.has(id)) throw new Error(`Portable training graph refers to missing exercise ${id}.`)
  }
  tables['exercises'] = exercises.filter((row) => exerciseIds.has(String(row['id'])))
  retainPortableRows(tables, 'equipment_profiles', 'exercise_id', exerciseIds)
}

function rotationHasSelectedRoutines(row: PortableRow, selection: PortableSelection): boolean {
  if (!selection.planIds.has(String(row['plan_id']))) return false
  const ids: unknown = JSON.parse(String(row['routine_ids_json']))
  return (
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.every((id) => typeof id === 'string' && selection.routineIds.has(id))
  )
}

function filterPortableOrganization(
  tables: PortableBundle['tables'],
  selection: PortableSelection,
): void {
  for (const table of ['organization_appointments', 'organization_recurrence_rules'] as const) {
    tables[table] = (tables[table] ?? []).filter(
      (row) =>
        selection.planIds.has(String(row['plan_id'])) &&
        selection.routineIds.has(String(row['routine_id'])) &&
        (table !== 'organization_appointments' || row['workout_id'] === null),
    )
  }
  const rotations = (tables['organization_rotations'] ?? []).filter((row) =>
    rotationHasSelectedRoutines(row, selection),
  )
  tables['organization_rotations'] = rotations
  const rotationIds = new Set(rotations.map((row) => String(row['id'])))
  tables['organization_rotation_advances'] = (
    tables['organization_rotation_advances'] ?? []
  ).filter((row) => rotationIds.has(String(row['rotation_id'])) && row['workout_id'] === null)
  retainPortableRows(tables, 'organization_goals', 'plan_id', selection.planIds)
  const goalIds = new Set((tables['organization_goals'] ?? []).map((row) => String(row['id'])))
  tables['organization_goal_credits'] = (tables['organization_goal_credits'] ?? []).filter(
    (row) => goalIds.has(String(row['goal_id'])) && row['workout_id'] === null,
  )
  tables['organization_source_links'] = []
}

async function exportPortable(
  db: DbAdapter,
  selection?: { templateId?: string },
): Promise<PortableBundle> {
  const tables: PortableBundle['tables'] = {}
  for (const table of PORTABLE_TABLES)
    tables[table] = await db.queryAll<PortableRow>(`SELECT * FROM ${quoteIdentifier(table)}`)
  const selected = selectPortableGraph(tables, selection?.templateId)
  filterPortableDomain(tables, selected)
  await filterPortableExercises(db, tables, selected.templateIds)
  filterPortableOrganization(tables, selected)
  return {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  }
}

async function resolvePortableExerciseIds(
  db: DbAdapter,
  rows: Array<Record<string, unknown>>,
): Promise<Map<string, string>> {
  const current = await db.queryAll<{ id: string; slug: string; name: string; movement: string }>(
    'SELECT id, slug, name, movement FROM exercises',
  )
  const currentBySlug = new Map(current.map((exercise) => [exercise.slug, exercise]))
  const incomingSlugs = new Set<string>()
  const idMap = new Map<string, string>()
  for (const row of rows) {
    const id = row['id']
    const slug = row['slug']
    const name = row['name']
    const movement = row['movement']
    if (
      typeof id !== 'string' ||
      !id ||
      typeof slug !== 'string' ||
      !slug ||
      typeof name !== 'string' ||
      !name.trim() ||
      typeof movement !== 'string' ||
      !movement ||
      (row['is_custom'] !== 0 && row['is_custom'] !== 1) ||
      incomingSlugs.has(slug)
    )
      throw new Error('Portable export contains an invalid or duplicate exercise.')
    incomingSlugs.add(slug)
    const destination = currentBySlug.get(slug)
    if (row['is_custom'] === 1) {
      idMap.set(id, crypto.randomUUID())
    } else if (destination) {
      if (destination.name !== name || destination.movement !== movement)
        throw new Error(`Exercise slug is already used by incompatible catalog content: ${slug}.`)
      idMap.set(id, destination.id)
    } else {
      throw new Error(`Built-in exercise is missing or incompatible: ${name}.`)
    }
  }
  return idMap
}

function validatePortableRow(
  table: string,
  row: PortableRow,
  columns: SqliteColumn[],
  columnNames: Set<string>,
): void {
  const keys = Object.keys(row)
  if (keys.length !== columns.length || keys.some((column) => !columnNames.has(column))) {
    throw new Error(`Portable ${table} row is missing required content or has unsupported fields.`)
  }
  for (const column of columns) {
    const value = row[column.name]
    if (
      value !== null &&
      ((typeof value !== 'string' && typeof value !== 'number') ||
        (typeof value === 'number' && !Number.isFinite(value)))
    )
      throw new Error(`Portable ${table}.${column.name} has an unsupported value.`)
    if (value === null && column.notnull === 1) {
      throw new Error(`Portable ${table}.${column.name} is required.`)
    }
  }
}

async function validatePortableRows(
  db: DbAdapter,
  tables: Record<string, unknown>,
  rowsFor: PortableRows,
): Promise<void> {
  for (const table of PORTABLE_TABLES) {
    if (!Array.isArray(tables[table])) throw new Error(`Portable export is missing ${table}.`)
    const columns = await columnsFor(db, table)
    const columnNames = new Set(columns.map((column) => column.name))
    for (const row of rowsFor(table)) {
      if (!isTransferObject(row)) throw new Error(`Invalid portable row in ${table}.`)
      validatePortableRow(table, row, columns, columnNames)
    }
  }
}
function portableIdColumn(table: PortableTable): string {
  return table === 'equipment_profiles' ? 'exercise_id' : 'id'
}

async function portableIdentities(
  db: DbAdapter,
  rowsFor: PortableRows,
): Promise<{ incomingIds: Map<string, Set<string>>; currentIds: Map<string, Set<string>> }> {
  const incomingIds = new Map<string, Set<string>>()
  const currentIds = new Map<string, Set<string>>()
  for (const table of [...PORTABLE_ENTITY_ID_TABLES, 'exercises', 'equipment_profiles'] as const) {
    const idColumn = portableIdColumn(table)
    const ids = new Set<string>()
    for (const row of rowsFor(table)) {
      const id = row[idColumn]
      if (typeof id !== 'string' || !id || ids.has(id))
        throw new Error(`Portable export has a missing or duplicate ${table} identity.`)
      ids.add(id)
    }
    incomingIds.set(table, ids)
    const existing = await db.queryAll<Record<string, unknown>>(
      `SELECT ${quoteIdentifier(idColumn)} FROM ${quoteIdentifier(table)}`,
    )
    currentIds.set(
      table,
      new Set(
        existing.map((row) => row[idColumn]).filter((id): id is string => typeof id === 'string'),
      ),
    )
  }
  return { incomingIds, currentIds }
}
function validatePortableNames(rowsFor: PortableRows): void {
  for (const table of ['templates', 'programs'] as const) {
    const incomingNames = new Set<string>()
    for (const row of rowsFor(table)) {
      if (typeof row['name'] !== 'string' || row['name'].trim().length === 0)
        throw new Error(`Invalid ${table} name.`)
      const normalizedName = row['name'].trim().toLocaleLowerCase()
      if (incomingNames.has(normalizedName))
        throw new Error(`Duplicate ${table} in portable export: ${row['name']}.`)
      incomingNames.add(normalizedName)
    }
  }
}
async function validatePortablePrograms(
  db: DbAdapter,
  rowsFor: PortableRows,
): Promise<Map<string, number>> {
  const programWeekLimits = new Map<string, number>()
  const incomingActivePrograms: string[] = []
  for (const row of rowsFor('programs')) {
    if (
      row['is_builtin'] !== 0 ||
      !Number.isInteger(row['weeks']) ||
      Number(row['weeks']) < 1 ||
      !Number.isInteger(row['current_week']) ||
      Number(row['current_week']) < 1 ||
      Number(row['current_week']) > Number(row['weeks']) ||
      (row['active'] !== 0 && row['active'] !== 1) ||
      typeof row['created_at'] !== 'string' ||
      !Number.isFinite(Date.parse(row['created_at']))
    )
      throw new Error('Portable export contains an invalid user-created program.')
    programWeekLimits.set(String(row['id']), Number(row['weeks']))
    if (row['active'] === 1) incomingActivePrograms.push(String(row['id']))
  }
  if (incomingActivePrograms.length > 1) {
    throw new Error('Portable export contains more than one active program.')
  }
  if (
    incomingActivePrograms.length === 1 &&
    (await db.queryOne<{ id: string }>('SELECT id FROM programs WHERE active = 1 LIMIT 1'))
  )
    throw new Error(
      'An active program already exists; deactivate it before importing another active program.',
    )
  return programWeekLimits
}
function validatePortableWeeks(
  rowsFor: PortableRows,
  programIds: Set<string>,
  programWeekLimits: Map<string, number>,
): void {
  for (const row of rowsFor('program_weeks')) {
    const programId = String(row['program_id'])
    const weekNumber = row['week_num']
    if (
      !programIds.has(programId) ||
      !Number.isInteger(weekNumber) ||
      Number(weekNumber) < 1 ||
      Number(weekNumber) > (programWeekLimits.get(programId) ?? 0) ||
      (row['is_deload'] !== 0 && row['is_deload'] !== 1) ||
      typeof row['intensity_modifier'] !== 'number' ||
      row['intensity_modifier'] <= 0 ||
      typeof row['volume_modifier'] !== 'number' ||
      row['volume_modifier'] <= 0
    )
      throw new Error('Portable export contains an invalid program week.')
  }
}
function validatePortableGroups(
  rowsFor: PortableRows,
  templateIds: Set<string>,
): Map<string, Set<string>> {
  const groupLabelsByTemplate = new Map<string, Set<string>>()
  for (const row of rowsFor('template_groups')) {
    const templateId = row['template_id']
    const label = row['label']
    if (
      !templateIds.has(String(templateId)) ||
      typeof label !== 'string' ||
      label.length === 0 ||
      !['superset', 'giant_set', 'circuit', 'pre_exhaust'].includes(String(row['group_type'])) ||
      !['after_round', 'after_each'].includes(String(row['circuit_rest_mode'])) ||
      !Number.isInteger(row['rounds']) ||
      Number(row['rounds']) < 1 ||
      (row['amrap'] !== 0 && row['amrap'] !== 1)
    )
      throw new Error('Portable export contains an invalid template group.')
    const labels = groupLabelsByTemplate.get(String(templateId)) ?? new Set<string>()
    if (labels.has(label)) throw new Error(`Duplicate template group label: ${label}.`)
    labels.add(label)
    groupLabelsByTemplate.set(String(templateId), labels)
  }
  return groupLabelsByTemplate
}
function validatePortableExercises(
  rowsFor: PortableRows,
  templateIds: Set<string>,
  validExerciseIds: Set<string>,
  groupLabelsByTemplate: Map<string, Set<string>>,
): void {
  for (const row of rowsFor('template_exercises')) {
    const templateId = String(row['template_id'])
    const groupLabel = row['superset_group']
    let substituteIds: string[] = []
    try {
      if (row['substitutes'] !== null) {
        const parsed: unknown =
          typeof row['substitutes'] === 'string' ? JSON.parse(row['substitutes']) : null
        if (
          !Array.isArray(parsed) ||
          parsed.some((id) => typeof id !== 'string' || id.length === 0) ||
          new Set(parsed).size !== parsed.length
        )
          throw new Error()
        substituteIds = parsed
      }
    } catch {
      throw new Error('Portable template exercise contains invalid substitute exercises.')
    }
    if (
      !templateIds.has(templateId) ||
      !validExerciseIds.has(String(row['exercise_id'])) ||
      (groupLabel !== null &&
        (typeof groupLabel !== 'string' ||
          !groupLabelsByTemplate.get(templateId)?.has(groupLabel))) ||
      (row['deload_template_id'] !== null && !templateIds.has(String(row['deload_template_id']))) ||
      substituteIds.some((id) => !validExerciseIds.has(id))
    )
      throw new Error(
        'Portable template exercise has a missing template, exercise, group, deload template, or substitute.',
      )
  }
}
function validatePortableDays(
  rowsFor: PortableRows,
  weekIds: Set<string>,
  templateIds: Set<string>,
): void {
  for (const row of rowsFor('program_days')) {
    if (
      !weekIds.has(String(row['week_id'])) ||
      !Number.isInteger(row['day_num']) ||
      Number(row['day_num']) < 1 ||
      Number(row['day_num']) > 7 ||
      (row['template_id'] !== null && !templateIds.has(String(row['template_id'])))
    )
      throw new Error(
        'Portable program day refers to a missing week or template, or has an invalid day.',
      )
  }
}
function validatePortableEquipment(
  rowsFor: PortableRows,
  validExerciseIds: Set<string>,
  exerciseIdMap: Map<string, string>,
  currentIds: Map<string, Set<string>>,
): void {
  const equipmentDestinationConflicts = new Set<string>()
  for (const row of rowsFor('equipment_profiles')) {
    const exerciseId = String(row['exercise_id'])
    const destinationExerciseId = exerciseIdMap.get(exerciseId)
    const minimum = row['minimum_kg']
    const increment = row['increment_kg']
    const maximum = row['maximum_kg']
    let additionalLoads: unknown
    try {
      additionalLoads =
        typeof row['additional_loads_kg'] === 'string'
          ? JSON.parse(row['additional_loads_kg'])
          : null
    } catch {
      throw new Error('Portable equipment profile contains invalid additional loads.')
    }
    if (
      !validExerciseIds.has(exerciseId) ||
      destinationExerciseId === undefined ||
      currentIds.get('equipment_profiles')?.has(destinationExerciseId) ||
      equipmentDestinationConflicts.has(destinationExerciseId) ||
      typeof minimum !== 'number' ||
      minimum < 0 ||
      typeof increment !== 'number' ||
      increment <= 0 ||
      (maximum !== null && (typeof maximum !== 'number' || maximum < minimum)) ||
      !Array.isArray(additionalLoads) ||
      additionalLoads.some(
        (load) => typeof load !== 'number' || !Number.isFinite(load) || load < 0,
      ) ||
      typeof row['updated_at'] !== 'string' ||
      !Number.isFinite(Date.parse(row['updated_at']))
    )
      throw new Error('Portable export contains an invalid or conflicting equipment profile.')
    equipmentDestinationConflicts.add(destinationExerciseId)
  }
}
interface PreparedLegacyTemplate {
  payload: LegacyTemplatePayload
  exerciseIds: string[]
}

function validateLegacyExerciseDependencies(
  exercise: LegacyTemplatePayload['exercises'][number],
  groupLabels: Set<string>,
): void {
  if (exercise['deload_template_id'] !== null)
    throw new Error(
      'Legacy template refers to an external deload template; import a complete portable bundle instead.',
    )
  if (exercise['substitutes'] !== null) {
    const substitutes: unknown = JSON.parse(String(exercise['substitutes']))
    if (!Array.isArray(substitutes) || substitutes.length)
      throw new Error(
        'Legacy template has unresolved substitute exercise identities; import a complete portable bundle instead.',
      )
  }
  if (exercise['superset_group'] !== null && !groupLabels.has(String(exercise['superset_group'])))
    throw new Error('Legacy template exercise refers to a missing group.')
}

async function prepareLegacyTemplate(
  db: DbAdapter,
  input: unknown,
): Promise<PreparedLegacyTemplate | null> {
  const payload = parseLegacyTemplatePayload(input)
  if (!payload) return null
  const groupsById = new Set<string>()
  const groupLabels = new Set<string>()
  for (const group of payload.groups) {
    if (groupsById.has(group['group_id']) || groupLabels.has(group['label']))
      throw new Error('Legacy template export contains duplicate group identities or labels.')
    groupsById.add(group['group_id'])
    groupLabels.add(group['label'])
  }
  const exerciseIds: string[] = []
  for (const exercise of payload.exercises) {
    validateLegacyExerciseDependencies(exercise, groupLabels)
    const matches = await db.queryAll<{ id: string }>(
      'SELECT id FROM exercises WHERE lower(name)=lower(?) AND movement=?',
      [exercise['exercise_name'], exercise['exercise_movement']],
    )
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? `Exercise match is ambiguous: ${exercise['exercise_name']}.`
          : `Exercise not found: ${exercise['exercise_name']}. Import or create the exercise first.`,
      )
    const match = matches[0]
    if (!match) throw new Error(`Exercise match is missing: ${exercise['exercise_name']}.`)
    exerciseIds.push(match.id)
  }
  return { payload, exerciseIds }
}

async function importLegacyTemplate(
  db: DbAdapter,
  prepared: PreparedLegacyTemplate,
): Promise<RestorePreview> {
  const { payload } = prepared
  await db.transaction(async (tx) => {
    const templateId = crypto.randomUUID()
    const template = payload.template
    await tx.exec(
      'INSERT INTO templates (id,name,description,created_at,archived_at,sort_order,pinned_at,last_used_at,use_count,cover_emoji,scheduled_days,notification_enabled,notification_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        templateId,
        template['name'],
        template['description'],
        template['created_at'],
        template['archived_at'],
        template['sort_order'],
        template['pinned_at'],
        template['last_used_at'],
        template['use_count'],
        template['cover_emoji'],
        template['scheduled_days'],
        template['notification_enabled'],
        template['notification_time'],
      ],
    )
    for (const group of payload.groups) {
      await tx.exec(
        'INSERT INTO template_groups (id,template_id,label,name,group_type,transition_rest_sec,rest_after_round_sec,circuit_rest_mode,sort_order,display_name,rounds,amrap,time_cap_sec) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          crypto.randomUUID(),
          templateId,
          group['label'],
          group['name'],
          group['group_type'],
          group['transition_rest_sec'],
          group['rest_after_round_sec'],
          group['circuit_rest_mode'],
          group['sort_order'],
          group['display_name'],
          group['rounds'],
          group['amrap'],
          group['time_cap_sec'],
        ],
      )
    }
    for (const [index, exercise] of payload.exercises.entries()) {
      await tx.exec(
        'INSERT INTO template_exercises (id,template_id,exercise_id,order_num,superset_group,sets_planned,reps_planned,rpe_target,increment_kg,rest_seconds,set_rest_seconds,transition_rest_sec,warmup_counts,set_scheme,notes,failure_target,rpe_targets,progression_rule,deload_template_id,substitutes,tempo,resistance_note,unilateral) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          crypto.randomUUID(),
          templateId,
          prepared.exerciseIds[index],
          exercise['order_num'],
          exercise['superset_group'],
          exercise['sets_planned'],
          exercise['reps_planned'],
          exercise['rpe_target'],
          exercise['increment_kg'],
          exercise['rest_seconds'],
          exercise['set_rest_seconds'],
          exercise['transition_rest_sec'],
          exercise['warmup_counts'],
          exercise['set_scheme'],
          exercise['notes'],
          exercise['failure_target'],
          exercise['rpe_targets'],
          exercise['progression_rule'],
          null,
          '[]',
          exercise['tempo'],
          exercise['resistance_note'],
          exercise['unilateral'],
        ],
      )
    }
    await migratePrescriptionDomain(tx)
  })
  return {
    valid: true,
    legacy: true,
    restoreMode: 'additive',
    templateCount: 1,
    rowCount: 1 + payload.groups.length + payload.exercises.length,
  }
}
function validatePortablePrescription(
  row: PortableRow,
  kind: 'Template' | 'Routine',
  validExerciseIds: Set<string>,
) {
  const prescription = parseSerializablePrescription(JSON.parse(String(row['prescription_json'])))
  validatePrescriptionExpressions(prescription)
  if (structuralFingerprint(prescription) !== row['structure_hash'])
    throw new Error(`${kind} revision structure fingerprint is inconsistent.`)
  for (const activity of prescription.activities) {
    if (!validExerciseIds.has(activity.exerciseId))
      throw new Error(`${kind} revision refers to missing exercise ${activity.exerciseId}.`)
  }
  return prescription
}

function portableRoutineInputs(value: unknown): Record<string, number | boolean> {
  if (!isTransferObject(value)) throw new Error('Routine revision inputs are malformed.')
  const inputs: Record<string, number | boolean> = {}
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' && typeof entry !== 'boolean')
      throw new Error('Routine revision inputs are malformed.')
    inputs[id] = entry
  }
  return inputs
}

function validatePortableRoutineRevision(
  row: PortableRow,
  templateIds: Set<string>,
  templateRevisionIds: Set<string>,
  routineIds: Set<string>,
  validExerciseIds: Set<string>,
): void {
  if (!routineIds.has(String(row['routine_id'])))
    throw new Error('Routine revision has no portable parent routine.')
  const prescription = validatePortablePrescription(row, 'Routine', validExerciseIds)
  validateRoutineInputs(prescription, portableRoutineInputs(JSON.parse(String(row['inputs_json']))))
  const provenance: unknown = JSON.parse(String(row['provenance_json']))
  if (
    !isTransferObject(provenance) ||
    !templateIds.has(String(provenance['templateId'])) ||
    !templateRevisionIds.has(String(provenance['adoptedTemplateRevisionId']))
  )
    throw new Error('Routine revision provenance is dangling.')
}

function validatePortableAuthoredRevisions(
  rowsFor: PortableRows,
  templateIds: Set<string>,
  templateRevisionIds: Set<string>,
  routineIds: Set<string>,
  validExerciseIds: Set<string>,
): void {
  for (const row of rowsFor('template_revisions')) {
    if (!templateIds.has(String(row['template_id'])))
      throw new Error('Template revision has no portable parent template.')
    validatePortablePrescription(row, 'Template', validExerciseIds)
  }
  for (const row of rowsFor('saved_routines')) {
    if (
      !templateIds.has(String(row['template_id'])) ||
      !templateRevisionIds.has(String(row['adopted_template_revision_id'])) ||
      !rowsFor('routine_revisions').some(
        (revision) =>
          revision['id'] === row['current_revision_id'] && revision['routine_id'] === row['id'],
      )
    )
      throw new Error(
        'Saved routine has a dangling template, adopted revision, or current revision reference.',
      )
  }
  for (const row of rowsFor('routine_revisions'))
    validatePortableRoutineRevision(
      row,
      templateIds,
      templateRevisionIds,
      routineIds,
      validExerciseIds,
    )
}
function validatePortableProgramSlots(
  row: PortableRow,
  templateIds: Set<string>,
  templateRevisionIds: Set<string>,
  slotIds: Set<string>,
): void {
  const design = validateProgramDesign(JSON.parse(String(row['design_json'])))
  if (programStructureHash(design) !== row['structure_hash'])
    throw new Error('Program revision structure fingerprint is inconsistent.')
  for (const slot of design.slots) {
    if (slotIds.has(slot.id))
      throw new Error(`Duplicate portable Program slot identity: ${slot.id}.`)
    slotIds.add(slot.id)
    if (slot.templateId !== null && !templateIds.has(slot.templateId))
      throw new Error('Program revision refers to a missing template.')
    if (slot.templateRevisionId !== null && !templateRevisionIds.has(slot.templateRevisionId))
      throw new Error('Program revision refers to a missing template revision.')
  }
}

function validatePortablePlanBindings(
  rowsFor: PortableRows,
  templateIds: Set<string>,
  programIds: Set<string>,
  programRevisionIds: Set<string>,
  routineIds: Set<string>,
  planIds: Set<string>,
  slotIds: Set<string>,
): void {
  for (const plan of rowsFor('training_plans')) {
    if (plan['program_id'] !== null && !programIds.has(String(plan['program_id'])))
      throw new Error('Training plan refers to a missing Program.')
    if (
      plan['adopted_program_revision_id'] !== null &&
      !programRevisionIds.has(String(plan['adopted_program_revision_id']))
    )
      throw new Error('Training plan refers to a missing Program revision.')
  }
  for (const binding of rowsFor('training_plan_bindings')) {
    if (
      !planIds.has(String(binding['plan_id'])) ||
      !templateIds.has(String(binding['template_id'])) ||
      (binding['routine_id'] !== null && !routineIds.has(String(binding['routine_id']))) ||
      !slotIds.has(String(binding['program_slot_id'])) ||
      (binding['status'] === 'bound' && binding['routine_id'] === null)
    )
      throw new Error('Training plan binding has an invalid or dangling relationship.')
  }
}

function validatePortableRotation(
  row: PortableRow,
  planIds: Set<string>,
  routineIds: Set<string>,
): void {
  const ids: unknown = JSON.parse(String(row['routine_ids_json']))
  if (
    !planIds.has(String(row['plan_id'])) ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== 'string' || !routineIds.has(id)) ||
    !Number.isInteger(row['position']) ||
    Number(row['position']) < 0 ||
    Number(row['position']) >= ids.length ||
    !Number.isInteger(row['generation']) ||
    Number(row['generation']) < 0
  )
    throw new Error('Organization rotation contains invalid routine references or state.')
}

function validatePortableOrganizationReferences(
  rowsFor: PortableRows,
  planIds: Set<string>,
  routineIds: Set<string>,
): number {
  for (const table of ['organization_appointments', 'organization_recurrence_rules'] as const) {
    for (const row of rowsFor(table)) {
      if (!planIds.has(String(row['plan_id'])) || !routineIds.has(String(row['routine_id'])))
        throw new Error(`${table} contains a dangling plan or routine reference.`)
    }
  }
  for (const row of rowsFor('organization_rotations'))
    validatePortableRotation(row, planIds, routineIds)
  return (
    rowsFor('organization_appointments').length +
    rowsFor('organization_recurrence_rules').length +
    rowsFor('organization_rotations').length +
    rowsFor('organization_goals').length
  )
}

function validatePortableProgramAndPlanGraph(
  rowsFor: PortableRows,
  templateIds: Set<string>,
  templateRevisionIds: Set<string>,
  programIds: Set<string>,
  routineIds: Set<string>,
  planIds: Set<string>,
): { slotIds: Set<string>; programRevisionIds: Set<string>; organizationCount: number } {
  const slotIds = new Set<string>()
  const programRevisionIds = new Set<string>()
  const programsWithRevisions = new Set<string>()
  for (const row of rowsFor('program_revisions')) {
    const programId = String(row['program_id'])
    if (!programIds.has(programId))
      throw new Error('Program revision has no portable parent program.')
    programRevisionIds.add(String(row['id']))
    programsWithRevisions.add(programId)
    validatePortableProgramSlots(row, templateIds, templateRevisionIds, slotIds)
  }
  for (const program of rowsFor('programs')) {
    if (!programsWithRevisions.has(String(program['id'])))
      throw new Error(`Program ${String(program['name'])} has no revision history.`)
  }
  validatePortablePlanBindings(
    rowsFor,
    templateIds,
    programIds,
    programRevisionIds,
    routineIds,
    planIds,
    slotIds,
  )
  const organizationCount = validatePortableOrganizationReferences(rowsFor, planIds, routineIds)
  return { slotIds, programRevisionIds, organizationCount }
}
async function previewPortableImport(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  try {
    const legacy = await prepareLegacyTemplate(db, input)
    if (legacy)
      return {
        valid: true,
        legacy: true,
        restoreMode: 'additive',
        templateCount: 1,
        rowCount: 1 + legacy.payload.groups.length + legacy.payload.exercises.length,
      }
    if (
      !isTransferObject(input) ||
      input['format'] !== PORTABLE_FORMAT ||
      ![1, PORTABLE_VERSION].includes(Number(input['version'])) ||
      typeof input['exportedAt'] !== 'string' ||
      !Number.isFinite(Date.parse(input['exportedAt'])) ||
      !isTransferObject(input['tables'])
    )
      throw new Error('Unsupported or malformed portable export.')
    const tables = normalizePortableTables(input['tables'], Number(input['version']))
    if (Object.keys(tables).some((name) => !PORTABLE_TABLES.includes(name as PortableTable)))
      throw new Error('Portable export contains an unsupported table.')
    const rowsFor: PortableRows = (table) => tables[table] as PortableRow[]
    await validatePortableRows(db, tables, rowsFor)
    const { incomingIds, currentIds } = await portableIdentities(db, rowsFor)
    const exerciseIdMap = await resolvePortableExerciseIds(db, rowsFor('exercises'))
    const templates = rowsFor('templates')
    const templateIds = new Set(templates.map((row) => String(row['id'])))
    const programIds = new Set(rowsFor('programs').map((row) => String(row['id'])))
    const routineIds = new Set(rowsFor('saved_routines').map((row) => String(row['id'])))
    const planIds = new Set(rowsFor('training_plans').map((row) => String(row['id'])))
    const revisions = new Map(rowsFor('template_revisions').map((row) => [String(row['id']), row]))
    const templateRevisionIds = new Set(revisions.keys())
    const validExerciseIds = new Set([
      ...(incomingIds.get('exercises') ?? []),
      ...(currentIds.get('exercises') ?? []),
    ])
    const programWeekLimits = await validatePortablePrograms(db, rowsFor)
    validatePortableNames(rowsFor)
    validatePortableWeeks(rowsFor, programIds, programWeekLimits)
    const groupLabelsByTemplate = validatePortableGroups(rowsFor, templateIds)
    validatePortableExercises(rowsFor, templateIds, validExerciseIds, groupLabelsByTemplate)
    validatePortableDays(
      rowsFor,
      new Set(rowsFor('program_weeks').map((row) => String(row['id']))),
      templateIds,
    )
    validatePortableEquipment(rowsFor, validExerciseIds, exerciseIdMap, currentIds)
    validatePortableAuthoredRevisions(
      rowsFor,
      templateIds,
      templateRevisionIds,
      routineIds,
      validExerciseIds,
    )
    const { organizationCount } = validatePortableProgramAndPlanGraph(
      rowsFor,
      templateIds,
      templateRevisionIds,
      programIds,
      routineIds,
      planIds,
    )
    const rowCount = PORTABLE_TABLES.reduce((sum, table) => sum + rowsFor(table).length, 0)
    return {
      valid: true,
      exportedAt: input['exportedAt'],
      templateCount: templates.length,
      programCount: rowsFor('programs').length,
      routineCount: routineIds.size,
      planCount: planIds.size,
      organizationCount,
      catalogExerciseReuseCount: exerciseIdMap.size,
      restoreMode: 'additive',
      legacy: Number(input['version']) === 1,
      rowCount,
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function remapReference(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => remapReference(entry, idMap))
  if (!isTransferObject(value)) return value
  const referenceFields = new Set([
    'id',
    'exerciseId',
    'templateId',
    'legacyTemplateId',
    'templateRevisionId',
    'sourceRevisionId',
    'routineId',
    'routineRevisionId',
    'adoptedTemplateRevisionId',
    'programId',
    'programSlotId',
    'weekId',
    'planId',
    'executionGroupId',
    'inputId',
    'targetId',
    'template_id',
    'exercise_id',
    'template_revision_id',
    'program_id',
    'program_slot_id',
    'week_id',
    'plan_id',
    'routine_id',
    'rotation_id',
    'goal_id',
    'workout_id',
    'appointment_id',
    'source_id',
    'set_id',
    'workout_exercise_id',
    'deload_template_id',
  ])
  const referenceArrays = new Set(['activityIds', 'activity_ids', 'routineIds', 'routine_ids'])
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && referenceFields.has(key))
      result[key] = idMap.get(entry) ?? entry
    else if (Array.isArray(entry) && referenceArrays.has(key))
      result[key] = entry.map((id) => (typeof id === 'string' ? (idMap.get(id) ?? id) : id))
    else result[key] = remapReference(entry, idMap)
  }
  return result
}

function registerPrescriptionIdentities(value: unknown, idMap: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) registerPrescriptionIdentities(entry, idMap)
  } else if (isTransferObject(value)) {
    const id = value['id']
    if (typeof id === 'string' && !idMap.has(id)) idMap.set(id, crypto.randomUUID())
    for (const entry of Object.values(value)) registerPrescriptionIdentities(entry, idMap)
  }
}

function registerPortableIdentities(rowsFor: PortableRows, idMap: Map<string, string>): void {
  for (const table of PORTABLE_ENTITY_ID_TABLES) {
    for (const row of rowsFor(table)) {
      const id = row['id']
      if (typeof id !== 'string' || !id || idMap.has(id))
        throw new Error(`Portable identity is duplicated or invalid: ${String(id)}.`)
      idMap.set(id, crypto.randomUUID())
    }
  }
  for (const row of rowsFor('program_revisions')) {
    const design = validateProgramDesign(JSON.parse(String(row['design_json'])))
    for (const slot of design.slots) {
      if (idMap.has(slot.id)) throw new Error(`Portable identity is duplicated: ${slot.id}.`)
      idMap.set(slot.id, crypto.randomUUID())
    }
  }
  // Prescription identities recur across revisions; one map preserves their references
  // while making every imported graph independent of its source and prior imports.
  for (const table of ['template_revisions', 'routine_revisions'] as const)
    for (const row of rowsFor(table))
      registerPrescriptionIdentities(JSON.parse(String(row['prescription_json'])), idMap)
}

const PORTABLE_REFERENCE_COLUMNS = new Set([
  'id',
  'exercise_id',
  'template_id',
  'program_id',
  'week_id',
  'template_revision_id',
  'adopted_template_revision_id',
  'current_revision_id',
  'adopted_program_revision_id',
  'routine_id',
  'plan_id',
  'program_slot_id',
  'rotation_id',
  'goal_id',
  'workout_id',
  'appointment_id',
  'source_id',
  'set_id',
  'workout_exercise_id',
  'deload_template_id',
])

function remapPortableJson(
  table: PortableTable,
  column: string,
  value: string,
  idMap: Map<string, string>,
): string {
  try {
    const parsed: unknown = JSON.parse(value)
    if ((column === 'routine_ids_json' || column === 'substitutes') && Array.isArray(parsed))
      return JSON.stringify(
        parsed.map((id) => (typeof id === 'string' ? (idMap.get(id) ?? id) : id)),
      )
    if (column === 'inputs_json' && isTransferObject(parsed))
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(parsed).map(([id, entry]) => [idMap.get(id) ?? id, entry]),
        ),
      )
    return JSON.stringify(remapReference(parsed, idMap))
  } catch {
    throw new Error(`Portable ${table}.${column} is malformed JSON.`)
  }
}

function remapPortableRow(
  table: PortableTable,
  row: PortableRow,
  idMap: Map<string, string>,
): PortableRow {
  const next: PortableRow = {}
  for (const [column, value] of Object.entries(row)) {
    if (typeof value === 'string' && (column.endsWith('_json') || column === 'substitutes'))
      next[column] = remapPortableJson(table, column, value, idMap)
    else if (typeof value === 'string' && PORTABLE_REFERENCE_COLUMNS.has(column))
      next[column] = idMap.get(value) ?? value
    else next[column] = value
  }
  if (table === 'template_revisions' || table === 'routine_revisions')
    next['structure_hash'] = structuralFingerprint(
      parseSerializablePrescription(JSON.parse(String(next['prescription_json']))),
    )
  if (table === 'program_revisions')
    next['structure_hash'] = programStructureHash(
      validateProgramDesign(JSON.parse(String(next['design_json']))),
    )
  return next
}

async function insertPortableRow(
  tx: DbAdapter,
  table: PortableTable,
  row: PortableRow,
  idMap: Map<string, string>,
): Promise<void> {
  if (!isTransferObject(row)) throw new Error(`Invalid portable row in ${table}.`)
  if (table === 'exercises' && row['is_custom'] !== 1) return
  const next = remapPortableRow(table, row, idMap)
  if (
    table === 'exercises' &&
    row['is_custom'] === 1 &&
    typeof row['slug'] === 'string' &&
    (await tx.queryOne('SELECT id FROM exercises WHERE slug = ?', [row['slug']]))
  )
    next['slug'] = `${row['slug']}-${String(idMap.get(String(row['id']))).slice(0, 8)}`
  const columns = Object.keys(next)
  await tx.exec(
    `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(next),
  )
}

async function importPortable(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  const legacy = await prepareLegacyTemplate(db, input)
  if (legacy) return importLegacyTemplate(db, legacy)
  const preview = await previewPortableImport(db, input)
  if (!preview.valid) throw new Error(preview.error ?? 'Portable import validation failed.')
  if (!isTransferObject(input) || !isTransferObject(input['tables']))
    throw new Error('Portable import content is invalid.')
  const tables = normalizePortableTables(input['tables'], Number(input['version']))
  const rowsFor: PortableRows = (table) => tables[table] as PortableRow[]
  const idMap = await resolvePortableExerciseIds(db, rowsFor('exercises'))
  registerPortableIdentities(rowsFor, idMap)
  const insertOrder: PortableTable[] = [
    'exercises',
    'templates',
    'programs',
    'program_weeks',
    'template_groups',
    'template_exercises',
    'program_days',
    'template_revisions',
    'program_revisions',
    'saved_routines',
    'routine_revisions',
    'training_plans',
    'training_plan_bindings',
    'organization_appointments',
    'organization_recurrence_rules',
    'organization_rotations',
    'organization_rotation_advances',
    'organization_goals',
    'organization_goal_credits',
    'organization_source_links',
    'equipment_profiles',
  ]
  await db.transaction(async (tx) => {
    for (const table of insertOrder)
      for (const row of rowsFor(table)) await insertPortableRow(tx, table, row, idMap)
  })
  return preview
}
async function restoreBackup(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  const preview = await preflightRestore(db, input)
  if (!preview.valid) throw new Error(preview.error ?? 'Backup validation failed.')
  const { backup } = validateBackup(input)
  await db.transaction((tx) => applyBackupRestore(tx, backup))
  return preview
}

export async function dispatchTransfer(
  db: DbAdapter,
  type: string,
  payload: unknown,
): Promise<unknown> {
  if (type === 'TRANSFER_EXPORT_WORKOUT_CSV') {
    const rows = await db.queryAll<WorkoutCsvRow>(
      `SELECT w.date, w.session_type, w.started_at, w.ended_at, e.name AS exercise_name,
              s.set_num, s.weight_kg, s.reps, COALESCE(s.distance_m, r.distance_m) AS distance_m,
              COALESCE(s.duration_sec, r.duration_sec) AS duration_sec, s.notes
       FROM workouts w
       LEFT JOIN workout_exercises we ON we.workout_id = w.id AND we.removed_at IS NULL
       LEFT JOIN exercises e ON e.id = we.exercise_id
       LEFT JOIN sets s ON s.workout_exercise_id = we.id AND s.completed = 1 AND s.removed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM workout_set_skips k WHERE k.set_id = s.id)
       LEFT JOIN runs r ON r.workout_id = w.id
       WHERE w.ended_at IS NOT NULL
       ORDER BY w.date, w.started_at, we.order_num, s.set_num`,
    )
    return buildWorkoutCsv(rows)
  }
  const fields = isTransferObject(payload)
    ? payload
    : {
        settings: null,
        backup: payload,
        bundle: payload,
        content: payload,
      }
  switch (type) {
    case 'TRANSFER_EXPORT_BACKUP':
      return exportBackup(db, fields['settings'])
    case 'TRANSFER_PREVIEW_RESTORE':
      return preflightRestore(db, fields['backup'])
    case 'TRANSFER_RESTORE_BACKUP':
      return restoreBackup(db, fields['backup'])
    case 'TRANSFER_EXPORT_PORTABLE':
      return exportPortable(
        db,
        typeof fields['templateId'] === 'string' ? { templateId: fields['templateId'] } : undefined,
      )
    case 'TRANSFER_PREVIEW_PORTABLE_IMPORT':
      return previewPortableImport(db, fields['bundle'])
    case 'TRANSFER_IMPORT_PORTABLE':
      return importPortable(db, fields['bundle'])
    default:
      throw new Error(`Unknown transfer request: ${type}`)
  }
}
async function insertBackupRows(
  tx: DbAdapter,
  name: string,
  definition: BackupEnvelope['tables'][string],
): Promise<void> {
  const columns = await columnsFor(tx, name)
  const columnNames = columns.map((column) => column.name)
  for (const row of definition.rows) {
    const entries = Object.entries(row)
    validateRestoredRow(name, entries, columns)
    const insertColumns = entries.map(([column]) => quoteIdentifier(column))
    if (insertColumns.length === 0) throw new Error(`Empty backup row for ${name}.`)
    const binds = entries.map(([, value]) => value)
    await tx.exec(
      `INSERT INTO ${quoteIdentifier(name)} (${insertColumns.join(', ')}) VALUES (${binds.map(() => '?').join(', ')})`,
      binds,
    )
  }
  if (definition.columns.some((column) => !columnNames.includes(column))) {
    throw new Error(`Schema changed during restore for ${name}.`)
  }
}

function validateRestoredRow(
  name: string,
  entries: Array<[string, unknown]>,
  columns: SqliteColumn[],
): void {
  for (const [column, value] of entries) {
    const metadata = columns.find((item) => item.name === column)
    if (!metadata) throw new Error(`Unknown column ${name}.${column}.`)
    if (value === null && metadata.notnull && metadata.dflt_value === null && metadata.pk === 0) {
      throw new Error(`Required value missing for ${name}.${column}.`)
    }
  }
}

async function applyBackupRestore(tx: DbAdapter, backup: BackupEnvelope): Promise<void> {
  const currentTables = await discoverTables(tx)
  await tx.exec('PRAGMA defer_foreign_keys = ON')
  if (backup.version >= 2) {
    for (const name of currentTables) await tx.exec(`DELETE FROM ${quoteIdentifier(name)}`)
    for (const name of currentTables) {
      const definition = backup.tables[name]
      if (definition) await insertBackupRows(tx, name, definition)
    }
    return
  }
  for (const name of currentTables) {
    const definition = backup.tables[name]
    if (definition) await insertBackupRows(tx, name, definition)
  }
}
