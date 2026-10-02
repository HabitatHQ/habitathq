import type { AppSettings } from '~/composables/useAppSettings'
import { type ExportPayload, validateImportPayload } from '~/lib/template-export'
import type { DbAdapter } from '~/types/database'

export const BACKUP_FORMAT = 'hephaestus-backup'
export const BACKUP_VERSION = 1
export const PORTABLE_FORMAT = 'hephaestus-portable'
export const PORTABLE_VERSION = 1

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
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
  rowCount?: number
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
    value['version'] !== BACKUP_VERSION
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
      version: BACKUP_VERSION,
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
async function validateBackupSchema(db: DbAdapter, backup: BackupEnvelope): Promise<void> {
  const current = new Set(await discoverTables(db))
  const included = new Set(Object.keys(backup.tables))
  for (const name of current) {
    if (!included.has(name)) throw new Error(`Backup is missing supported app table ${name}.`)
  }
  for (const [name, table] of Object.entries(backup.tables)) {
    if (!current.has(name))
      throw new Error(`This app version does not support backup table ${name}.`)
    const metadata = await columnsFor(db, name)
    const currentColumns = new Set(metadata.map((column) => column.name))
    if (
      table.columns.length !== metadata.length ||
      table.columns.some((column) => !currentColumns.has(column))
    ) {
      throw new Error(`Backup does not contain the complete supported schema for ${name}.`)
    }
    validateBackupValues(name, table.rows, metadata)
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

async function preflightRestore(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  try {
    const { backup, rowCount } = validateBackup(input)
    parseBackupSettings(backup.settings)
    await validateBackupSchema(db, backup)
    return {
      valid: true,
      exportedAt: backup.exportedAt,
      workoutCount: backup.tables['workouts']?.rows.length ?? 0,
      templateCount: backup.tables['templates']?.rows.length ?? 0,
      programCount: backup.tables['programs']?.rows.length ?? 0,
      rowCount,
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  }
}

interface PortableBundle {
  format: typeof PORTABLE_FORMAT
  version: typeof PORTABLE_VERSION
  exportedAt: string
  tables: Record<string, Array<Record<string, unknown>>>
}

const PORTABLE_TABLES = [
  'exercises',
  'equipment_profiles',
  'templates',
  'programs',
  'program_weeks',
  'template_groups',
  'template_exercises',
  'program_days',
] as const

async function exportPortable(db: DbAdapter): Promise<PortableBundle> {
  const tables: PortableBundle['tables'] = {}
  for (const table of PORTABLE_TABLES) {
    if (table === 'exercises' || table === 'equipment_profiles') {
      tables[table] = await db.queryAll<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(table)}`,
      )
    } else if (table === 'programs') {
      tables[table] = await db.queryAll<Record<string, unknown>>(
        'SELECT * FROM programs WHERE is_builtin = 0',
      )
    } else if (table === 'program_weeks') {
      tables[table] = await db.queryAll<Record<string, unknown>>(
        'SELECT pw.* FROM program_weeks pw JOIN programs p ON p.id = pw.program_id WHERE p.is_builtin = 0',
      )
    } else if (table === 'program_days') {
      tables[table] = await db.queryAll<Record<string, unknown>>(
        'SELECT pd.* FROM program_days pd JOIN program_weeks pw ON pw.id = pd.week_id JOIN programs p ON p.id = pw.program_id WHERE p.is_builtin = 0',
      )
    } else {
      tables[table] = await db.queryAll<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(table)}`,
      )
    }
  }
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
  const currentById = new Map(current.map((exercise) => [exercise.id, exercise]))
  const currentBySlug = new Map(current.map((exercise) => [exercise.slug, exercise]))
  const incomingSlugs = new Set<string>()
  const idMap = new Map<string, string>()
  for (const row of rows) {
    const id = row['id']
    const slug = row['slug']
    const name = row['name']
    const movement = row['movement']
    const isCustom = row['is_custom']
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      typeof slug !== 'string' ||
      slug.length === 0 ||
      typeof name !== 'string' ||
      name.trim().length === 0 ||
      typeof movement !== 'string' ||
      movement.length === 0 ||
      (isCustom !== 0 && isCustom !== 1) ||
      incomingSlugs.has(slug)
    )
      throw new Error('Portable export contains an invalid or duplicate exercise.')
    incomingSlugs.add(slug)
    if (isCustom === 1) {
      if (currentById.has(id) || currentBySlug.has(slug)) {
        throw new Error(`Custom exercise already exists or its slug is taken: ${name}.`)
      }
      idMap.set(id, id)
      continue
    }
    const destination = currentBySlug.get(slug)
    if (!destination || destination.name !== name || destination.movement !== movement) {
      throw new Error(`Built-in exercise is missing or incompatible: ${name}.`)
    }
    idMap.set(id, destination.id)
  }
  return idMap
}

