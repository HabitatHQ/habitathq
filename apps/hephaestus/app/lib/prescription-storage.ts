import type { DbAdapter } from '@palladium/core'
import type { ProgramPhase, SetSchemeConfig } from '~/types/database'
import type {
  DomainOperation,
  DomainOperationMap,
  FutureUpdateCandidate,
  FutureUpdatePreview,
  NumericTarget,
  ProgramAddSlotRequest,
  ProgramAddWeekRequest,
  ProgramAdoptionPreview,
  ProgramCreateRequest,
  ProgramDesign,
  ProgramEditRequest,
  ProgramRevision,
  ProgramSlot,
  RoutineInputValue,
  RoutineRevision,
  SavedRoutine,
  SerializablePrescription,
  TemplateAdoptionIssue,
  TemplateAdoptionPreview,
  TemplateCreateRequest,
  TemplateEditRequest,
  TemplateRevision,
  TrainingPlan,
  TrainingPlanBinding,
  TrainingPlanSaveRequest,
} from '~/types/prescription'
import { PRESCRIPTION_EVALUATOR_VERSION, PRESCRIPTION_SCHEMA_VERSION } from '~/types/prescription'
import { addCalendarDays, localDateKey } from './analytics'
import { getRoutineReferencePlans } from './organization-storage'
import {
  parseSerializablePrescription,
  structuralFingerprint,
  validatePrescription,
  validatePrescriptionDraft,
  validateRoutineInputs,
} from './prescription-domain'
import { resolvePrescription, validatePrescriptionExpressions } from './prescription-evaluator'

type Row = Record<string, unknown>
type PrescriptionTargetEntry = { target: NumericTarget; field: string }
const OPERATIONS: {
  [K in DomainOperation]: (
    db: DbAdapter,
    input: unknown,
  ) => Promise<DomainOperationMap[K]['result']>
} = {
  TEMPLATE_CREATE: createTemplate,
  TEMPLATE_EDIT: editTemplate,
  TEMPLATE_DUPLICATE: duplicateTemplate,
  TEMPLATE_GET_REVISION: getTemplateRevision,
  TEMPLATE_UPDATE_METADATA: updateTemplateMetadata,
  ROUTINE_LIST: listRoutines,
  ROUTINE_GET: getRoutine,
  ROUTINE_SAVE: saveRoutine,
  ROUTINE_EDIT: editRoutine,
  ROUTINE_PREVIEW_TEMPLATE_ADOPTION: previewTemplateAdoption,
  ROUTINE_APPLY_TEMPLATE_ADOPTION: applyTemplateAdoption,
  ROUTINE_PREVIEW_FUTURE_UPDATE: previewFutureUpdate,
  ROUTINE_APPLY_FUTURE_UPDATE: applyFutureUpdate,
  PROGRAM_CREATE: createProgram,
  PROGRAM_EDIT: editProgram,
  PROGRAM_ADD_WEEK: addProgramWeek,
  PROGRAM_ADD_SLOT: addProgramSlot,
  PROGRAM_GET_REVISION: getProgramRevision,
  TRAINING_PLAN_SAVE: saveTrainingPlan,
  TRAINING_PLAN_PREVIEW_PROGRAM_ADOPTION: previewProgramAdoption,
  TRAINING_PLAN_APPLY_PROGRAM_ADOPTION: applyProgramAdoption,
  TRAINING_PLAN_BIND_ROUTINE: bindProgramRoutine,
}

function object(value: unknown, label: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Invalid ${label} request`)
  return value as Row
}
function routineInputValues(value: unknown, label: string): Record<string, RoutineInputValue> {
  const source = object(value, label)
  const result: Record<string, RoutineInputValue> = {}
  for (const [id, entry] of Object.entries(source)) {
    if (typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry)))
      result[id] = entry
    else throw new Error(`${label} contains an invalid value for ${id}`)
  }
  return result
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value
}

function nowOf(payload: Row): string {
  const value = payload['now']
  return typeof value === 'string' ? value : new Date().toISOString()
}

function json(value: unknown, label: string): unknown {
  if (typeof value !== 'string') throw new Error(`${label} is missing`)
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(`${label} is corrupt`)
  }
}

function parseRoutineInputs(
  value: unknown,
  prescription: SerializablePrescription,
): Record<string, RoutineInputValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Routine inputs are corrupt')
  const parsed: Record<string, RoutineInputValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' && typeof entry !== 'boolean')
      throw new Error(`Routine input ${key} is malformed`)
    parsed[key] = entry
  }
  return validateRoutineInputs(prescription, parsed)
}

function parseRoutineProvenance(value: unknown): {
  templateId: string
  adoptedTemplateRevisionId: string
} {
  const parsed = object(value, 'Routine provenance')
  return {
    templateId: text(parsed['templateId'], 'Routine provenance template'),
    adoptedTemplateRevisionId: text(
      parsed['adoptedTemplateRevisionId'],
      'Routine provenance revision',
    ),
  }
}
function unresolvedTarget(id: string, value: number): NumericTarget {
  return { id, rule: { kind: 'fixed', value }, resolvedValue: value }
}

function exactReps(
  value: string,
):
  | { kind: 'exact'; value: NumericTarget }
  | { kind: 'range'; minimum: number; maximum: number }
  | { kind: 'minimum'; minimum: number }
  | null {
  const textValue = value.trim()
  const exact = /^(\d+)$/.exec(textValue)
  if (exact) {
    const n = Number(exact[1])
    return { kind: 'exact', value: unresolvedTarget(crypto.randomUUID(), n) }
  }
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(textValue)
  if (range) return { kind: 'range', minimum: Number(range[1]), maximum: Number(range[2]) }
  const minimum = /^(\d+)\+$/.exec(textValue)
  if (minimum) return { kind: 'minimum', minimum: Number(minimum[1]) }
  return null
}

function emptyProvenance(kind: 'authored' | 'legacy_template', templateId: string | null = null) {
  return {
    kind,
    migratedAt: kind === 'legacy_template' ? new Date().toISOString() : null,
    legacyTemplateId: templateId,
    unresolvedFields: kind === 'legacy_template' ? ['load_targets', 'historical_set_roles'] : [],
  } as const
}

function legacySchemeConfig(value: string | null): SetSchemeConfig | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const object = parsed as Record<string, unknown>
  if (object['type'] === 'straight') return { type: 'straight' }
  const config = object['config']
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const fields = config as Record<string, unknown>
  const drops = fields['drops']
  const dropType = fields['dropType']
  const dropValue = fields['dropValue']
  if (
    object['type'] === 'drop_set' &&
    Number.isInteger(drops) &&
    (drops as number) >= 0 &&
    (drops as number) <= 100 &&
    (dropType === 'percent' || dropType === 'absolute') &&
    typeof dropValue === 'number' &&
    Number.isFinite(dropValue) &&
    dropValue >= 0
  )
    return { type: 'drop_set', config: { drops: drops as number, dropType, dropValue } }
  const pyramidTypes = [
    'pyramid_ascending',
    'pyramid_descending',
    'pyramid_full',
    'pyramid_rep',
  ] as const
  const type = fields['type']
  const steps = fields['steps']
  const startWeight = fields['startWeight']
  const weightStep = fields['weightStep']
  const stepType = fields['stepType']
  const repsPerStep = fields['repsPerStep']
  const restPerStep = fields['restPerStep']
  if (
    pyramidTypes.includes(object['type'] as (typeof pyramidTypes)[number]) &&
    ['ascending', 'descending', 'full', 'rep_only'].includes(String(type)) &&
    Number.isInteger(steps) &&
    (steps as number) > 0 &&
    (steps as number) <= 100 &&
    typeof startWeight === 'number' &&
    Number.isFinite(startWeight) &&
    startWeight >= 0 &&
    typeof weightStep === 'number' &&
    Number.isFinite(weightStep) &&
    weightStep >= 0 &&
    (stepType === 'absolute' || stepType === 'percent') &&
    Array.isArray(repsPerStep) &&
    repsPerStep.length <= 100 &&
    repsPerStep.every((entry) => Number.isInteger(entry) && entry >= 0) &&
    Array.isArray(restPerStep) &&
    restPerStep.length <= 100 &&
    restPerStep.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)
  )
    return {
      type: object['type'] as (typeof pyramidTypes)[number],
      config: {
        type: type as 'ascending' | 'descending' | 'full' | 'rep_only',
        steps: steps as number,
        startWeight,
        weightStep,
        stepType,
        repsPerStep,
        restPerStep,
      },
    }
  const clusterRestSec = fields['clusterRestSec']
  const clustersPlanned = fields['clustersPlanned']
  if (
    object['type'] === 'rest_pause' &&
    typeof clusterRestSec === 'number' &&
    Number.isFinite(clusterRestSec) &&
    clusterRestSec >= 0 &&
    Number.isInteger(clustersPlanned) &&
    (clustersPlanned as number) > 0 &&
    (clustersPlanned as number) <= 100
  )
    return {
      type: 'rest_pause',
      config: { clusterRestSec, clustersPlanned: clustersPlanned as number },
    }
  return null
}

type LegacyTemplateRow = {
  id: string
  exercise_id: string
  order_num: number
  sets_planned: number | null
  reps_planned: string | null
  rest_seconds: number | null
  set_rest_seconds: string | null
  superset_group: string | null
  set_scheme: string | null
  notes: string | null
  logging_mode: string
}

function parseLegacySetRests(value: string | null, markUnresolved: () => void): unknown {
  if (!value) return null
  try {
    const rests: unknown = JSON.parse(value)
    if (
      !Array.isArray(rests) ||
      rests.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0)
    )
      markUnresolved()
    return rests
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    markUnresolved()
    return null
  }
}

function legacySet(
  row: LegacyTemplateRow,
  scheme: SetSchemeConfig | null,
  setRests: unknown,
  index: number,
) {
  const schemeConfig =
    scheme?.type === 'pyramid_ascending' ||
    scheme?.type === 'pyramid_descending' ||
    scheme?.type === 'pyramid_full' ||
    scheme?.type === 'pyramid_rep'
      ? scheme.config
      : null
  const schemeReps = schemeConfig?.repsPerStep[index]
  const repText = schemeReps && schemeReps > 0 ? String(schemeReps) : row.reps_planned
  const reps = repText ? exactReps(repText) : null
  const schemeRest = schemeConfig?.restPerStep[index]
  const rest =
    Array.isArray(setRests) && typeof setRests[index] === 'number'
      ? Math.max(0, setRests[index])
      : typeof schemeRest === 'number'
        ? schemeRest
        : Math.max(0, row.rest_seconds ?? 120)
  const role =
    scheme?.type === 'drop_set'
      ? index === 0
        ? ('top' as const)
        : ('back_off' as const)
      : ('working' as const)
  return {
    id: crypto.randomUUID(),
    order: index + 1,
    role,
    reps,
    weightKg: null,
    restSec: unresolvedTarget(crypto.randomUUID(), rest),
    rpe: null,
    rir: null,
    notes: null,
    legacyScheme: row.set_scheme,
  }
}

function legacyActivity(
  row: LegacyTemplateRow,
  activityId: string,
  groupIds: Map<string, string>,
  markUnresolvedRests: () => void,
  markUnresolvedSchemes: () => void,
) {
  const scheme = legacySchemeConfig(row.set_scheme)
  if (row.set_scheme && !scheme) markUnresolvedSchemes()
  const setRests = parseLegacySetRests(row.set_rest_seconds, markUnresolvedRests)
  const count = Math.max(0, Math.min(100, Math.round(row.sets_planned ?? 0)))
  return {
    id: activityId,
    exerciseId: row.exercise_id,
    order: row.order_num,
    loggingMode: row.logging_mode as 'strength' | 'cardio' | 'distance',
    executionGroupId: row.superset_group ? (groupIds.get(row.superset_group) ?? null) : null,
    sets: Array.from({ length: count }, (_, index) => legacySet(row, scheme, setRests, index)),
    targets: { durationSec: null, distanceM: null },
    notes: row.notes,
  }
}

async function legacyTemplatePrescription(
  db: DbAdapter,
  templateId: string,
): Promise<SerializablePrescription> {
  const rows = await db.queryAll<LegacyTemplateRow>(
    `SELECT te.*, e.logging_mode FROM template_exercises te
     JOIN exercises e ON e.id=te.exercise_id WHERE te.template_id=? ORDER BY te.order_num`,
    [templateId],
  )
  const groupRows = await db.queryAll<{
    id: string
    label: string
    name: string | null
    group_type: string
    transition_rest_sec: number
    rest_after_round_sec: number
    circuit_rest_mode: string
    rounds: number
    amrap: number
    time_cap_sec: number | null
  }>('SELECT * FROM template_groups WHERE template_id=? ORDER BY sort_order,label', [templateId])
  const groupIds = new Map(groupRows.map((group) => [group.label, crypto.randomUUID()]))
  const activityIds = new Map(rows.map((row) => [row.id, crypto.randomUUID()]))
  const groups = groupRows.map((group) => ({
    id: groupIds.get(group.label) as string,
    label: group.label,
    name: group.name,
    type: group.group_type as 'superset' | 'giant_set' | 'circuit' | 'pre_exhaust',
    activityIds: rows
      .filter((row) => row.superset_group === group.label)
      .map((row) => activityIds.get(row.id) as string),
    transitionRestSec: Math.max(0, group.transition_rest_sec ?? 0),
    restAfterRoundSec: Math.max(0, group.rest_after_round_sec ?? 0),
    circuitRestMode: group.circuit_rest_mode as 'after_round' | 'after_each',
    rounds: Math.max(1, group.rounds ?? 1),
    amrap: group.amrap === 1,
    timeCapSec: group.time_cap_sec,
  }))
  let unresolvedSetRests = false
  let unresolvedSetSchemes = false
  const activities = rows.map((row) => {
    const activity = legacyActivity(
      row,
      activityIds.get(row.id) as string,
      groupIds,
      () => {
        unresolvedSetRests = true
      },
      () => {
        unresolvedSetSchemes = true
      },
    )
    return activity
  })
  const prescription: SerializablePrescription = {
    schemaVersion: PRESCRIPTION_SCHEMA_VERSION,
    evaluatorVersion: PRESCRIPTION_EVALUATOR_VERSION,
    inputs: [],
    defaults: { incrementKg: 2.5, restSec: 120 },
    groups,
    activities,
    provenance: {
      ...emptyProvenance('legacy_template', templateId),
      unresolvedFields: [
        ...emptyProvenance('legacy_template', templateId).unresolvedFields,
        ...(unresolvedSetRests ? ['set_rest_seconds'] : []),
        ...(unresolvedSetSchemes ? ['set_scheme'] : []),
      ],
    },
  }
  return validatePrescription(prescription)
}

async function nextTemplateRevision(db: DbAdapter, templateId: string): Promise<number> {
  const row = await db.queryOne<{ revision_num: number }>(
    'SELECT COALESCE(MAX(revision_num),0) AS revision_num FROM template_revisions WHERE template_id=?',
    [templateId],
  )
  return (row?.revision_num ?? 0) + 1
}

async function insertTemplateRevision(
  db: DbAdapter,
  templateId: string,
  prescription: SerializablePrescription,
  createdAt: string,
): Promise<TemplateRevision> {
  const revisionNumber = await nextTemplateRevision(db, templateId)
  const id = crypto.randomUUID()
  const structureHash = structuralFingerprint(prescription)
  await db.exec(
    'INSERT INTO template_revisions (id,template_id,revision_num,prescription_json,structure_hash,created_at) VALUES (?,?,?,?,?,?)',
    [id, templateId, revisionNumber, JSON.stringify(prescription), structureHash, createdAt],
  )
  return { id, templateId, revisionNumber, prescription, structureHash, createdAt }
}

async function loadTemplateRevision(
  db: DbAdapter,
  templateId: string,
  revisionId?: string,
): Promise<TemplateRevision> {
  const row = revisionId
    ? await db.queryOne<{
        id: string
        revision_num: number
        prescription_json: string
        structure_hash: string
        created_at: string
      }>('SELECT * FROM template_revisions WHERE template_id=? AND id=?', [templateId, revisionId])
    : await db.queryOne<{
        id: string
        revision_num: number
        prescription_json: string
        structure_hash: string
        created_at: string
      }>(
        'SELECT * FROM template_revisions WHERE template_id=? ORDER BY revision_num DESC LIMIT 1',
        [templateId],
      )
  if (!row) throw new Error(`Template revision for ${templateId} not found`)
  return {
    id: row.id,
    templateId,
    revisionNumber: row.revision_num,
    prescription: parseSerializablePrescription(json(row.prescription_json, 'Template revision')),
    structureHash: row.structure_hash,
    createdAt: row.created_at,
  }
}

async function ensureTemplateRevision(
  db: DbAdapter,
  templateId: string,
): Promise<TemplateRevision> {
  const template = await db.queryOne<{ id: string }>('SELECT id FROM templates WHERE id=?', [
    templateId,
  ])
  if (!template) throw new Error(`Template ${templateId} not found`)
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM template_revisions WHERE template_id=? ORDER BY revision_num DESC LIMIT 1',
    [templateId],
  )
  if (existing) return loadTemplateRevision(db, templateId, existing.id)
  return insertTemplateRevision(
    db,
    templateId,
    await legacyTemplatePrescription(db, templateId),
    new Date().toISOString(),
  )
}

function projectPrescription(prescription: SerializablePrescription) {
  return prescription.activities.map((activity) => {
    const exactRepTargets = activity.sets.map((set) =>
      set.reps?.kind === 'exact' && set.reps.value.rule.kind === 'fixed'
        ? String(set.reps.value.rule.value)
        : null,
    )
    return {
      activity,
      setsPlanned: activity.sets.length,
      repsPlanned:
        exactRepTargets.length && exactRepTargets.every((value) => value === exactRepTargets[0])
          ? exactRepTargets[0]
          : null,
      setScheme: activity.sets.find((set) => set.legacyScheme)?.legacyScheme ?? null,
      restSeconds:
        activity.sets[0]?.restSec?.rule.kind === 'fixed'
          ? activity.sets[0].restSec.rule.value
          : 120,
    }
  })
}

async function writeTemplateProjection(
  db: DbAdapter,
  templateId: string,
  prescription: SerializablePrescription,
): Promise<void> {
  await db.exec('DELETE FROM template_exercises WHERE template_id=?', [templateId])
  await db.exec('DELETE FROM template_groups WHERE template_id=?', [templateId])
  for (const [index, group] of prescription.groups.entries()) {
    await db.exec(
      `INSERT INTO template_groups (id,template_id,label,name,group_type,transition_rest_sec,rest_after_round_sec,circuit_rest_mode,sort_order,display_name,rounds,amrap,time_cap_sec)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        group.id,
        templateId,
        group.label,
        group.name,
        group.type,
        group.transitionRestSec,
        group.restAfterRoundSec,
        group.circuitRestMode,
        index,
        group.name,
        group.rounds,
        group.amrap ? 1 : 0,
        group.timeCapSec,
      ],
    )
  }
  for (const projected of projectPrescription(prescription)) {
    const activity = projected.activity
    await db.exec(
      `INSERT INTO template_exercises (id,template_id,exercise_id,order_num,superset_group,sets_planned,reps_planned,rpe_target,increment_kg,rest_seconds,set_rest_seconds,transition_rest_sec,warmup_counts,set_scheme,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        activity.id,
        templateId,
        activity.exerciseId,
        activity.order,
        prescription.groups.find((group) => group.id === activity.executionGroupId)?.label ?? null,
        projected.setsPlanned,
        projected.repsPlanned,
        null,
        prescription.defaults.incrementKg,
        projected.restSeconds,
        JSON.stringify(
          activity.sets.map((set) =>
            set.restSec?.rule.kind === 'fixed' ? set.restSec.rule.value : projected.restSeconds,
          ),
        ),
        null,
        0,
        projected.setScheme,
        activity.notes,
      ],
    )
  }
}

async function createTemplate(db: DbAdapter, input: unknown): Promise<TemplateRevision> {
  const payload = object(input, 'template create') as unknown as TemplateCreateRequest
  validatePrescriptionDraft(payload)
  validatePrescriptionExpressions(payload.prescription)
  const name = payload.name.trim()
  const description = payload.description ?? null
  const createdAt = payload.now ?? new Date().toISOString()
  const templateId = payload.id ?? crypto.randomUUID()
  await db.exec('INSERT INTO templates (id,name,description,created_at) VALUES (?,?,?,?)', [
    templateId,
    name,
    description,
    createdAt,
  ])
  await writeTemplateProjection(db, templateId, payload.prescription)
  return insertTemplateRevision(db, templateId, payload.prescription, createdAt)
}

async function editTemplate(db: DbAdapter, input: unknown): Promise<TemplateRevision> {
  const payload = object(input, 'template edit') as unknown as TemplateEditRequest
  validatePrescriptionDraft({
    name: payload.name,
    description: payload.description,
    prescription: payload.prescription,
  })
  validatePrescriptionExpressions(payload.prescription)
  const current = await loadTemplateRevision(db, payload.templateId)
  if (current.id !== payload.expectedRevisionId)
    throw new Error('Template changed since this edit began')
  const createdAt = payload.now ?? new Date().toISOString()
  await db.exec('UPDATE templates SET name=?,description=? WHERE id=?', [
    payload.name.trim(),
    payload.description,
    payload.templateId,
  ])
  await writeTemplateProjection(db, payload.templateId, payload.prescription)
  return insertTemplateRevision(db, payload.templateId, payload.prescription, createdAt)
}

async function duplicateTemplate(db: DbAdapter, input: unknown): Promise<TemplateRevision> {
  const payload = object(input, 'template duplicate')
  const source = await loadTemplateRevision(db, text(payload['templateId'], 'Template identity'))
  const cloned = structuredClone(source.prescription)
  for (const group of cloned.groups) group.id = crypto.randomUUID()
  const oldGroups = new Map(
    source.prescription.groups.map((group, index) => [group.id, cloned.groups[index]?.id ?? '']),
  )
  for (const activity of cloned.activities) {
    activity.id = crypto.randomUUID()
    if (activity.executionGroupId)
      activity.executionGroupId = oldGroups.get(activity.executionGroupId) ?? null
    for (const set of activity.sets) {
      set.id = crypto.randomUUID()
      if (set.reps?.kind === 'exact') set.reps.value.id = crypto.randomUUID()
      for (const target of [set.weightKg, set.restSec, set.rpe, set.rir])
        if (target) target.id = crypto.randomUUID()
    }
  }
  for (const group of cloned.groups)
    group.activityIds = group.activityIds.map((id, index) => cloned.activities[index]?.id ?? id)
  const request = {
    name: typeof payload['name'] === 'string' ? payload['name'] : `Copy of ${source.templateId}`,
    description: null,
    prescription: cloned,
    now: payload['now'],
  }
  return createTemplate(db, request)
}

function applyFixedTargetValues(prescription: SerializablePrescription, value: unknown): void {
  if (value === undefined) return
  const values = object(value, 'fixed target values')
  const targets = prescription.activities.flatMap((activity) => [
    activity.targets.durationSec,
    activity.targets.distanceM,
    ...activity.sets.flatMap((set) => [
      set.weightKg,
      set.restSec,
      set.rpe,
      set.rir,
      set.reps?.kind === 'exact' ? set.reps.value : null,
    ]),
  ])
  for (const [id, unknownValue] of Object.entries(values)) {
    if (typeof unknownValue !== 'number' || !Number.isFinite(unknownValue) || unknownValue < 0)
      throw new Error(`Fixed target ${id} must be finite and nonnegative`)
    const target = targets.find((entry) => entry?.id === id)
    if (target?.rule.kind !== 'fixed')
      throw new Error(`Routine edits may only change directly authored fixed target ${id}`)
    target.rule.value = unknownValue
    target.resolvedValue = unknownValue
  }
}
async function saveRoutine(db: DbAdapter, input: unknown): Promise<RoutineRevision> {
  const payload = object(input, 'routine save')
  const templateId = text(payload['templateId'], 'Template identity')
  const templateRevisionId = text(payload['templateRevisionId'], 'Template revision')
  const templateRevision = await loadTemplateRevision(db, templateId, templateRevisionId)
  const inputs = parseRoutineInputs(payload['inputs'], templateRevision.prescription)
  const prescription = structuredClone(templateRevision.prescription)
  applyFixedTargetValues(prescription, payload['fixedTargetValues'])
  const resolvedPrescription = resolvePrescription(prescription, inputs)
  const continuationPolicy = payload['continuationPolicy']
  const deferralMode = payload['deferralMode']
  if (continuationPolicy !== 'calendar_bound' && continuationPolicy !== 'carry_forward')
    throw new Error('Invalid continuation policy')
  if (
    continuationPolicy === 'carry_forward' &&
    deferralMode !== 'automatic' &&
    deferralMode !== 'manual'
  )
    throw new Error('Carry-forward routines require an automatic or manual deferral mode')
  if (continuationPolicy === 'calendar_bound' && deferralMode !== null)
    throw new Error('Calendar-bound routines cannot have a deferral mode')
  const now = nowOf(payload)
  const routineId = typeof payload['id'] === 'string' ? payload['id'] : crypto.randomUUID()
  const revisionId = crypto.randomUUID()
  const structureHash = templateRevision.structureHash
  const provenance = { templateId, adoptedTemplateRevisionId: templateRevisionId }
  const revision: RoutineRevision = {
    id: revisionId,
    routineId,
    revisionNumber: 1,
    prescription: resolvedPrescription,
    inputs,
    provenance,
    structureHash,
    createdAt: now,
  }
  await db.exec(
    'INSERT INTO saved_routines (id,name,template_id,adopted_template_revision_id,current_revision_id,continuation_policy,deferral_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      routineId,
      text(payload['name'], 'Routine name').trim(),
      templateId,
      templateRevisionId,
      revisionId,
      continuationPolicy,
      deferralMode,
      now,
      now,
    ],
  )
  await db.exec(
    'INSERT INTO routine_revisions (id,routine_id,revision_num,prescription_json,inputs_json,provenance_json,structure_hash,created_at) VALUES (?,?,1,?,?,?,?,?)',
    [
      revisionId,
      routineId,
      JSON.stringify(resolvedPrescription),
      JSON.stringify(inputs),
      JSON.stringify(provenance),
      structureHash,
      now,
    ],
  )
  return revision
}

export async function getRoutineSnapshot(db: DbAdapter, routineId: string) {
  return routineWithRevision(db, routineId)
}
async function routineWithRevision(db: DbAdapter, routineId: string) {
  const routine = await db.queryOne<{
    id: string
    name: string
    template_id: string
    adopted_template_revision_id: string
    current_revision_id: string
    continuation_policy: 'calendar_bound' | 'carry_forward'
    deferral_mode: 'automatic' | 'manual' | null
  }>('SELECT * FROM saved_routines WHERE id=?', [routineId])
  if (!routine) throw new Error(`Routine ${routineId} not found`)
  const revision = await db.queryOne<{
    id: string
    revision_num: number
    prescription_json: string
    inputs_json: string
    provenance_json: string
    structure_hash: string
    created_at: string
  }>('SELECT * FROM routine_revisions WHERE id=? AND routine_id=?', [
    routine.current_revision_id,
    routineId,
  ])
  if (!revision) throw new Error('Routine current revision is missing')
  const prescription = parseSerializablePrescription(
    json(revision.prescription_json, 'Routine prescription'),
  )
  return {
    routine: {
      id: routine.id,
      name: routine.name,
      templateId: routine.template_id,
      adoptedTemplateRevisionId: routine.adopted_template_revision_id,
      currentRevisionId: routine.current_revision_id,
      continuationPolicy: routine.continuation_policy,
      deferralMode: routine.deferral_mode,
      createdAt: revision.created_at,
      updatedAt: revision.created_at,
    } as SavedRoutine,
    revision: {
      id: revision.id,
      routineId,
      revisionNumber: revision.revision_num,
      prescription,
      inputs: parseRoutineInputs(json(revision.inputs_json, 'Routine inputs'), prescription),
      provenance: parseRoutineProvenance(json(revision.provenance_json, 'Routine provenance')),
      structureHash: revision.structure_hash,
      createdAt: revision.created_at,
    } as RoutineRevision,
  }
}

async function editRoutine(db: DbAdapter, input: unknown): Promise<RoutineRevision> {
  const payload = object(input, 'routine edit')
  const id = text(payload['routineId'], 'Routine identity')
  const { routine, revision: current } = await routineWithRevision(db, id)
  if (current.id !== payload['expectedRevisionId'])
    throw new Error('Routine changed since this edit began')
  const inputs = parseRoutineInputs(payload['inputs'], current.prescription)
  const draftPrescription = structuredClone(current.prescription)
  applyFixedTargetValues(draftPrescription, payload['fixedTargetValues'])
  const prescription = resolvePrescription(draftPrescription, inputs)
  const now = nowOf(payload)
  const nextNumber = current.revisionNumber + 1
  const revisionId = crypto.randomUUID()
  const revision: RoutineRevision = {
    id: revisionId,
    routineId: id,
    revisionNumber: nextNumber,
    prescription,
    inputs,
    provenance: current.provenance,
    structureHash: current.structureHash,
    createdAt: now,
  }
  await db.exec(
    'INSERT INTO routine_revisions (id,routine_id,revision_num,prescription_json,inputs_json,provenance_json,structure_hash,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [
      revisionId,
      id,
      nextNumber,
      JSON.stringify(prescription),
      JSON.stringify(inputs),
      JSON.stringify(revision.provenance),
      revision.structureHash,
      now,
    ],
  )
  const continuationPolicy = payload['continuationPolicy'] ?? routine.continuationPolicy
  const deferralMode =
    payload['deferralMode'] === undefined ? routine.deferralMode : payload['deferralMode']
  if (
    continuationPolicy === 'carry_forward' &&
    deferralMode !== 'automatic' &&
    deferralMode !== 'manual'
  )
    throw new Error('Carry-forward routines require an automatic or manual deferral mode')
  await db.exec(
    'UPDATE saved_routines SET name=?,current_revision_id=?,continuation_policy=?,deferral_mode=?,updated_at=? WHERE id=?',
    [
      typeof payload['name'] === 'string' ? payload['name'].trim() : routine.name,
      revisionId,
      continuationPolicy,
      deferralMode,
      now,
      id,
    ],
  )
  return revision
}

function adoptionInputChanges(
  previous: SerializablePrescription['inputs'],
  next: SerializablePrescription['inputs'],
  savedInputs: Record<string, RoutineInputValue>,
): {
  issues: TemplateAdoptionIssue[]
  preservedInputs: Record<string, RoutineInputValue>
} {
  const issues: TemplateAdoptionIssue[] = []
  const preservedInputs: Record<string, RoutineInputValue> = {}
  for (const oldInput of previous) {
    const nextInput = next.find((entry) => entry.id === oldInput.id)
    if (!nextInput) {
      issues.push({
        kind: 'input_removed',
        identity: oldInput.id,
        message: `${oldInput.name} was removed.`,
      })
      continue
    }
    if (oldInput.field !== nextInput.field) {
      issues.push({
        kind: 'input_type_changed',
        identity: oldInput.id,
        message: `${oldInput.name} changed from ${oldInput.field} to ${nextInput.field}.`,
      })
      continue
    }
    const existing = savedInputs[oldInput.id]
    if (
      existing !== undefined &&
      (typeof existing === 'boolean' ||
        ((nextInput.minimum === null || existing >= nextInput.minimum) &&
          (nextInput.maximum === null || existing <= nextInput.maximum)))
    )
      preservedInputs[oldInput.id] = existing
    else if (nextInput.required && nextInput.defaultValue === null)
      issues.push({
        kind: 'input_required',
        identity: nextInput.id,
        message: `${nextInput.name} needs a replacement value.`,
      })
    if (oldInput.minimum !== nextInput.minimum || oldInput.maximum !== nextInput.maximum)
      issues.push({
        kind: 'input_bounds_changed',
        identity: nextInput.id,
        message: `${nextInput.name} bounds changed; review the retained value.`,
      })
  }
  return { issues, preservedInputs }
}

function adoptionTargetChanges(
  previous: PrescriptionTargetEntry[],
  next: PrescriptionTargetEntry[],
): {
  issues: TemplateAdoptionIssue[]
  preservedFixedTargetValues: Record<string, number>
} {
  const issues: TemplateAdoptionIssue[] = []
  const oldTargets = new Map(previous.map((entry) => [entry.target.id, entry.target]))
  const preservedFixedTargetValues: Record<string, number> = {}
  for (const { target: nextTarget } of next) {
    const old = oldTargets.get(nextTarget.id)
    if (!old) continue
    if (
      old.rule.kind === 'fixed' &&
      nextTarget.rule.kind === 'fixed' &&
      old.rule.value !== nextTarget.rule.value
    )
      preservedFixedTargetValues[nextTarget.id] = old.rule.value
    else if (old.rule.kind !== nextTarget.rule.kind)
      issues.push({
        kind: 'target_rule_changed',
        identity: nextTarget.id,
        message: `Target ${nextTarget.id} changed rule type; review its new value.`,
      })
    else if (
      old.rule.kind === 'formula' &&
      nextTarget.rule.kind === 'formula' &&
      JSON.stringify(old.rule.bindings) !== JSON.stringify(nextTarget.rule.bindings)
    )
      issues.push({
        kind: 'target_reference_changed',
        identity: nextTarget.id,
        message: `Target ${nextTarget.id} changed formula references.`,
      })
  }
  for (const old of oldTargets.values())
    if (!next.some((entry) => entry.target.id === old.id))
      issues.push({
        kind: 'target_removed',
        identity: old.id,
        message: `Target ${old.id} was removed.`,
      })
  return { issues, preservedFixedTargetValues }
}

async function previewTemplateAdoption(
  db: DbAdapter,
  input: unknown,
): Promise<TemplateAdoptionPreview> {
  const payload = object(input, 'template adoption preview')
  const routineId = text(payload['routineId'], 'Routine identity')
  const { routine, revision } = await routineWithRevision(db, routineId)
  const target = await loadTemplateRevision(
    db,
    routine.templateId,
    text(payload['templateRevisionId'], 'Template revision'),
  )

  const inputChanges = adoptionInputChanges(
    revision.prescription.inputs,
    target.prescription.inputs,
    revision.inputs,
  )
  const targetChanges = adoptionTargetChanges(
    targetEntries(revision.prescription),
    targetEntries(target.prescription),
  )
  const issues = [...inputChanges.issues, ...targetChanges.issues]
  const preservedInputs = inputChanges.preservedInputs
  const preservedFixedTargetValues = targetChanges.preservedFixedTargetValues
  const preview: TemplateAdoptionPreview = {
    previewId: crypto.randomUUID(),
    routineId,
    currentRoutineRevisionId: revision.id,
    targetTemplateRevisionId: target.id,
    compatible: issues.length === 0,
    issues,
    preservedInputs,
    preservedFixedTargetValues,
    prescription: target.prescription,
  }
  await db.exec(
    'INSERT INTO prescription_previews (id,kind,owner_id,snapshot_json,created_at) VALUES (?,?,?,?,?)',
    [
      preview.previewId,
      'template_adoption',
      routineId,
      JSON.stringify(preview),
      new Date().toISOString(),
    ],
  )
  return preview
}

async function applyTemplateAdoption(db: DbAdapter, input: unknown): Promise<RoutineRevision> {
  const payload = object(input, 'template adoption apply')
  const previewId = text(payload['previewId'], 'Template adoption preview')
  const stored = await db.queryOne<{ owner_id: string; snapshot_json: string }>(
    'SELECT owner_id,snapshot_json FROM prescription_previews WHERE id=? AND kind=?',
    [previewId, 'template_adoption'],
  )
  if (!stored) throw new Error('Template adoption preview is missing or expired')
  const preview = object(
    json(stored.snapshot_json, 'Template adoption preview'),
    'Template adoption preview',
  )
  const routineId = text(preview['routineId'], 'Routine identity')
  if (routineId !== stored.owner_id || preview['previewId'] !== previewId)
    throw new Error('Template adoption preview is invalid')
  const { routine, revision } = await routineWithRevision(db, routineId)
  if (revision.id !== preview['currentRoutineRevisionId'])
    throw new Error('Routine changed after adoption preview')
  const target = await loadTemplateRevision(
    db,
    routine.templateId,
    text(preview['targetTemplateRevisionId'], 'Template revision'),
  )
  const latestTarget = await loadTemplateRevision(db, routine.templateId)
  if (latestTarget.id !== target.id) throw new Error('Template changed after adoption preview')
  const preservedInputs = routineInputValues(preview['preservedInputs'], 'Preserved inputs')
  const replacementInputs = routineInputValues(payload['inputs'], 'Replacement inputs')
  const inputs = validateRoutineInputs(target.prescription, {
    ...preservedInputs,
    ...replacementInputs,
  })
  const prescription = structuredClone(target.prescription)
  applyFixedTargetValues(prescription, {
    ...object(preview['preservedFixedTargetValues'], 'Preserved target values'),
    ...object(payload['fixedTargetValues'], 'Replacement fixed targets'),
  })
  validatePrescriptionExpressions(prescription)
  const resolvedPrescription = resolvePrescription(prescription, inputs)
  const revisionId = crypto.randomUUID()
  const now = nowOf(payload)
  const next: RoutineRevision = {
    id: revisionId,
    routineId: routine.id,
    revisionNumber: revision.revisionNumber + 1,
    prescription: resolvedPrescription,
    inputs,
    provenance: { templateId: routine.templateId, adoptedTemplateRevisionId: target.id },
    structureHash: target.structureHash,
    createdAt: now,
  }
  await db.exec(
    'INSERT INTO routine_revisions (id,routine_id,revision_num,prescription_json,inputs_json,provenance_json,structure_hash,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [
      revisionId,
      routine.id,
      next.revisionNumber,
      JSON.stringify(next.prescription),
      JSON.stringify(inputs),
      JSON.stringify(next.provenance),
      target.structureHash,
      now,
    ],
  )
  await db.exec(
    'UPDATE saved_routines SET adopted_template_revision_id=?,current_revision_id=?,updated_at=? WHERE id=?',
    [target.id, revisionId, now, routine.id],
  )
  await db.exec('DELETE FROM prescription_previews WHERE id=?', [previewId])
  return next
}
function targetsById(prescription: SerializablePrescription): Map<string, PrescriptionTargetEntry> {
  const result = new Map<string, PrescriptionTargetEntry>()
  const add = (target: NumericTarget | null, field: string) => {
    if (target) result.set(target.id, { target, field })
  }
  for (const activity of prescription.activities) {
    add(activity.targets.durationSec, 'durationSec')
    add(activity.targets.distanceM, 'distanceM')
    for (const set of activity.sets) {
      if (set.reps?.kind === 'exact') add(set.reps.value, 'reps')
      add(set.weightKg, 'weightKg')
      add(set.restSec, 'restSec')
      add(set.rpe, 'rpe')
      add(set.rir, 'rir')
    }
  }
  return result
}
function targetEntries(prescription: SerializablePrescription): PrescriptionTargetEntry[] {
  return Array.from(targetsById(prescription).values())
}
function actualValuesByTarget(
  rows: {
    intent_set_id: string
    weight_kg: number | null
    reps: number | null
    rpe: number | null
    rir: number | null
    duration_sec: number | null
    distance_m: number | null
    completed: number
  }[],
  prescription: SerializablePrescription,
): Map<string, number[]> {
  const targetsBySet = new Map<string, Record<string, NumericTarget | null>>()
  for (const activity of prescription.activities) {
    for (const set of activity.sets) {
      targetsBySet.set(set.id, {
        weightKg: set.weightKg,
        reps: set.reps?.kind === 'exact' ? set.reps.value : null,
        rpe: set.rpe,
        rir: set.rir,
        durationSec: activity.targets.durationSec,
        distanceM: activity.targets.distanceM,
      })
    }
  }
  const actualByTarget = new Map<string, number[]>()
  for (const row of rows) {
    if (!row.completed) continue
    const targets = targetsBySet.get(row.intent_set_id)
    if (!targets) continue
    const valueByField = {
      weightKg: row.weight_kg,
      reps: row.reps,
      rpe: row.rpe,
      rir: row.rir,
      durationSec: row.duration_sec,
      distanceM: row.distance_m,
    }
    for (const [field, value] of Object.entries(valueByField)) {
      const target = targets[field]
      if (!target || value === null) continue
      const values = actualByTarget.get(target.id) ?? []
      values.push(value)
      actualByTarget.set(target.id, values)
    }
  }
  return actualByTarget
}

function normalizedActualValues(
  values: number[],
  field: string,
  intensityModifier: number | null,
): number[] | null {
  if (field === 'weightKg' && (intensityModifier === null || intensityModifier <= 0)) return null
  return values.map((value) =>
    field === 'weightKg' && intensityModifier !== null ? value / intensityModifier : value,
  )
}

function agreedActualValue(values: number[]): { value: number } | { ambiguous: true } | null {
  const first = values.at(0)
  if (first === undefined) return null
  if (values.some((value) => value !== first)) return { ambiguous: true }
  return { value: first }
}

function fixedFutureUpdateCandidate(
  id: string,
  oldTarget: PrescriptionTargetEntry,
  nextTarget: PrescriptionTargetEntry | undefined,
  actualValues: number[] | undefined,
  intensityModifier: number | null,
): { candidate: FutureUpdateCandidate | null; ambiguous: boolean } {
  if (
    !nextTarget ||
    oldTarget.target.rule.kind !== 'fixed' ||
    nextTarget.target.rule.kind !== 'fixed' ||
    !actualValues?.length
  )
    return { candidate: null, ambiguous: false }
  const normalizedValues = normalizedActualValues(actualValues, oldTarget.field, intensityModifier)
  if (!normalizedValues || normalizedValues.some((value) => !Number.isFinite(value)))
    return { candidate: null, ambiguous: false }
  const agreement = agreedActualValue(normalizedValues)
  if (!agreement) return { candidate: null, ambiguous: false }
  if ('ambiguous' in agreement) return { candidate: null, ambiguous: true }
  const currentValue = nextTarget.target.rule.value
  if (agreement.value === currentValue) return { candidate: null, ambiguous: false }
  const capturedValue =
    oldTarget.field === 'weightKg' && intensityModifier !== null
      ? (oldTarget.target.resolvedValue ?? oldTarget.target.rule.value) / intensityModifier
      : oldTarget.target.rule.value
  return {
    candidate: {
      id,
      kind: 'fixed_target',
      label: `${oldTarget.field} target`,
      identity: id,
      capturedValue,
      actualValue: agreement.value,
      currentValue,
      proposedValue: agreement.value,
    },
    ambiguous: false,
  }
}

async function previewFutureUpdate(
  db: DbAdapter,
  input: unknown,
): Promise<FutureUpdatePreview | null> {
  const workoutId = text(object(input, 'future update preview')['workoutId'], 'Workout identity')
  const intent = await db.queryOne<{
    availability: string
    prescription_json: string | null
    provenance_json: string
    adjustments_json: string | null
  }>(
    'SELECT availability,prescription_json,provenance_json,adjustments_json FROM workout_intents WHERE workout_id=?',
    [workoutId],
  )
  if (intent?.availability !== 'captured' || !intent.prescription_json) return null
  const adjustments = intent.adjustments_json
    ? object(
        json(intent.adjustments_json, 'Captured workout adjustments'),
        'Captured workout adjustments',
      )
    : null
  const intensityModifier =
    adjustments &&
    typeof adjustments['intensityModifier'] === 'number' &&
    Number.isFinite(adjustments['intensityModifier'])
      ? adjustments['intensityModifier']
      : null
  const provenance = object(
    json(intent.provenance_json, 'Captured provenance'),
    'Captured provenance',
  )
  if (
    provenance['sourceKind'] !== 'routine' ||
    typeof provenance['sourceId'] !== 'string' ||
    typeof provenance['routineRevisionId'] !== 'string'
  )
    return null
  const routineId = provenance['sourceId']
  const { revision: current } = await routineWithRevision(db, routineId)
  const capturedRevisionRow = await db.queryOne<{
    id: string
    revision_num: number
    prescription_json: string
    inputs_json: string
    provenance_json: string
    structure_hash: string
    created_at: string
  }>('SELECT * FROM routine_revisions WHERE id=? AND routine_id=?', [
    provenance['routineRevisionId'],
    routineId,
  ])
  if (!capturedRevisionRow) return null
  const capturedPrescription = parseSerializablePrescription(
    json(intent.prescription_json, 'Captured prescription'),
  )
  const capturedInputs = parseRoutineInputs(
    json(capturedRevisionRow.inputs_json, 'Captured routine inputs'),
    capturedPrescription,
  )
  const capturedTargets = targetsById(capturedPrescription)
  const currentTargets = targetsById(current.prescription)
  const actualRows = await db.queryAll<{
    intent_set_id: string
    weight_kg: number | null
    reps: number | null
    rpe: number | null
    rir: number | null
    distance_m: number | null
    duration_sec: number | null
    completed: number
  }>(
    'SELECT i.intent_set_id,i.set_id,i.target_snapshot_json,s.weight_kg,s.reps,s.rpe,s.rir,s.distance_m,s.duration_sec,s.completed FROM sets s JOIN workout_intent_sets i ON i.set_id=s.id JOIN workout_exercises we ON we.id=s.workout_exercise_id WHERE we.workout_id=? AND we.removed_at IS NULL AND s.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workout_set_skips WHERE set_id=s.id)',
    [workoutId],
  )
  const actualByTarget = actualValuesByTarget(actualRows, capturedPrescription)
  const candidates: FutureUpdateCandidate[] = []
  const ambiguities: string[] = []
  for (const [id, oldTarget] of capturedTargets) {
    const result = fixedFutureUpdateCandidate(
      id,
      oldTarget,
      currentTargets.get(id),
      actualByTarget.get(id),
      intensityModifier,
    )
    if (result.ambiguous) {
      ambiguities.push(
        `${oldTarget.field} target has conflicting completed values across repeated sets; review the workout before adopting a value.`,
      )
    } else if (result.candidate) candidates.push(result.candidate)
  }
  for (const definition of capturedPrescription.inputs) {
    const capturedValue = capturedInputs[definition.id]
    const currentValue = current.inputs[definition.id]
    if (capturedValue === undefined || currentValue === undefined) continue
    candidates.push({
      id: definition.id,
      kind: 'input',
      label: definition.name,
      identity: definition.id,
      capturedValue,
      actualValue: null,
      currentValue,
      proposedValue: currentValue,
    })
  }
  const referencingPlans = await getRoutineReferencePlans(db, routineId)
  const preview: FutureUpdatePreview = {
    previewId: crypto.randomUUID(),
    workoutId,
    routineId,
    currentRoutineRevisionId: current.id,
    candidates,
    ambiguities,
    referencingPlans,
    prescription: current.prescription,
    inputs: current.inputs,
  }
  await db.exec(
    'INSERT INTO routine_update_previews (id,workout_id,routine_id,snapshot_json,created_at) VALUES (?,?,?,?,?)',
    [preview.previewId, workoutId, routineId, JSON.stringify(preview), new Date().toISOString()],
  )
  return preview
}

async function applyFutureUpdate(db: DbAdapter, input: unknown): Promise<RoutineRevision> {
  const payload = object(input, 'future update apply')
  const previewId = text(payload['previewId'], 'Future update preview')
  const stored = await db.queryOne<{
    workout_id: string
    routine_id: string
    snapshot_json: string
  }>('SELECT workout_id,routine_id,snapshot_json FROM routine_update_previews WHERE id=?', [
    previewId,
  ])
  if (!stored) throw new Error('Future update preview is missing or expired')
  const preview = object(
    json(stored.snapshot_json, 'Future update preview'),
    'Future update preview',
  )
  const requestValues = object(payload['selectedValues'], 'Selected future update values')
  if (stored.workout_id !== preview['workoutId'] || stored.routine_id !== preview['routineId'])
    throw new Error('Future update preview is invalid')
  const { routine, revision: current } = await routineWithRevision(db, stored.routine_id)
  if (current.id !== preview['currentRoutineRevisionId'])
    throw new Error('Routine changed after future update preview')
  if (!Array.isArray(preview['candidates']))
    throw new Error('Future update candidates are malformed')
  const prescription = structuredClone(current.prescription)
  const inputs = { ...current.inputs }
  const fixedTargets: Record<string, unknown> = {}
  const targets = targetsById(prescription)
  for (const candidateValue of preview['candidates']) {
    const candidate = object(candidateValue, 'Future update candidate')
    const id = text(candidate['id'], 'Future update identity')
    if (!Object.hasOwn(requestValues, id)) continue
    const value = requestValues[id]
    if (typeof value !== 'number' && typeof value !== 'boolean')
      throw new Error(`Future update ${id} must be numeric or boolean`)
    if (candidate['kind'] === 'input') inputs[id] = value
    else {
      const target = targets.get(id)?.target
      if (target?.rule.kind !== 'fixed' || typeof value !== 'number')
        throw new Error(`Future update ${id} is no longer a directly authored fixed target`)
      fixedTargets[id] = value
    }
  }
  const validInputs = validateRoutineInputs(prescription, inputs)
  applyFixedTargetValues(prescription, fixedTargets)
  validatePrescriptionExpressions(prescription)
  const resolvedPrescription = resolvePrescription(prescription, validInputs)
  const now = nowOf(payload)
  const id = crypto.randomUUID()
  const next: RoutineRevision = {
    id,
    routineId: routine.id,
    revisionNumber: current.revisionNumber + 1,
    prescription: resolvedPrescription,
    inputs: validInputs,
    provenance: current.provenance,
    structureHash: current.structureHash,
    createdAt: now,
  }
  await db.exec(
    'INSERT INTO routine_revisions (id,routine_id,revision_num,prescription_json,inputs_json,provenance_json,structure_hash,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [
      id,
      routine.id,
      next.revisionNumber,
      JSON.stringify(resolvedPrescription),
      JSON.stringify(validInputs),
      JSON.stringify(next.provenance),
      next.structureHash,
      now,
    ],
  )
  await db.exec('UPDATE saved_routines SET current_revision_id=?,updated_at=? WHERE id=?', [
    id,
    now,
    routine.id,
  ])
  await db.exec('DELETE FROM routine_update_previews WHERE id=?', [previewId])
  return next
}

function readProgramPhase(value: unknown, label: string): ProgramPhase | null {
  if (
    value === null ||
    value === 'accumulation' ||
    value === 'intensification' ||
    value === 'deload' ||
    value === 'peak'
  )
    return value
  throw new Error(`${label} is invalid`)
}

function parseProgramDesign(value: unknown): ProgramDesign {
  const design = object(value, 'Program design')
  if (!Array.isArray(design['weekProgression']) || !Array.isArray(design['slots']))
    throw new Error('Program design arrays are malformed')
  function progression(value: unknown, label: string): ProgramSlot['progression'] {
    const item = object(value, label)
    const phase = readProgramPhase(item['phase'], `${label}.phase`)
    const legacyCurrentWeek = item['legacyCurrentWeek']
    if (
      legacyCurrentWeek !== null &&
      (typeof legacyCurrentWeek !== 'number' || !Number.isInteger(legacyCurrentWeek))
    )
      throw new Error(`${label}.legacyCurrentWeek is invalid`)
    if (
      typeof item['intensityModifier'] !== 'number' ||
      typeof item['volumeModifier'] !== 'number' ||
      typeof item['isDeload'] !== 'boolean'
    )
      throw new Error(`${label} is malformed`)
    return {
      intensityModifier: item['intensityModifier'],
      volumeModifier: item['volumeModifier'],
      isDeload: item['isDeload'],
      phase,
      legacyCurrentWeek,
    }
  }
  const parsed: ProgramDesign = {
    schemaVersion: 1,
    weeks: typeof design['weeks'] === 'number' ? design['weeks'] : 0,
    weekProgression: design['weekProgression'].map((value, index) => {
      const item = object(value, `weekProgression[${index}]`)
      return {
        week: typeof item['week'] === 'number' ? item['week'] : 0,
        progression: progression(item['progression'], `weekProgression[${index}].progression`),
      }
    }),
    slots: design['slots'].map((value, index) => {
      const item = object(value, `slots[${index}]`)
      if (
        typeof item['assignmentResolved'] !== 'boolean' ||
        typeof item['week'] !== 'number' ||
        typeof item['day'] !== 'number'
      )
        throw new Error(`slots[${index}] is malformed`)
      return {
        id: text(item['id'], `slots[${index}].id`),
        templateId:
          item['templateId'] === null
            ? null
            : text(item['templateId'], `slots[${index}].templateId`),
        templateRevisionId:
          item['templateRevisionId'] === null
            ? null
            : text(item['templateRevisionId'], `slots[${index}].templateRevisionId`),
        assignmentResolved: item['assignmentResolved'],
        week: item['week'],
        day: item['day'],
        label: item['label'] === null ? null : text(item['label'], `slots[${index}].label`),
        progression: progression(item['progression'], `slots[${index}].progression`),
      }
    }),
  }
  return validateProgramDesign(parsed)
}
function validateProgramDesign(design: ProgramDesign): ProgramDesign {
  if (design.schemaVersion !== 1 || !Number.isInteger(design.weeks) || design.weeks < 1)
    throw new Error('Program design requires a positive week count')
  const progressionWeeks = new Set<number>()
  for (const week of design.weekProgression) {
    if (
      !Number.isInteger(week.week) ||
      week.week < 1 ||
      week.week > design.weeks ||
      progressionWeeks.has(week.week)
    )
      throw new Error('Program week progression rows must have unique valid week numbers')
    progressionWeeks.add(week.week)
    if (
      !Number.isFinite(week.progression.intensityModifier) ||
      week.progression.intensityModifier < 0 ||
      !Number.isFinite(week.progression.volumeModifier) ||
      week.progression.volumeModifier < 0
    )
      throw new Error('Program progression modifiers must be finite and nonnegative')
  }
  const slotIds = new Set<string>()
  for (const slot of design.slots) {
    if (
      !slot.id ||
      slotIds.has(slot.id) ||
      !Number.isInteger(slot.week) ||
      slot.week < 1 ||
      slot.week > design.weeks ||
      !Number.isInteger(slot.day) ||
      slot.day < 1 ||
      slot.day > 7
    )
      throw new Error('Program slots require unique identity and valid week/day')
    slotIds.add(slot.id)
    if (slot.templateId === null && slot.assignmentResolved)
      throw new Error('A missing template assignment cannot be marked resolved')
    if (
      !Number.isFinite(slot.progression.intensityModifier) ||
      slot.progression.intensityModifier < 0 ||
      !Number.isFinite(slot.progression.volumeModifier) ||
      slot.progression.volumeModifier < 0
    )
      throw new Error('Program progression modifiers must be finite and nonnegative')
  }
  return design
}

async function insertProgramRevision(
  db: DbAdapter,
  programId: string,
  design: ProgramDesign,
  createdAt: string,
): Promise<ProgramRevision> {
  validateProgramDesign(design)
  const row = await db.queryOne<{ revision_num: number }>(
    'SELECT COALESCE(MAX(revision_num),0) AS revision_num FROM program_revisions WHERE program_id=?',
    [programId],
  )
  const revisionNumber = (row?.revision_num ?? 0) + 1
  const id = crypto.randomUUID()
  const structureHash = structuralFingerprint({
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
  await db.exec(
    'INSERT INTO program_revisions (id,program_id,revision_num,design_json,structure_hash,created_at) VALUES (?,?,?,?,?,?)',
    [id, programId, revisionNumber, JSON.stringify(design), structureHash, createdAt],
  )
  return { id, programId, revisionNumber, design, structureHash, createdAt }
}

async function createProgram(db: DbAdapter, input: unknown): Promise<ProgramRevision> {
  const payload = object(input, 'Program create') as unknown as ProgramCreateRequest
  const id = payload.id ?? crypto.randomUUID()
  const now = payload.now ?? new Date().toISOString()
  validateProgramDesign(payload.design)
  await db.exec(
    'INSERT INTO programs (id,name,description,weeks,is_builtin,created_at) VALUES (?,?,?,?,?,?)',
    [
      id,
      payload.name.trim(),
      payload.description,
      payload.design.weeks,
      payload.isBuiltin ? 1 : 0,
      now,
    ],
  )
  for (const week of payload.design.weekProgression) {
    await db.exec(
      'INSERT INTO program_weeks (id,program_id,week_num,is_deload,intensity_modifier,volume_modifier,phase) VALUES (?,?,?,?,?,?,?)',
      [
        crypto.randomUUID(),
        id,
        week.week,
        week.progression.isDeload ? 1 : 0,
        week.progression.intensityModifier,
        week.progression.volumeModifier,
        week.progression.phase,
      ],
    )
  }
  return insertProgramRevision(db, id, payload.design, now)
}

async function loadProgramRevision(
  db: DbAdapter,
  programId: string,
  revisionId?: string,
): Promise<ProgramRevision> {
  const row = revisionId
    ? await db.queryOne<{
        id: string
        revision_num: number
        design_json: string
        structure_hash: string
        created_at: string
      }>('SELECT * FROM program_revisions WHERE program_id=? AND id=?', [programId, revisionId])
    : await db.queryOne<{
        id: string
        revision_num: number
        design_json: string
        structure_hash: string
        created_at: string
      }>('SELECT * FROM program_revisions WHERE program_id=? ORDER BY revision_num DESC LIMIT 1', [
        programId,
      ])
  if (!row) throw new Error(`Program revision for ${programId} not found`)
  return {
    id: row.id,
    programId,
    revisionNumber: row.revision_num,
    design: parseProgramDesign(json(row.design_json, 'Program design')),
    structureHash: row.structure_hash,
    createdAt: row.created_at,
  }
}

async function editProgram(db: DbAdapter, input: unknown): Promise<ProgramRevision> {
  const payload = object(input, 'Program edit') as unknown as ProgramEditRequest
  const current = await loadProgramRevision(db, payload.programId)
  if (current.id !== payload.expectedRevisionId)
    throw new Error('Program changed since this edit began')
  validateProgramDesign(payload.design)
  const now = payload.now ?? new Date().toISOString()
  await db.exec('UPDATE programs SET name=?,description=?,weeks=? WHERE id=?', [
    payload.name.trim(),
    payload.description,
    payload.design.weeks,
    payload.programId,
  ])
  return insertProgramRevision(db, payload.programId, payload.design, now)
}
async function addProgramWeek(db: DbAdapter, input: unknown): Promise<ProgramRevision> {
  const payload = object(input, 'Program week') as unknown as ProgramAddWeekRequest
  if (!Number.isInteger(payload.weekNum) || payload.weekNum < 1)
    throw new Error('Program week must be positive')
  const program = await db.queryOne<{ id: string; weeks: number }>(
    'SELECT id,weeks FROM programs WHERE id=?',
    [payload.programId],
  )
  if (!program) throw new Error('Program not found')
  const current = await loadProgramRevision(db, payload.programId)
  const prior = current.design.weekProgression.find((week) => week.week === payload.weekNum)
  const progression = {
    intensityModifier: payload.intensityModifier ?? prior?.progression.intensityModifier ?? 1,
    volumeModifier: payload.volumeModifier ?? prior?.progression.volumeModifier ?? 1,
    isDeload: payload.isDeload ?? prior?.progression.isDeload ?? false,
    phase: payload.phase === undefined ? (prior?.progression.phase ?? null) : payload.phase,
    legacyCurrentWeek: prior?.progression.legacyCurrentWeek ?? null,
  }
  const existingWeek = await db.queryOne<{ id: string }>(
    'SELECT id FROM program_weeks WHERE program_id=? AND week_num=? ORDER BY id LIMIT 1',
    [payload.programId, payload.weekNum],
  )
  if (existingWeek) {
    await db.exec(
      'UPDATE program_weeks SET is_deload=?,intensity_modifier=?,volume_modifier=?,phase=? WHERE id=?',
      [
        progression.isDeload ? 1 : 0,
        progression.intensityModifier,
        progression.volumeModifier,
        progression.phase,
        existingWeek.id,
      ],
    )
  } else {
    await db.exec(
      'INSERT INTO program_weeks (id,program_id,week_num,is_deload,intensity_modifier,volume_modifier,phase) VALUES (?,?,?,?,?,?,?)',
      [
        crypto.randomUUID(),
        payload.programId,
        payload.weekNum,
        progression.isDeload ? 1 : 0,
        progression.intensityModifier,
        progression.volumeModifier,
        progression.phase,
      ],
    )
  }
  const design: ProgramDesign = {
    ...current.design,
    weeks: Math.max(current.design.weeks, payload.weekNum),
    weekProgression: [
      ...current.design.weekProgression.filter((week) => week.week !== payload.weekNum),
      { week: payload.weekNum, progression },
    ],
    slots: current.design.slots.map((slot) =>
      slot.week === payload.weekNum ? { ...slot, progression } : slot,
    ),
  }
  await db.exec('UPDATE programs SET weeks=? WHERE id=?', [design.weeks, payload.programId])
  return insertProgramRevision(db, payload.programId, design, new Date().toISOString())
}

async function addProgramSlot(db: DbAdapter, input: unknown): Promise<ProgramSlot> {
  const payload = object(input, 'Program slot') as unknown as ProgramAddSlotRequest
  if (!Number.isInteger(payload.dayNum) || payload.dayNum < 1 || payload.dayNum > 7)
    throw new Error('Program day must be Monday=1 through Sunday=7')
  const week = await db.queryOne<{
    id: string
    program_id: string
    week_num: number
    is_deload: number
    intensity_modifier: number
    volume_modifier: number
    phase: string | null
  }>('SELECT pw.* FROM program_weeks pw WHERE pw.id=?', [payload.weekId])
  if (!week) throw new Error('Program week not found')
  const current = await loadProgramRevision(db, week.program_id)
  const progression = current.design.weekProgression.find((entry) => entry.week === week.week_num)
    ?.progression ?? {
    intensityModifier: week.intensity_modifier ?? 1,
    volumeModifier: week.volume_modifier ?? 1,
    isDeload: week.is_deload === 1,
    phase: week.phase as ProgramSlot['progression']['phase'],
    legacyCurrentWeek: null,
  }
  const templateRevision = payload.templateId
    ? await ensureTemplateRevision(db, payload.templateId)
    : null
  const slot: ProgramSlot = {
    id: crypto.randomUUID(),
    templateId: payload.templateId,
    templateRevisionId: templateRevision?.id ?? null,
    assignmentResolved: payload.templateId !== null,
    week: week.week_num,
    day: payload.dayNum,
    label: payload.label ?? null,
    progression,
  }
  await insertProgramRevision(
    db,
    week.program_id,
    { ...current.design, slots: [...current.design.slots, slot] },
    new Date().toISOString(),
  )
  await db.exec(
    'INSERT INTO program_days (id,week_id,day_num,template_id,label) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), week.id, payload.dayNum, payload.templateId, payload.label ?? null],
  )
  return slot
}

async function validateTrainingPlanBindings(
  db: DbAdapter,
  payload: TrainingPlanSaveRequest,
): Promise<void> {
  if (!payload.adoptedProgramRevisionId) {
    if (payload.bindings.length > 0)
      throw new Error('Program slot bindings require an adopted Program revision')
    return
  }
  const revision = await loadProgramRevision(
    db,
    text(payload.programId, 'Program identity'),
    payload.adoptedProgramRevisionId,
  )
  const seen = new Set<string>()
  for (const binding of payload.bindings) {
    if (seen.has(binding.programSlotId))
      throw new Error('Training Plan has duplicate Program slot bindings')
    seen.add(binding.programSlotId)
    if (payload.id && binding.planId !== payload.id)
      throw new Error('Training Plan binding belongs to another plan')
    const slot = revision.design.slots.find((item) => item.id === binding.programSlotId)
    if (!slot)
      throw new Error('Plan binding references a slot outside its adopted Program revision')
    if (slot.templateId !== binding.templateId)
      throw new Error('Plan binding template does not match its Program slot')
    if (slot.templateId === null && (binding.routineId !== null || binding.status === 'bound'))
      throw new Error('Unassigned Program slots cannot bind a routine')
    await validateTrainingPlanRoutine(db, slot, binding)
  }
}

async function validateTrainingPlanRoutine(
  db: DbAdapter,
  slot: ProgramSlot,
  binding: TrainingPlanBinding,
): Promise<void> {
  if (!binding.routineId) {
    if (binding.status === 'bound') throw new Error('A bound Program slot requires a saved routine')
    return
  }
  const { routine, revision } = await routineWithRevision(db, binding.routineId)
  if (
    slot.templateId === null ||
    routine.templateId !== slot.templateId ||
    !slot.templateRevisionId
  )
    throw new Error('Bound routine uses a different template than its Program slot')
  const adopted = await loadTemplateRevision(db, slot.templateId, slot.templateRevisionId)
  if (adopted.structureHash !== revision.structureHash)
    throw new Error('Bound routine is incompatible with its Program slot')
  if (binding.status !== 'bound')
    throw new Error('A compatible routine binding must be marked bound')
}

function parseTrainingPlanBinding(value: unknown, index: number): TrainingPlanBinding {
  const binding = object(value, `Training Plan bindings[${index}]`)
  const status = binding['status']
  if (status !== 'bound' && status !== 'unresolved')
    throw new Error(`Training Plan bindings[${index}].status is invalid`)
  const routineId = binding['routineId']
  if (routineId !== null && typeof routineId !== 'string')
    throw new Error(`Training Plan bindings[${index}].routineId is invalid`)
  return {
    id: text(binding['id'], `Training Plan bindings[${index}].id`),
    planId: text(binding['planId'], `Training Plan bindings[${index}].planId`),
    programSlotId: text(binding['programSlotId'], `Training Plan bindings[${index}].programSlotId`),
    templateId:
      binding['templateId'] === null
        ? null
        : text(binding['templateId'], `Training Plan bindings[${index}].templateId`),
    routineId,
    status,
    issue:
      binding['issue'] === null
        ? null
        : text(binding['issue'], `Training Plan bindings[${index}].issue`),
  }
}

async function saveTrainingPlan(db: DbAdapter, input: unknown): Promise<TrainingPlan> {
  const request = object(input, 'Training Plan save')
  const bindingsValue = request['bindings']
  if (!Array.isArray(bindingsValue)) throw new Error('Training Plan bindings must be an array')
  const bindings = bindingsValue.map(parseTrainingPlanBinding)
  const programId =
    request['programId'] === null ? null : text(request['programId'], 'Program identity')
  const adoptedProgramRevisionId =
    request['adoptedProgramRevisionId'] === null
      ? null
      : text(request['adoptedProgramRevisionId'], 'Program revision')
  const active = request['active']
  if (typeof active !== 'boolean') throw new Error('Training Plan active must be boolean')
  const payload: TrainingPlanSaveRequest = {
    ...(request['id'] === undefined ? {} : { id: text(request['id'], 'Training Plan identity') }),
    name: text(request['name'], 'Training Plan name'),
    programId,
    adoptedProgramRevisionId,
    startLocalDate: text(request['startLocalDate'], 'Plan start date'),
    active,
    bindings,
    ...(typeof request['now'] === 'string' ? { now: request['now'] } : {}),
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.startLocalDate))
    throw new Error('Plan start date must be a local YYYY-MM-DD date')
  if (
    payload.programId === null &&
    (payload.adoptedProgramRevisionId !== null || payload.bindings.length > 0)
  )
    throw new Error('A standalone plan cannot adopt Program revisions or bindings')
  await validateTrainingPlanBindings(db, payload)
  const id = payload.id ?? crypto.randomUUID()
  const now = payload.now ?? new Date().toISOString()
  const current = await db.queryOne<{ id: string }>('SELECT id FROM training_plans WHERE id=?', [
    id,
  ])
  if (current) {
    await db.exec(
      'UPDATE training_plans SET name=?,program_id=?,adopted_program_revision_id=?,start_local_date=?,active=?,updated_at=? WHERE id=?',
      [
        payload.name.trim(),
        payload.programId,
        payload.adoptedProgramRevisionId,
        payload.startLocalDate,
        payload.active ? 1 : 0,
        now,
        id,
      ],
    )
  } else {
    await db.exec(
      'INSERT INTO training_plans (id,name,program_id,adopted_program_revision_id,start_local_date,active,legacy_state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,NULL,?,?)',
      [
        id,
        payload.name.trim(),
        payload.programId,
        payload.adoptedProgramRevisionId,
        payload.startLocalDate,
        payload.active ? 1 : 0,
        now,
        now,
      ],
    )
  }
  await replacePlanBindings(db, id, payload.bindings)
  return {
    id,
    name: payload.name.trim(),
    programId: payload.programId,
    adoptedProgramRevisionId: payload.adoptedProgramRevisionId,
    startLocalDate: payload.startLocalDate,
    active: payload.active,
    createdAt: now,
    updatedAt: now,
    legacyProgramState: null,
  }
}

async function replacePlanBindings(
  db: DbAdapter,
  planId: string,
  bindings: TrainingPlanBinding[],
): Promise<void> {
  await db.exec('DELETE FROM training_plan_bindings WHERE plan_id=?', [planId])
  for (const binding of bindings) {
    if (binding.templateId === null) continue
    await db.exec(
      'INSERT INTO training_plan_bindings (id,plan_id,program_slot_id,template_id,routine_id,status,issue) VALUES (?,?,?,?,?,?,?)',
      [
        binding.id || crypto.randomUUID(),
        planId,
        binding.programSlotId,
        binding.templateId,
        binding.routineId,
        binding.status,
        binding.issue,
      ],
    )
  }
}

async function migrateLegacyTemplateRevisions(db: DbAdapter): Promise<void> {
  const templates = await db.queryAll<{ id: string }>(
    'SELECT t.id FROM templates t WHERE NOT EXISTS (SELECT 1 FROM template_revisions r WHERE r.template_id=t.id)',
  )
  for (const template of templates) {
    await insertTemplateRevision(
      db,
      template.id,
      await legacyTemplatePrescription(db, template.id),
      new Date().toISOString(),
    )
  }
}

interface LegacyProgramWeek {
  id: string
  week_num: number
  is_deload: number
  intensity_modifier: number
  volume_modifier: number
  phase: string | null
}

function legacyProgramProgression(
  week: LegacyProgramWeek,
  currentWeek: number,
): ProgramSlot['progression'] {
  return {
    intensityModifier: week.intensity_modifier ?? 1,
    volumeModifier: week.volume_modifier ?? 1,
    isDeload: week.is_deload === 1,
    phase: readProgramPhase(week.phase, 'Legacy Program phase'),
    legacyCurrentWeek: currentWeek ?? null,
  }
}

async function createLegacyProgramSlots(
  db: DbAdapter,
  weeks: LegacyProgramWeek[],
  currentWeek: number,
): Promise<ProgramSlot[]> {
  const slots: ProgramSlot[] = []
  for (const week of weeks) {
    const days = await db.queryAll<{
      id: string
      day_num: number
      template_id: string | null
      label: string | null
    }>('SELECT * FROM program_days WHERE week_id=? ORDER BY day_num,id', [week.id])
    for (const day of days) {
      const referencedTemplate = day.template_id
        ? await db.queryOne<{ id: string }>('SELECT id FROM templates WHERE id=?', [
            day.template_id,
          ])
        : null
      const templateRevision = referencedTemplate
        ? await ensureTemplateRevision(db, referencedTemplate.id)
        : null
      slots.push({
        id: crypto.randomUUID(),
        templateId: day.template_id,
        templateRevisionId: templateRevision?.id ?? null,
        assignmentResolved: templateRevision !== null,
        week: week.week_num,
        day: day.day_num,
        label: day.label,
        progression: legacyProgramProgression(week, currentWeek),
      })
    }
  }
  return slots
}

async function migrateLegacyPrograms(db: DbAdapter): Promise<void> {
  const programs = await db.queryAll<{
    id: string
    name: string
    weeks: number
    current_week: number
    started_at: string | null
    completed_at: string | null
    active: number
    created_at: string
  }>('SELECT p.* FROM programs p')
  for (const program of programs) {
    const existingRow = await db.queryOne<{ id: string }>(
      'SELECT id FROM program_revisions WHERE program_id=? ORDER BY revision_num DESC LIMIT 1',
      [program.id],
    )
    const existingRevision = existingRow
      ? await loadProgramRevision(db, program.id, existingRow.id)
      : null
    const weeks = await db.queryAll<LegacyProgramWeek>(
      'SELECT * FROM program_weeks WHERE program_id=? ORDER BY week_num',
      [program.id],
    )
    const slots = existingRevision
      ? existingRevision.design.slots
      : await createLegacyProgramSlots(db, weeks, program.current_week)
    const weekProgression = weeks.map((week) => ({
      week: week.week_num,
      progression: legacyProgramProgression(week, program.current_week),
    }))
    const revision =
      existingRevision ??
      (await insertProgramRevision(
        db,
        program.id,
        { schemaVersion: 1, weeks: Math.max(program.weeks, 1), weekProgression, slots },
        program.created_at,
      ))
    const planId = `legacy-plan-${program.id}`
    const exists = await db.queryOne<{ id: string }>('SELECT id FROM training_plans WHERE id=?', [
      planId,
    ])
    if (!exists) {
      const startDate = (program.started_at ?? program.created_at).slice(0, 10)
      await db.exec(
        'INSERT INTO training_plans (id,name,program_id,adopted_program_revision_id,start_local_date,active,legacy_state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?, ?,?)',
        [
          planId,
          program.name,
          program.id,
          revision.id,
          startDate,
          program.active ? 1 : 0,
          JSON.stringify({
            currentWeek: program.current_week,
            startedAt: program.started_at,
            completedAt: program.completed_at,
          }),
          program.created_at,
          program.created_at,
        ],
      )
    }
    for (const slot of revision.design.slots) {
      if (!slot.templateId) continue
      await db.exec(
        'INSERT INTO training_plan_bindings (id,plan_id,program_slot_id,template_id,routine_id,status,issue) VALUES (?,?,?,?,NULL,?,?) ON CONFLICT(plan_id,program_slot_id) DO NOTHING',
        [
          crypto.randomUUID(),
          planId,
          slot.id,
          slot.templateId,
          'unresolved',
          slot.assignmentResolved
            ? 'Legacy program assignment has no saved routine binding'
            : 'Legacy template reference could not be resolved',
        ],
      )
    }
  }
}

export async function migratePrescriptionDomain(db: DbAdapter): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS routine_update_previews (
    id TEXT PRIMARY KEY,
    workout_id TEXT NOT NULL,
    routine_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)
  await migrateLegacyTemplateRevisions(db)
  await migrateLegacyPrograms(db)
  const workouts = await db.queryAll<{
    id: string
    template_id: string | null
    ended_at: string | null
  }>(
    'SELECT w.id,w.template_id,w.ended_at FROM workouts w WHERE NOT EXISTS (SELECT 1 FROM workout_intents i WHERE i.workout_id=w.id)',
  )
  for (const workout of workouts) {
    const now = new Date().toISOString()
    const template = workout.template_id
      ? await db.queryOne<{ id: string }>('SELECT id FROM templates WHERE id=?', [
          workout.template_id,
        ])
      : null
    if (template) {
      const revision = await ensureTemplateRevision(db, template.id)
      await db.exec(
        "INSERT INTO workout_intents (workout_id,availability,prescription_json,provenance_json,captured_at) VALUES (?,'unavailable',NULL,?,?)",
        [
          workout.id,
          JSON.stringify({
            sourceKind: 'template',
            sourceId: template.id,
            sourceRevisionId: revision.id,
            routineRevisionId: null,
          }),
          now,
        ],
      )
    } else {
      await db.exec(
        "INSERT INTO workout_intents (workout_id,availability,prescription_json,provenance_json,captured_at) VALUES (?,'unavailable',NULL,?,?)",
        [
          workout.id,
          JSON.stringify({
            sourceKind: null,
            sourceId: null,
            sourceRevisionId: null,
            routineRevisionId: null,
          }),
          now,
        ],
      )
    }
    void workout.ended_at
  }
}

export function dispatchPrescriptionOperation<K extends DomainOperation>(
  db: DbAdapter,
  type: K,
  input: DomainOperationMap[K]['payload'],
): Promise<DomainOperationMap[K]['result']>
export function dispatchPrescriptionOperation(
  db: DbAdapter,
  type: DomainOperation,
  input: unknown,
): Promise<unknown>
export async function dispatchPrescriptionOperation(
  db: DbAdapter,
  type: DomainOperation,
  input: unknown,
): Promise<unknown> {
  if (!isDomainOperation(type)) throw new Error(`Unknown domain operation: ${type}`)
  return OPERATIONS[type](db, input)
}

export function isDomainOperation(value: string): value is DomainOperation {
  return Object.hasOwn(OPERATIONS, value)
}

async function programCalendarReview(
  db: DbAdapter,
  planId: string,
  design: ProgramDesign,
  bindings: TrainingPlanBinding[],
  today: string,
): Promise<ProgramAdoptionPreview['calendar']> {
  const plan = await db.queryOne<{ start_local_date: string; active: number }>(
    'SELECT start_local_date,active FROM training_plans WHERE id=?',
    [planId],
  )
  if (!plan) throw new Error('Training Plan not found')
  const appointments = await db.queryAll<{
    id: string
    occurrence_key: string
    source_id: string
    routine_id: string
    planned_date: string
    planned_time: string | null
    status: string
    workout_id: string | null
  }>(
    "SELECT id,occurrence_key,source_id,routine_id,planned_date,planned_time,status,workout_id FROM organization_appointments WHERE plan_id=? AND source_kind='program' ORDER BY id",
    [planId],
  )
  const calendar: ProgramAdoptionPreview['calendar'] = {
    today,
    startDate: plan.start_local_date,
    stateFingerprint: JSON.stringify({ plan, appointments }),
    slots: design.slots.map((slot) => ({
      slotId: slot.id,
      label: slot.label ?? `Week ${slot.week} · day ${slot.day}`,
      plannedDate: addCalendarDays(plan.start_local_date, (slot.week - 1) * 7 + slot.day - 1),
      routineId: bindings.find((binding) => binding.programSlotId === slot.id)?.routineId ?? null,
    })),
    changes: [],
  }
  if (!plan.active) return calendar
  const desired = new Map(
    calendar.slots
      .filter((slot) => slot.routineId && slot.plannedDate >= today)
      .map((slot) => [slot.slotId, slot]),
  )
  for (const appointment of appointments) {
    if (
      appointment.status !== 'open' ||
      appointment.workout_id ||
      appointment.planned_date <= today
    )
      continue
    const target = desired.get(appointment.source_id)
    if (
      !target ||
      target.routineId !== appointment.routine_id ||
      target.plannedDate !== appointment.planned_date
    ) {
      calendar.changes.push({
        appointmentId: appointment.id,
        slotId: appointment.source_id,
        previousDate: appointment.planned_date,
        previousRoutineId: appointment.routine_id,
        plannedDate: target?.plannedDate ?? null,
        routineId: target?.routineId ?? null,
      })
    }
  }
  const horizon = addCalendarDays(today, 27)
  for (const slot of desired.values()) {
    if (
      slot.plannedDate > horizon ||
      appointments.some(
        (appointment) => appointment.occurrence_key === `program:${planId}:${slot.slotId}`,
      )
    )
      continue
    calendar.changes.push({
      appointmentId: null,
      slotId: slot.slotId,
      previousDate: null,
      previousRoutineId: null,
      plannedDate: slot.plannedDate,
      routineId: slot.routineId,
    })
  }
  return calendar
}

async function applyProgramCalendar(
  db: DbAdapter,
  planId: string,
  calendar: ProgramAdoptionPreview['calendar'],
  now: string,
): Promise<void> {
  for (const change of calendar.changes) {
    if (change.appointmentId) {
      if (change.plannedDate && change.routineId) {
        await db.exec(
          "UPDATE organization_appointments SET routine_id=?,planned_date=?,postponed=0 WHERE id=? AND status='open' AND workout_id IS NULL AND planned_date>?",
          [change.routineId, change.plannedDate, change.appointmentId, calendar.today],
        )
      } else {
        await db.exec(
          "DELETE FROM organization_appointments WHERE id=? AND status='open' AND workout_id IS NULL AND planned_date>?",
          [change.appointmentId, calendar.today],
        )
      }
    } else if (change.plannedDate && change.routineId) {
      await db.exec(
        "INSERT INTO organization_appointments(id,plan_id,routine_id,original_date,planned_date,status,created_at,occurrence_key,source_kind,source_id) VALUES(?,?,?,?,?,'open',?,?,'program',?)",
        [
          crypto.randomUUID(),
          planId,
          change.routineId,
          change.plannedDate,
          change.plannedDate,
          now,
          `program:${planId}:${change.slotId}`,
          change.slotId,
        ],
      )
    }
  }
}

async function previewProgramAdoption(
  db: DbAdapter,
  input: unknown,
): Promise<ProgramAdoptionPreview> {
  const request = object(input, 'Program adoption preview')
  const payload = {
    planId: text(request['planId'], 'Training Plan identity'),
    programRevisionId: text(request['programRevisionId'], 'Program revision'),
  }
  const plan = await db.queryOne<{
    id: string
    program_id: string | null
    adopted_program_revision_id: string | null
  }>('SELECT * FROM training_plans WHERE id=?', [payload.planId])
  if (!plan) throw new Error('Training Plan not found')
  const revision = await loadProgramRevision(
    db,
    text(plan.program_id, 'Plan Program identity'),
    payload.programRevisionId,
  )
  const choices =
    request['routineBindings'] === undefined
      ? {}
      : object(request['routineBindings'], 'Selected Program routines')
  const slotIds = new Set(revision.design.slots.map((slot) => slot.id))
  for (const [slotId, routineId] of Object.entries(choices)) {
    if (!slotIds.has(slotId)) throw new Error('Selected routine references an unknown Program slot')
    if (routineId !== null) text(routineId, 'Selected saved routine')
  }
  const bindings: TrainingPlanBinding[] = []
  const issues: string[] = []
  for (const slot of revision.design.slots) {
    const choice = choices[slot.id]
    const binding = await previewProgramBinding(
      db,
      payload.planId,
      slot,
      choice === undefined ? undefined : choice === null ? null : text(choice, 'Saved routine'),
    )
    if (binding.status === 'unresolved')
      issues.push(`Slot ${slot.id} needs a compatible routine binding`)
    bindings.push(binding)
  }
  const preview: ProgramAdoptionPreview = {
    previewId: crypto.randomUUID(),
    planId: payload.planId,
    currentProgramRevisionId: plan.adopted_program_revision_id,
    targetProgramRevisionId: revision.id,
    compatible: true,
    issues,
    bindings,
    calendar: await programCalendarReview(
      db,
      payload.planId,
      revision.design,
      bindings,
      localDateKey(),
    ),
  }
  const currentBindingsFingerprint = await programBindingFingerprint(db, payload.planId)
  const selectedRoutineRevisions: Record<string, string> = {}
  for (const binding of bindings) {
    if (binding.routineId) {
      const { revision: routineRevision } = await routineWithRevision(db, binding.routineId)
      selectedRoutineRevisions[binding.routineId] = routineRevision.id
    }
  }
  await db.exec(
    'INSERT INTO prescription_previews (id,kind,owner_id,snapshot_json,created_at) VALUES (?,?,?,?,?)',
    [
      preview.previewId,
      'program_adoption',
      payload.planId,
      JSON.stringify({ ...preview, currentBindingsFingerprint, selectedRoutineRevisions }),
      new Date().toISOString(),
    ],
  )
  return preview
}

async function applyProgramAdoption(db: DbAdapter, input: unknown): Promise<TrainingPlan> {
  const payload = object(input, 'Program adoption apply')
  const previewId = text(payload['previewId'], 'Program adoption preview')
  const stored = await db.queryOne<{ owner_id: string; snapshot_json: string }>(
    'SELECT owner_id,snapshot_json FROM prescription_previews WHERE id=? AND kind=?',
    [previewId, 'program_adoption'],
  )
  if (!stored) throw new Error('Program adoption preview is missing or expired')
  const previewRow = object(
    json(stored.snapshot_json, 'Program adoption preview'),
    'Program adoption preview',
  )
  const planId = text(previewRow['planId'], 'Training Plan identity')
  if (planId !== stored.owner_id || previewRow['previewId'] !== previewId)
    throw new Error('Program adoption preview is invalid')
  const plan = await db.queryOne<{
    id: string
    program_id: string | null
    adopted_program_revision_id: string | null
    name: string
    start_local_date: string
    active: number
    created_at: string
    legacy_state_json: string | null
  }>('SELECT * FROM training_plans WHERE id=?', [planId])
  if (!plan) throw new Error('Training Plan not found')
  if (plan.adopted_program_revision_id !== previewRow['currentProgramRevisionId'])
    throw new Error('Training Plan changed after adoption preview')
  const revision = await loadProgramRevision(
    db,
    text(plan.program_id, 'Plan Program identity'),
    text(previewRow['targetProgramRevisionId'], 'Program revision'),
  )
  const latestRevision = await loadProgramRevision(
    db,
    text(plan.program_id, 'Plan Program identity'),
  )
  if (latestRevision.id !== revision.id) throw new Error('Program changed after adoption preview')
  if ((await programBindingFingerprint(db, planId)) !== previewRow['currentBindingsFingerprint'])
    throw new Error('Program slot bindings changed after adoption preview')
  const routineRevisions = object(previewRow['selectedRoutineRevisions'], 'Reviewed routines')
  for (const [routineId, revisionId] of Object.entries(routineRevisions)) {
    const { revision: currentRoutine } = await routineWithRevision(db, routineId)
    if (currentRoutine.id !== revisionId)
      throw new Error('A selected routine changed after adoption preview; refresh the review')
  }
  const now = nowOf(payload)
  const validatedBindings: TrainingPlanBinding[] = []
  const designSlots = new Map(revision.design.slots.map((slot) => [slot.id, slot]))
  const bindingsValue = previewRow['bindings']
  if (!Array.isArray(bindingsValue))
    throw new Error('Program adoption preview bindings are malformed')
  for (const value of bindingsValue) {
    validatedBindings.push(await validateProgramAdoptionBinding(db, planId, designSlots, value))
  }
  const calendar = await programCalendarReview(
    db,
    plan.id,
    revision.design,
    validatedBindings,
    localDateKey(),
  )
  if (JSON.stringify(calendar) !== JSON.stringify(previewRow['calendar']))
    throw new Error('Program calendar changed after adoption preview; refresh the review')
  await db.exec('UPDATE training_plans SET adopted_program_revision_id=?,updated_at=? WHERE id=?', [
    revision.id,
    now,
    plan.id,
  ])
  await replacePlanBindings(db, plan.id, validatedBindings)
  await applyProgramCalendar(db, plan.id, calendar, now)
  await db.exec('DELETE FROM prescription_previews WHERE id=?', [previewId])
  return {
    id: plan.id,
    name: plan.name,
    programId: plan.program_id,
    adoptedProgramRevisionId: revision.id,
    startLocalDate: plan.start_local_date,
    active: plan.active === 1,
    createdAt: plan.created_at,
    updatedAt: now,
    legacyProgramState: parseLegacyProgramState(plan.legacy_state_json),
  }
}

async function bindProgramRoutine(db: DbAdapter, input: unknown): Promise<TrainingPlanBinding> {
  const payload = object(input, 'Training Plan binding')
  const planId = text(payload['planId'], 'Training Plan identity')
  const programSlotId = text(payload['programSlotId'], 'Program slot')
  const routineId = text(payload['routineId'], 'Routine identity')
  const plan = await db.queryOne<{
    program_id: string | null
    adopted_program_revision_id: string | null
  }>('SELECT program_id,adopted_program_revision_id FROM training_plans WHERE id=?', [planId])
  if (!plan?.program_id || !plan.adopted_program_revision_id)
    throw new Error('Training Plan has no adopted Program revision')
  const programRevision = await loadProgramRevision(
    db,
    plan.program_id,
    plan.adopted_program_revision_id,
  )
  const slot = programRevision.design.slots.find((entry) => entry.id === programSlotId)
  const { routine, revision: routineRevision } = await routineWithRevision(db, routineId)
  if (!slot?.templateId || !slot.templateRevisionId || routine.templateId !== slot.templateId)
    throw new Error('Routine is not compatible with this Program slot')
  const slotRevision = await loadTemplateRevision(db, slot.templateId, slot.templateRevisionId)
  if (slotRevision.structureHash !== routineRevision.structureHash)
    throw new Error('Routine structure is incompatible with this Program slot')
  const id = crypto.randomUUID()
  await db.exec(
    "INSERT INTO training_plan_bindings (id,plan_id,program_slot_id,template_id,routine_id,status,issue) VALUES (?,?,?,?,?,'bound',NULL) ON CONFLICT(plan_id,program_slot_id) DO UPDATE SET template_id=excluded.template_id,routine_id=excluded.routine_id,status='bound',issue=NULL",
    [id, planId, programSlotId, slot.templateId, routineId],
  )
  return {
    id,
    planId,
    programSlotId,
    templateId: slot.templateId,
    routineId,
    status: 'bound',
    issue: null,
  }
}

async function listRoutines(db: DbAdapter): Promise<SavedRoutine[]> {
  const rows = await db.queryAll<{
    id: string
    name: string
    template_id: string
    adopted_template_revision_id: string
    current_revision_id: string
    continuation_policy: 'calendar_bound' | 'carry_forward'
    deferral_mode: 'automatic' | 'manual' | null
    created_at: string
    updated_at: string
  }>('SELECT * FROM saved_routines ORDER BY name,id')
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    templateId: row.template_id,
    adoptedTemplateRevisionId: row.adopted_template_revision_id,
    currentRevisionId: row.current_revision_id,
    continuationPolicy: row.continuation_policy,
    deferralMode: row.deferral_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : text(value, label)
}

async function getTemplateRevision(db: DbAdapter, input: unknown): Promise<TemplateRevision> {
  const payload = object(input, 'Template revision request')
  return loadTemplateRevision(
    db,
    text(payload['templateId'], 'Template identity'),
    optionalText(payload['revisionId'], 'Template revision'),
  )
}

async function getProgramRevision(db: DbAdapter, input: unknown): Promise<ProgramRevision> {
  const payload = object(input, 'Program revision request')
  return loadProgramRevision(
    db,
    text(payload['programId'], 'Program identity'),
    optionalText(payload['revisionId'], 'Program revision'),
  )
}

async function getRoutine(
  db: DbAdapter,
  input: unknown,
): Promise<{ routine: SavedRoutine; revision: RoutineRevision }> {
  const payload = object(input, 'Routine request')
  return routineWithRevision(db, text(payload['routineId'], 'Routine identity'))
}

const TEMPLATE_METADATA_FIELDS = new Set([
  'name',
  'description',
  'sort_order',
  'cover_emoji',
  'pinned_at',
  'archived_at',
  'last_used_at',
  'use_count',
])

async function updateTemplateMetadata(db: DbAdapter, input: unknown): Promise<undefined> {
  const payload = object(input, 'Template metadata update')
  const templateId = text(payload['templateId'], 'Template identity')
  const changes = object(payload['changes'], 'Template metadata changes')
  for (const [key, value] of Object.entries(changes))
    if (TEMPLATE_METADATA_FIELDS.has(key))
      await db.exec(`UPDATE templates SET ${key}=? WHERE id=?`, [value, templateId])
  return undefined
}

function parseLegacyProgramState(value: string | null): TrainingPlan['legacyProgramState'] {
  if (value === null) return null
  const state = object(json(value, 'Legacy program state'), 'Legacy program state')
  const currentWeek = state['currentWeek']
  const startedAt = state['startedAt']
  const completedAt = state['completedAt']
  if (
    typeof currentWeek !== 'number' ||
    !Number.isInteger(currentWeek) ||
    (startedAt !== null && typeof startedAt !== 'string') ||
    (completedAt !== null && typeof completedAt !== 'string')
  )
    throw new Error('Legacy program state is malformed')
  return { currentWeek, startedAt, completedAt }
}

async function programBindingFingerprint(db: DbAdapter, planId: string): Promise<string> {
  return JSON.stringify(
    await db.queryAll(
      'SELECT id,program_slot_id,template_id,routine_id,status,issue FROM training_plan_bindings WHERE plan_id=? ORDER BY program_slot_id',
      [planId],
    ),
  )
}

async function previewProgramBinding(
  db: DbAdapter,
  planId: string,
  slot: ProgramSlot,
  selectedRoutineId?: string | null,
): Promise<TrainingPlanBinding> {
  const existing = await db.queryOne<{
    id: string
    routine_id: string | null
    status: string
    issue: string | null
  }>('SELECT * FROM training_plan_bindings WHERE plan_id=? AND program_slot_id=?', [
    planId,
    slot.id,
  ])
  const routineId =
    selectedRoutineId === undefined ? (existing?.routine_id ?? null) : selectedRoutineId
  let status: 'bound' | 'unresolved' = 'unresolved'
  let issue: string | null = 'Choose a compatible saved routine'
  if (routineId) {
    const routine = await db.queryOne<{
      template_id: string
      adopted_template_revision_id: string
    }>('SELECT * FROM saved_routines WHERE id=?', [routineId])
    if (routine && slot.templateId && slot.templateRevisionId) {
      const templateRevision = await loadTemplateRevision(
        db,
        routine.template_id,
        routine.adopted_template_revision_id,
      )
      const slotRevision = await loadTemplateRevision(db, slot.templateId, slot.templateRevisionId)
      if (
        routine.template_id === slot.templateId &&
        slotRevision.structureHash === templateRevision.structureHash
      ) {
        status = 'bound'
        issue = null
      }
    }
    if (status === 'unresolved')
      issue = 'Existing routine binding is incompatible with the adopted Program slot'
  }
  return {
    id: existing?.id ?? crypto.randomUUID(),
    planId,
    programSlotId: slot.id,
    templateId: slot.templateId,
    routineId,
    status,
    issue,
  }
}

async function validateProgramAdoptionBinding(
  db: DbAdapter,
  planId: string,
  designSlots: Map<string, ProgramSlot>,
  value: unknown,
): Promise<TrainingPlanBinding> {
  const binding = object(value, 'Program adoption binding')
  const slot = designSlots.get(text(binding['programSlotId'], 'Program slot'))
  if (!slot || slot.templateId !== binding['templateId'])
    throw new Error('Program adoption binding does not match its revision')
  const routineId =
    binding['routineId'] === null ? null : text(binding['routineId'], 'Routine identity')
  let status: 'bound' | 'unresolved' = 'unresolved'
  let issue: string | null = routineId
    ? 'Routine is incompatible with Program slot'
    : 'Choose a compatible saved routine'
  if (routineId && slot.templateId && slot.templateRevisionId) {
    const { routine, revision: routineRevision } = await routineWithRevision(db, routineId)
    const slotRevision = await loadTemplateRevision(db, slot.templateId, slot.templateRevisionId)
    if (
      routine.templateId === slot.templateId &&
      routineRevision.structureHash === slotRevision.structureHash
    ) {
      status = 'bound'
      issue = null
    }
  }
  return {
    id: text(binding['id'], 'Binding identity'),
    planId,
    programSlotId: slot.id,
    templateId: slot.templateId,
    routineId,
    status,
    issue,
  }
}