type PortableRow = Record<string, unknown>
type PortableTable = (typeof PORTABLE_TABLES)[number]
type PortableRows = (table: PortableTable) => PortableRow[]
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
async function portableIdentities(
  db: DbAdapter,
  rowsFor: PortableRows,
): Promise<{ incomingIds: Map<string, Set<string>>; currentIds: Map<string, Set<string>> }> {
  const incomingIds = new Map<string, Set<string>>()
  const currentIds = new Map<string, Set<string>>()
  for (const table of PORTABLE_TABLES) {
    const idColumn = table === 'equipment_profiles' ? 'exercise_id' : 'id'
    const ids = new Set<string>()
    for (const row of rowsFor(table)) {
      const id = row[idColumn]
      if (typeof id !== 'string' || id.length === 0 || ids.has(id)) {
        throw new Error(`Portable export has a missing or duplicate ${table} identity.`)
      }
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
function rejectPortableIdentityConflicts(
  incomingIds: Map<string, Set<string>>,
  currentIds: Map<string, Set<string>>,
): void {
  for (const table of PORTABLE_TABLES) {
    if (table === 'exercises' || table === 'equipment_profiles') continue
    for (const id of incomingIds.get(table) ?? []) {
      if (currentIds.get(table)?.has(id))
        throw new Error(`Portable ${table} row already exists: ${id}.`)
    }
  }
}
async function rejectPortableNameConflicts(db: DbAdapter, rowsFor: PortableRows): Promise<void> {
  for (const table of ['templates', 'programs'] as const) {
    const kind = table === 'templates' ? 'template' : 'program'
    const existingNames = new Set(
      (await db.queryAll<{ name: string }>(`SELECT name FROM ${quoteIdentifier(table)}`)).map(
        (row) => row.name.toLocaleLowerCase(),
      ),
    )
    const incomingNames = new Set<string>()
    for (const row of rowsFor(table)) {
      if (typeof row['name'] !== 'string' || row['name'].trim().length === 0) {
        throw new Error(`Invalid ${table} name.`)
      }
      const normalizedName = row['name'].trim().toLocaleLowerCase()
      if (existingNames.has(normalizedName)) {
        throw new Error(`A ${kind} with this name already exists: ${row['name']}.`)
      }
      if (incomingNames.has(normalizedName)) {
        throw new Error(`Duplicate ${kind} in portable export: ${row['name']}.`)
      }
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
async function previewPortableImport(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  try {
    if (
      !isTransferObject(input) ||
      input['format'] !== PORTABLE_FORMAT ||
      input['version'] !== PORTABLE_VERSION ||
      typeof input['exportedAt'] !== 'string' ||
      !Number.isFinite(Date.parse(input['exportedAt'])) ||
      !isTransferObject(input['tables'])
    )
      throw new Error('Unsupported or malformed portable export.')

    const tables = input['tables']
    if (
      Object.keys(tables).some(
        (name) => !PORTABLE_TABLES.includes(name as (typeof PORTABLE_TABLES)[number]),
      )
    ) {
      throw new Error('Portable export contains an unsupported table.')
    }
    const rowsFor = (table: (typeof PORTABLE_TABLES)[number]) =>
      tables[table] as Array<Record<string, unknown>>
    await validatePortableRows(db, tables, rowsFor)
    const { incomingIds, currentIds } = await portableIdentities(db, rowsFor)
    const exerciseRows = rowsFor('exercises')
    const exerciseIdMap = await resolvePortableExerciseIds(db, exerciseRows)
    rejectPortableIdentityConflicts(incomingIds, currentIds)
    await rejectPortableNameConflicts(db, rowsFor)
    const templateIds = incomingIds.get('templates') ?? new Set<string>()
    const programIds = incomingIds.get('programs') ?? new Set<string>()
    const weekIds = incomingIds.get('program_weeks') ?? new Set<string>()
    const validExerciseIds = new Set([
      ...(incomingIds.get('exercises') ?? []),
      ...(currentIds.get('exercises') ?? []),
    ])
    const programWeekLimits = await validatePortablePrograms(db, rowsFor)
    validatePortableWeeks(rowsFor, programIds, programWeekLimits)
    const groupLabelsByTemplate = validatePortableGroups(rowsFor, templateIds)
    validatePortableExercises(rowsFor, templateIds, validExerciseIds, groupLabelsByTemplate)
    validatePortableDays(rowsFor, weekIds, templateIds)
    validatePortableEquipment(rowsFor, validExerciseIds, exerciseIdMap, currentIds)
    const rowCount = PORTABLE_TABLES.reduce((sum, table) => sum + rowsFor(table).length, 0)
    return {
      valid: true,
      exportedAt: input['exportedAt'],
      templateCount: rowsFor('templates').length,
      programCount: rowsFor('programs').length,
      rowCount,
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function requireMappedExercise(
  source: unknown,
  exerciseIdMap: Map<string, string>,
  message: string,
): string {
  const mapped = exerciseIdMap.get(String(source))
  if (mapped === undefined) throw new Error(message)
  return mapped
}

function remapSubstitutes(value: string, exerciseIdMap: Map<string, string>): string {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) throw new Error()
    return JSON.stringify(
      parsed.map((id) =>
        requireMappedExercise(
          id,
          exerciseIdMap,
          'Portable template exercise has a missing substitute.',
        ),
      ),
    )
  } catch {
    throw new Error('Portable template exercise contains invalid substitute exercises.')
  }
}

function remapPortableValue(
  table: string,
  column: string,
  value: unknown,
  exerciseIdMap: Map<string, string>,
): unknown {
  if (table === 'template_exercises') {
    if (column === 'exercise_id')
      return requireMappedExercise(
        value,
        exerciseIdMap,
        'Portable template exercise refers to a missing exercise.',
      )
    if (column === 'substitutes' && typeof value === 'string')
      return remapSubstitutes(value, exerciseIdMap)
  }
  if (table === 'equipment_profiles' && column === 'exercise_id') {
    return requireMappedExercise(
      value,
      exerciseIdMap,
      'Portable equipment profile refers to a missing exercise.',
    )
  }
  return value
}
async function importPortable(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  const preview = await previewPortableImport(db, input)
  if (!preview.valid) throw new Error(preview.error ?? 'Portable import validation failed.')
  if (!isTransferObject(input) || !isTransferObject(input['tables'])) {
    throw new Error('Portable import content is invalid.')
  }
  const tables = input['tables']
  const exerciseRows = tables['exercises'] as Array<Record<string, unknown>>
  const exerciseIdMap = await resolvePortableExerciseIds(db, exerciseRows)
  const insertOrder = [
    'exercises',
    'templates',
    'programs',
    'program_weeks',
    'template_groups',
    'template_exercises',
    'program_days',
    'equipment_profiles',
  ]
  await db.transaction(async (tx) => {
    for (const table of insertOrder) {
      const rows = tables[table]
      if (!Array.isArray(rows)) throw new Error(`Portable export is missing ${table}.`)
      for (const row of rows) {
        if (!isTransferObject(row)) throw new Error(`Invalid portable row in ${table}.`)
        const entries = Object.entries(row).map(
          ([column, value]) =>
            [column, remapPortableValue(table, column, value, exerciseIdMap)] as const,
        )
        await tx.exec(
          `INSERT INTO ${quoteIdentifier(table)} (${entries.map(([column]) => quoteIdentifier(column)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`,
          entries.map(([, value]) => value),
        )
      }
    }
  })
  return preview
}
interface PreparedTemplateImport {
  payload: ExportPayload
  templateId: string
  exerciseIds: string[]
  groupIds: Map<string, string>
}

async function prepareTemplateImport(
  db: DbAdapter,
  input: unknown,
): Promise<PreparedTemplateImport> {
  if (!validateImportPayload(input)) throw new Error('Invalid template export content.')
  const payload = input
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM templates WHERE lower(name) = lower(?) LIMIT 1',
    [payload.template.name.trim()],
  )
  if (existing) throw new Error(`A template named "${payload.template.name}" already exists.`)
  const exerciseIds: string[] = []
  for (const exercise of payload.exercises) {
    const matches = await db.queryAll<{ id: string }>(
      'SELECT id FROM exercises WHERE lower(name) = lower(?) AND movement = ?',
      [exercise.exercise_name, exercise.exercise_movement],
    )
    if (exercise.deload_template_id !== null) {
      throw new Error(
        'This template links to another deload template; export and import the complete training bundle from Profile.',
      )
    }
    if (
      exercise.substitutes !== null &&
      (JSON.parse(exercise.substitutes) as unknown[]).length > 0
    ) {
      throw new Error(
        'This template uses substitute exercises; export and import the complete training bundle from Profile.',
      )
    }
    exerciseIds.push(requireSingleExerciseMatch(matches, exercise.exercise_name).id)
  }
  const groupIds = new Map<string, string>()
  const groupLabels = new Set<string>()
  for (const group of payload.groups) {
    if (groupIds.has(group.group_id))
      throw new Error(`Duplicate template group ID: ${group.group_id}.`)
    if (groupLabels.has(group.label))
      throw new Error(`Duplicate template group label: ${group.label}.`)
    groupIds.set(group.group_id, crypto.randomUUID())
    groupLabels.add(group.label)
  }
  for (const exercise of payload.exercises) {
    if (exercise.superset_group !== null && !groupLabels.has(exercise.superset_group)) {
      throw new Error('Template exercise refers to a group missing from the export.')
    }
  }
  return { payload, templateId: crypto.randomUUID(), exerciseIds, groupIds }
}

async function previewTemplateImport(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  try {
    const prepared = await prepareTemplateImport(db, input)
    return {
      valid: true,
      templateCount: 1,
      rowCount: 1 + prepared.payload.exercises.length + prepared.payload.groups.length,
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function requireSingleExerciseMatch(
  matches: Array<{ id: string }>,
  exerciseName: string,
): { id: string } {
  if (matches.length === 0) {
    throw new Error(`Exercise not found: ${exerciseName}. Import or create the exercise first.`)
  }
  if (matches.length > 1) throw new Error(`Exercise match is ambiguous: ${exerciseName}.`)
  const match = matches[0]
  if (!match)
    throw new Error(`Exercise not found: ${exerciseName}. Import or create the exercise first.`)
  return match
}
async function importTemplate(db: DbAdapter, input: unknown): Promise<RestorePreview> {
  const prepared = await prepareTemplateImport(db, input)
  const { payload, templateId, exerciseIds, groupIds } = prepared
  await db.transaction(async (tx) => {
    await tx.exec(
      `INSERT INTO templates (
        id, name, description, created_at, archived_at, sort_order, pinned_at, last_used_at,
        use_count, cover_emoji, scheduled_days, notification_enabled, notification_time
      ) VALUES (${Array.from({ length: 13 }, () => '?').join(', ')})`,
      [
        templateId,
        payload.template.name.trim(),
        payload.template.description,
        payload.template.created_at,
        payload.template.archived_at,
        payload.template.sort_order,
        payload.template.pinned_at,
        payload.template.last_used_at,
        payload.template.use_count,
        payload.template.cover_emoji,
        payload.template.scheduled_days,
        payload.template.notification_enabled,
        payload.template.notification_time,
      ],
    )
    for (const group of payload.groups) {
      await tx.exec(
        `INSERT INTO template_groups (
          id, template_id, label, name, group_type, transition_rest_sec, rest_after_round_sec,
          circuit_rest_mode, sort_order, display_name, rounds, amrap, time_cap_sec
        ) VALUES (${Array.from({ length: 13 }, () => '?').join(', ')})`,
        [
          groupIds.get(group.group_id),
          templateId,
          group.label,
          group.name,
          group.group_type,
          group.transition_rest_sec,
          group.rest_after_round_sec,
          group.circuit_rest_mode,
          group.sort_order,
          group.display_name,
          group.rounds,
          group.amrap,
          group.time_cap_sec,
        ],
      )
    }
    for (const [index, exercise] of payload.exercises.entries()) {
      await tx.exec(
        `INSERT INTO template_exercises (
          id, template_id, exercise_id, order_num, superset_group, sets_planned, reps_planned,
          rpe_target, increment_kg, rest_seconds, set_rest_seconds, transition_rest_sec,
          warmup_counts, set_scheme, notes, failure_target, rpe_targets, progression_rule,
          deload_template_id, substitutes, tempo, resistance_note, unilateral
        ) VALUES (${Array.from({ length: 23 }, () => '?').join(', ')})`,
        [
          crypto.randomUUID(),
          templateId,
          exerciseIds[index],
          exercise.order_num,
          exercise.superset_group,
          exercise.sets_planned,
          exercise.reps_planned,
          exercise.rpe_target,
          exercise.increment_kg,
          exercise.rest_seconds,
          exercise.set_rest_seconds,
          exercise.transition_rest_sec,
          exercise.warmup_counts,
          exercise.set_scheme,
          exercise.notes,
          exercise.failure_target,
          exercise.rpe_targets,
          exercise.progression_rule,
          null,
          exercise.substitutes,
          exercise.tempo,
          exercise.resistance_note,
          exercise.unilateral,
        ],
      )
    }
  })
  return {
    valid: true,
    templateCount: 1,
    rowCount: 1 + payload.exercises.length + payload.groups.length,
  }
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
       LEFT JOIN workout_exercises we ON we.workout_id = w.id
       LEFT JOIN exercises e ON e.id = we.exercise_id
       LEFT JOIN sets s ON s.workout_exercise_id = we.id AND s.completed = 1
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
      return exportPortable(db)
    case 'TRANSFER_PREVIEW_PORTABLE_IMPORT':
      return previewPortableImport(db, fields['bundle'])
    case 'TRANSFER_IMPORT_PORTABLE':
      return importPortable(db, fields['bundle'])
    case 'TRANSFER_PREVIEW_TEMPLATE_IMPORT':
      return previewTemplateImport(db, fields['content'])
    case 'TRANSFER_IMPORT_TEMPLATE':
      return importTemplate(db, fields['content'])
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
  const restoreTables = currentTables.filter((name) => Object.hasOwn(backup.tables, name))
  await tx.exec('PRAGMA defer_foreign_keys = ON')
  for (const name of restoreTables) await tx.exec(`DELETE FROM ${quoteIdentifier(name)}`)
  for (const name of restoreTables) {
    const definition = backup.tables[name]
    if (definition) await insertBackupRows(tx, name, definition)
  }
}
