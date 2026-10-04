import { localCalendarDate, parseDateString } from '@habitathq/utils'
import type { DbAdapter } from '@palladium/core'
import type {
  PersonalRecordRow,
  RunRow,
  SessionType,
  SetRow,
  TemplateGroupRow,
  WorkoutExerciseRow,
  WorkoutRow,
} from '~/types/database'
import type {
  NumericTarget,
  PrescriptionActivity,
  PrescriptionSet,
  RoutineInputValue,
  SerializablePrescription,
  SetRole,
} from '~/types/prescription'
import { isoWeek } from './format'
import { discardOrganization, finishOrganization, startOrganization } from './organization-storage'
import { detectPRs } from './pr'
import { parseSerializablePrescription } from './prescription-domain'
import { resolvePrescription } from './prescription-evaluator'
import { getRoutineSnapshot } from './prescription-storage'
import { calculateWorkoutVolume } from './workout-helpers'

export interface WorkoutSummary {
  totalSets: number
  totalVolume: number
  newPRs: PersonalRecordRow[]
  durationSec: number
  distanceM: number
  sessionType: SessionType
}

type StartOptions = {
  scale?: number
  excludedExerciseIds?: string[]
  sessionType?: SessionType
  intensityModifier?: number
  volumeModifier?: number
  inputs?: Record<string, RoutineInputValue>
  fixedTargetValues?: Record<string, number>
  expectedTemplateRevisionId?: string
  expectedRoutineRevisionId?: string
  appointmentId?: string
  rotationId?: string
  rotationGeneration?: number
}
type Payload = Record<string, unknown>
export interface WorkoutSetIntent {
  intentSetId: string
  role: SetRole
  weightKg: number | null
  exactReps: number | null
  minimumReps: number | null
  maximumReps: number | null
  restSec: number | null
  rpe: number | null
  rir: number | null
}
export interface WorkoutActivityIntent {
  intentActivityId: string
  loggingMode: PrescriptionActivity['loggingMode']
  durationSec: number | null
  distanceM: number | null
}
export interface WorkoutSession {
  workout: WorkoutRow
  exercises: WorkoutExerciseRow[]
  sets: SetRow[]
  run: RunRow | null
  groups: TemplateGroupRow[]
  options: { intensity_modifier: number; volume_modifier: number } | null
  prescription: SerializablePrescription | null
  setIntents: Record<string, WorkoutSetIntent>
  activityIntents: Record<string, WorkoutActivityIntent>
  skippedSetIds: string[]
  routine: { id: string; name: string; revisionNumber: number } | null
}
export interface WorkoutOperationMap {
  WORKOUT_START: {
    payload: {
      id: string
      now: string
      templateId?: string | null
      routineId?: string | null
      options?: StartOptions
    }
    result: WorkoutSession
  }
  WORKOUT_ACTIVE: { payload: Record<string, never>; result: WorkoutSession | null }
  WORKOUT_LOG_SET: { payload: { set: SetRow }; result: SetRow }
  WORKOUT_UPDATE_SET: { payload: { set: SetRow }; result: SetRow }
  WORKOUT_SAVE_DRAFT: { payload: { set: SetRow }; result: SetRow }
  WORKOUT_UNDO_SET: { payload: { setId: string }; result: SetRow }
  WORKOUT_SKIP_SET: { payload: { set: SetRow; skipped: boolean }; result: SetRow }
  WORKOUT_ADD_EXERCISE: {
    payload: { exercise: Omit<WorkoutExerciseRow, 'logging_mode'>; pendingSets?: SetRow[] }
    result: WorkoutExerciseRow
  }
  WORKOUT_RUN_DATA: { payload: { run: RunRow }; result: RunRow }
  WORKOUT_DISCARD: { payload: { workoutId: string }; result: boolean }
  WORKOUT_FINISH: {
    payload: {
      workoutId: string
      endedAt: string
      options: { moodRating?: number; energyRating?: number; notes?: string }
    }
    result: WorkoutSummary
  }
}
export type WorkoutOperation = keyof WorkoutOperationMap
const SET_COLUMNS =
  'id,workout_exercise_id,set_num,is_warmup,weight_kg,reps,rpe,rir,notes,completed,logged_at,distance_m,duration_sec,speed_kmh,level,technique_flag,body_feel,failure_flag,failure_type,partial_reps'

function record(value: unknown): Payload {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid workout request')
  return value as Payload
}

function isGroupType(value: unknown): value is TemplateGroupRow['group_type'] {
  return (
    value === 'superset' || value === 'giant_set' || value === 'circuit' || value === 'pre_exhaust'
  )
}

function isCircuitRestMode(value: unknown): value is TemplateGroupRow['circuit_rest_mode'] {
  return value === 'after_round' || value === 'after_each'
}
function capturedTemplateGroups(json: string, templateId: string): TemplateGroupRow[] {
  const decoded: unknown = JSON.parse(json)
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    !('groups' in decoded) ||
    !Array.isArray(decoded.groups)
  )
    throw new Error('Captured workout prescription has invalid group data')
  const result: TemplateGroupRow[] = []
  for (const [index, group] of decoded.groups.entries()) {
    if (!group || typeof group !== 'object') throw new Error('Captured execution group is invalid')
    if (
      !('id' in group) ||
      typeof group.id !== 'string' ||
      !('label' in group) ||
      typeof group.label !== 'string' ||
      !('type' in group) ||
      !isGroupType(group.type) ||
      !('transitionRestSec' in group) ||
      typeof group.transitionRestSec !== 'number' ||
      !('restAfterRoundSec' in group) ||
      typeof group.restAfterRoundSec !== 'number' ||
      !('circuitRestMode' in group) ||
      !isCircuitRestMode(group.circuitRestMode) ||
      !('rounds' in group) ||
      typeof group.rounds !== 'number' ||
      !('amrap' in group) ||
      typeof group.amrap !== 'boolean'
    )
      throw new Error('Captured execution group is invalid')
    const name = 'name' in group && typeof group.name === 'string' ? group.name : null
    const timeCap =
      'timeCapSec' in group && typeof group.timeCapSec === 'number' ? group.timeCapSec : null
    result.push({
      id: group.id,
      template_id: templateId,
      label: group.label,
      name,
      group_type: group.type,
      transition_rest_sec: group.transitionRestSec,
      rest_after_round_sec: group.restAfterRoundSec,
      circuit_rest_mode: group.circuitRestMode,
      sort_order: index,
      display_name: name,
      rounds: group.rounds,
      amrap: group.amrap ? 1 : 0,
      time_cap_sec: timeCap,
    })
  }
  return result
}
function setIntent(target: PrescriptionSet): WorkoutSetIntent {
  return {
    intentSetId: target.id,
    role: target.role,
    weightKg:
      target.weightKg?.resolvedValue ??
      (target.weightKg?.rule.kind === 'fixed' ? target.weightKg.rule.value : null),
    exactReps:
      target.reps?.kind === 'exact'
        ? (target.reps.value.resolvedValue ??
          (target.reps.value.rule.kind === 'fixed' ? target.reps.value.rule.value : null))
        : null,
    minimumReps:
      target.reps?.kind === 'range' || target.reps?.kind === 'minimum' ? target.reps.minimum : null,
    maximumReps: target.reps?.kind === 'range' ? target.reps.maximum : null,
    restSec:
      target.restSec?.resolvedValue ??
      (target.restSec?.rule.kind === 'fixed' ? target.restSec.rule.value : null),
    rpe:
      target.rpe?.resolvedValue ??
      (target.rpe?.rule.kind === 'fixed' ? target.rpe.rule.value : null),
    rir:
      target.rir?.resolvedValue ??
      (target.rir?.rule.kind === 'fixed' ? target.rir.rule.value : null),
  }
}
async function loadSession(db: DbAdapter, workout: WorkoutRow) {
  const exercises = await db.queryAll<WorkoutExerciseRow>(
    'SELECT * FROM workout_exercises WHERE workout_id = ? AND removed_at IS NULL ORDER BY order_num',
    [workout.id],
  )
  const sets: SetRow[] = []
  for (const exercise of exercises) {
    sets.push(
      ...(await db.queryAll<SetRow>(
        `SELECT ${SET_COLUMNS} FROM sets WHERE workout_exercise_id = ? AND removed_at IS NULL ORDER BY set_num`,
        [exercise.id],
      )),
    )
  }
  const run = await db.queryOne<RunRow>('SELECT * FROM runs WHERE workout_id = ?', [workout.id])
  const intent = await db.queryOne<{ availability: string; prescription_json: string | null }>(
    'SELECT availability,prescription_json FROM workout_intents WHERE workout_id=?',
    [workout.id],
  )
  const prescription =
    intent?.availability === 'captured' && intent.prescription_json
      ? parseSerializablePrescription(JSON.parse(intent.prescription_json))
      : null
  const intentLinks = await db.queryAll<{ set_id: string; intent_set_id: string }>(
    `SELECT i.set_id,i.intent_set_id FROM workout_intent_sets i
     JOIN sets s ON s.id=i.set_id JOIN workout_exercises e ON e.id=s.workout_exercise_id
     WHERE e.workout_id=? AND e.removed_at IS NULL AND s.removed_at IS NULL`,
    [workout.id],
  )
  const targets = new Map(
    prescription?.activities.flatMap((activity) =>
      activity.sets.map((set) => [set.id, set] as const),
    ) ?? [],
  )
  const setIntents: Record<string, WorkoutSetIntent> = {}
  for (const link of intentLinks) {
    const target = targets.get(link.intent_set_id)
    if (target) setIntents[link.set_id] = setIntent(target)
  }
  const activityLinks = await db.queryAll<{
    workout_exercise_id: string
    intent_activity_id: string
  }>(
    `SELECT i.workout_exercise_id,i.intent_activity_id FROM workout_intent_activities i
     JOIN workout_exercises e ON e.id=i.workout_exercise_id WHERE e.workout_id=? AND e.removed_at IS NULL`,
    [workout.id],
  )
  const activities = new Map(
    prescription?.activities.map((activity) => [activity.id, activity] as const) ?? [],
  )
  const activityIntents: Record<string, WorkoutActivityIntent> = {}
  for (const link of activityLinks) {
    const activity = activities.get(link.intent_activity_id)
    if (activity)
      activityIntents[link.workout_exercise_id] = {
        intentActivityId: activity.id,
        loggingMode: activity.loggingMode,
        durationSec: resolvedTargetValue(activity.targets.durationSec),
        distanceM: resolvedTargetValue(activity.targets.distanceM),
      }
  }
  const skipped = await db.queryAll<{ set_id: string }>(
    `SELECT k.set_id FROM workout_set_skips k JOIN sets s ON s.id=k.set_id
     JOIN workout_exercises e ON e.id=s.workout_exercise_id WHERE e.workout_id=? AND e.removed_at IS NULL AND s.removed_at IS NULL ORDER BY e.order_num,s.set_num`,
    [workout.id],
  )
  const routine = await db.queryOne<{ id: string; name: string; revisionNumber: number }>(
    `SELECT r.id,r.name,rr.revision_num AS revisionNumber FROM workout_intents i
     JOIN routine_revisions rr ON rr.id=json_extract(i.provenance_json,'$.routineRevisionId')
     JOIN saved_routines r ON r.id=rr.routine_id WHERE i.workout_id=?`,
    [workout.id],
  )
  const groups =
    intent?.availability === 'captured' && intent.prescription_json
      ? capturedTemplateGroups(intent.prescription_json, workout.template_id ?? '')
      : workout.template_id
        ? await db.queryAll<TemplateGroupRow>(
            'SELECT * FROM template_groups WHERE template_id = ?',
            [workout.template_id],
          )
        : []
  const options = await db.queryOne<{ intensity_modifier: number; volume_modifier: number }>(
    'SELECT intensity_modifier,volume_modifier FROM workout_session_options WHERE workout_id=?',
    [workout.id],
  )
  return {
    workout,
    exercises,
    sets,
    run,
    groups,
    options,
    prescription,
    setIntents,
    activityIntents,
    skippedSetIds: skipped.map((row) => row.set_id),
    routine,
  }
}

async function requireActiveWorkout(db: DbAdapter, workoutId: string): Promise<void> {
  const workout = await db.queryOne<{ id: string }>(
    'SELECT id FROM workouts WHERE id=? AND ended_at IS NULL',
    [workoutId],
  )
  if (!workout) throw new Error('Session is not writable')
}
function readSessionType(value: unknown): SessionType {
  if (
    value === 'gym' ||
    value === 'run' ||
    value === 'conditioning' ||
    value === 'mobility' ||
    value === 'other'
  )
    return value
  throw new Error('Invalid session type')
}

function readExclusions(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Exercise exclusions must be an array')
  return value.map((entry: unknown) => {
    if (typeof entry !== 'string') throw new Error('Invalid excluded exercise identity')
    return entry
  })
}

function readStartInputs(value: unknown): Record<string, RoutineInputValue> {
  const inputs: Record<string, RoutineInputValue> = {}
  for (const [key, entry] of Object.entries(record(value))) {
    if (typeof entry !== 'boolean' && (typeof entry !== 'number' || !Number.isFinite(entry)))
      throw new Error('Prescription inputs must be finite numbers or booleans')
    inputs[key] = entry
  }
  return inputs
}

function readFixedTargetValues(value: unknown): Record<string, number> {
  const targets: Record<string, number> = {}
  for (const [key, entry] of Object.entries(record(value))) {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0)
      throw new Error('Fixed target overrides must be finite and nonnegative')
    targets[key] = entry
  }
  return targets
}

function readStartOptions(source: Payload): StartOptions {
  const options: StartOptions = {}
  for (const key of ['scale', 'intensityModifier', 'volumeModifier'] as const) {
    const value = source[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new Error(`${key} must be finite and nonnegative`)
    options[key] = value
  }
  if (source['sessionType'] !== undefined)
    options.sessionType = readSessionType(source['sessionType'])
  if (source['excludedExerciseIds'] !== undefined)
    options.excludedExerciseIds = readExclusions(source['excludedExerciseIds'])
  if (source['inputs'] !== undefined) options.inputs = readStartInputs(source['inputs'])
  if (source['fixedTargetValues'] !== undefined)
    options.fixedTargetValues = readFixedTargetValues(source['fixedTargetValues'])
  for (const key of [
    'expectedTemplateRevisionId',
    'expectedRoutineRevisionId',
    'appointmentId',
    'rotationId',
  ] as const) {
    const value = source[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !value) throw new Error('Invalid reviewed revision identity')
    options[key] = value
  }
  const generation = source['rotationGeneration']
  if (generation !== undefined) {
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0)
      throw new Error('Invalid reviewed rotation generation')
    options.rotationGeneration = generation
  }
  return options
}

function readStartRequest(payload: Payload) {
  const now = typeof payload['now'] === 'string' ? payload['now'] : new Date().toISOString()
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid workout start time')
  const id = typeof payload['id'] === 'string' ? payload['id'] : crypto.randomUUID()
  const templateId = typeof payload['templateId'] === 'string' ? payload['templateId'] : null
  const routineId = typeof payload['routineId'] === 'string' ? payload['routineId'] : null
  const options = readStartOptions(record(payload['options'] ?? {}))
  return { now, id, templateId, routineId, options, sessionType: options.sessionType ?? 'gym' }
}

function resolvedTargetValue(target: NumericTarget | null): number | null {
  return target?.resolvedValue ?? (target?.rule.kind === 'fixed' ? target.rule.value : null)
}

function capturedInputs(
  prescription: SerializablePrescription,
  inputs: Record<string, RoutineInputValue>,
) {
  const captured: Record<string, RoutineInputValue> = {}
  for (const definition of prescription.inputs) {
    const value = inputs[definition.id] ?? definition.defaultValue
    if (value !== null) captured[definition.id] = value
  }
  return captured
}

function sessionAdjustments(options: StartOptions) {
  return {
    scale: options.scale ?? 1,
    intensityModifier: options.intensityModifier ?? 1,
    volumeModifier: options.volumeModifier ?? 1,
    excludedExerciseIds: options.excludedExerciseIds ?? [],
  }
}

function withSessionIntensity(prescription: SerializablePrescription, options: StartOptions) {
  const captured = parseSerializablePrescription(prescription)
  for (const activity of captured.activities) {
    for (const set of activity.sets) {
      if (!set.weightKg) continue
      const weight = resolvedTargetValue(set.weightKg)
      if (weight === null) continue
      const adjusted = weight * (options.intensityModifier ?? 1)
      if (!Number.isFinite(adjusted)) throw new Error('Adjusted load must be finite')
      set.weightKg.resolvedValue = adjusted
    }
  }
  return captured
}

async function createPrescribedExercises(
  db: DbAdapter,
  workoutId: string,
  prescription: SerializablePrescription,
  options: StartOptions,
) {
  const excluded = new Set(options.excludedExerciseIds ?? [])
  for (const activity of prescription.activities) {
    if (excluded.has(activity.exerciseId)) continue
    const exerciseId = crypto.randomUUID()
    const group = activity.executionGroupId
      ? prescription.groups.find((entry) => entry.id === activity.executionGroupId)
      : null
    const restSeconds =
      resolvedTargetValue(activity.sets[0]?.restSec ?? null) ?? prescription.defaults.restSec
    await db.exec(
      'INSERT INTO workout_exercises (id,workout_id,exercise_id,logging_mode,order_num,superset_group,rest_seconds) VALUES (?,?,?,?,?,?,?)',
      [
        exerciseId,
        workoutId,
        activity.exerciseId,
        activity.loggingMode,
        activity.order,
        group?.label ?? null,
        restSeconds,
      ],
    )
    await db.exec(
      'INSERT INTO workout_intent_activities (workout_exercise_id,intent_activity_id,intent_order,execution_group_id) VALUES (?,?,?,?)',
      [exerciseId, activity.id, activity.order, activity.executionGroupId],
    )
    await createPrescribedSets(db, exerciseId, activity, options)
  }
}

function prescribedSetLayout(activity: PrescriptionActivity, options: StartOptions) {
  const workingCount = activity.sets.reduce(
    (total, set) => total + (set.role === 'warm_up' ? 0 : 1),
    0,
  )
  const count = Math.max(
    0,
    Math.round(workingCount * (options.scale ?? 1) * (options.volumeModifier ?? 1)),
  )
  if (!Number.isSafeInteger(count) || count > 1000)
    throw new Error('An activity cannot prescribe more than 1000 sets')
  let retainedWorking = 0
  const retained = activity.sets.filter(
    (set) => set.role === 'warm_up' || retainedWorking++ < count,
  )
  const extra = Math.max(0, count - workingCount)
  const total = retained.length + extra
  if (total > 1000) throw new Error('An activity cannot prescribe more than 1000 sets')
  const lastWorking = activity.sets.findLast((set) => set.role !== 'warm_up')
  const lastOrder = activity.sets.at(-1)?.order ?? 0
  return { retained, total, lastWorking, lastOrder }
}

async function createPrescribedSets(
  db: DbAdapter,
  exerciseId: string,
  activity: PrescriptionActivity,
  options: StartOptions,
) {
  if (activity.loggingMode !== 'strength' && activity.sets.length === 0) {
    await db.exec(
      `INSERT INTO sets (${SET_COLUMNS}) VALUES (?, ?, 1, 0, NULL, NULL, NULL, NULL, ?, 0, NULL, ?, ?, NULL, NULL, NULL, NULL, 0, NULL, NULL)`,
      [
        crypto.randomUUID(),
        exerciseId,
        activity.notes,
        resolvedTargetValue(activity.targets.distanceM),
        resolvedTargetValue(activity.targets.durationSec),
      ],
    )
  }
  const { retained, total, lastWorking, lastOrder } = prescribedSetLayout(activity, options)
  for (let index = 0; index < total; index++) {
    const original = retained[index]
    const targetSet = original ?? lastWorking
    if (!targetSet) throw new Error('Missing prescribed set')
    const setId = crypto.randomUUID()
    const weight = resolvedTargetValue(targetSet.weightKg)
    const reps = targetSet.reps?.kind === 'exact' ? resolvedTargetValue(targetSet.reps.value) : null
    await db.exec(
      `INSERT INTO sets (${SET_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL)`,
      [
        setId,
        exerciseId,
        original?.order ?? lastOrder + index - retained.length + 1,
        targetSet.role === 'warm_up' ? 1 : 0,
        weight,
        reps,
        resolvedTargetValue(targetSet.rpe),
        resolvedTargetValue(targetSet.rir),
        targetSet.notes,
      ],
    )
    await db.exec(
      'INSERT INTO workout_intent_sets (set_id,intent_set_id,target_snapshot_json) VALUES (?,?,?)',
      [setId, targetSet.id, JSON.stringify(targetSet)],
    )
  }
}

async function captureTemplateIntent(
  db: DbAdapter,
  workoutId: string,
  templateId: string,
  now: string,
  options: StartOptions,
): Promise<SerializablePrescription> {
  const row = await db.queryOne<{ id: string; prescription_json: string }>(
    'SELECT id,prescription_json FROM template_revisions WHERE template_id=? ORDER BY revision_num DESC LIMIT 1',
    [templateId],
  )
  if (options.expectedTemplateRevisionId && row?.id !== options.expectedTemplateRevisionId)
    throw new Error('Template changed after preview; refresh before starting')
  if (!row)
    throw new Error(
      'Template revision is unavailable; migrate or restore the template before starting',
    )
  const prescription = withSessionIntensity(
    resolvePrescription(
      parseSerializablePrescription(JSON.parse(row.prescription_json)),
      options.inputs ?? {},
      options.fixedTargetValues ?? {},
    ),
    options,
  )
  await db.exec(
    'INSERT INTO workout_intents (workout_id,availability,prescription_json,provenance_json,inputs_json,adjustments_json,captured_at) VALUES (?,?,?,?,?,?,?)',
    [
      workoutId,
      'captured',
      JSON.stringify(prescription),
      JSON.stringify({
        sourceKind: 'template',
        sourceId: templateId,
        sourceRevisionId: row.id,
        routineRevisionId: null,
      }),
      JSON.stringify(capturedInputs(prescription, options.inputs ?? {})),
      JSON.stringify(sessionAdjustments(options)),
      now,
    ],
  )
  return prescription
}

async function start(db: DbAdapter, payload: Payload) {
  const {
    now,
    id,
    templateId: requestedTemplateId,
    routineId,
    options,
    sessionType,
  } = readStartRequest(payload)
  const routineSnapshot = routineId ? await getRoutineSnapshot(db, routineId) : null
  if (
    options.expectedRoutineRevisionId &&
    routineSnapshot?.revision.id !== options.expectedRoutineRevisionId
  )
    throw new Error('Routine changed after preview; refresh before starting')
  if (
    routineSnapshot &&
    requestedTemplateId &&
    requestedTemplateId !== routineSnapshot.routine.templateId
  )
    throw new Error('Routine template identity does not match the requested template')
  const templateId = routineSnapshot?.routine.templateId ?? requestedTemplateId
  const unfinished = await db.queryOne<WorkoutRow>(
    'SELECT * FROM workouts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  )
  if (unfinished)
    throw new Error('An unfinished session already exists; resume or discard it first.')
  await db.exec(
    'INSERT INTO workouts (id,date,started_at,session_type,template_id,created_at) VALUES (?,?,?,?,?,?)',
    [id, localCalendarDate(new Date(now)), now, sessionType, templateId, now],
  )
  await db.exec(
    'INSERT INTO workout_session_options (workout_id,intensity_modifier,volume_modifier) VALUES (?,?,?)',
    [id, options.intensityModifier ?? 1, options.volumeModifier ?? 1],
  )
  if (routineSnapshot) {
    const { routine, revision } = routineSnapshot
    const prescription = withSessionIntensity(revision.prescription, options)
    await db.exec(
      'INSERT INTO workout_intents (workout_id,availability,prescription_json,provenance_json,inputs_json,adjustments_json,captured_at) VALUES (?,?,?,?,?,?,?)',
      [
        id,
        'captured',
        JSON.stringify(prescription),
        JSON.stringify({
          sourceKind: 'routine',
          sourceId: routine.id,
          sourceRevisionId: routine.adoptedTemplateRevisionId,
          routineRevisionId: revision.id,
        }),
        JSON.stringify(capturedInputs(prescription, revision.inputs)),
        JSON.stringify(sessionAdjustments(options)),
        now,
      ],
    )
    await createPrescribedExercises(db, id, prescription, options)
  } else if (templateId) {
    const prescription = await captureTemplateIntent(db, id, templateId, now, options)
    await createPrescribedExercises(db, id, prescription, options)
  } else {
    await db.exec(
      'INSERT INTO workout_intents (workout_id,availability,prescription_json,provenance_json,adjustments_json,captured_at) VALUES (?,?,?,?,?,?)',
      [
        id,
        'absent',
        null,
        JSON.stringify({
          sourceKind: 'one_off',
          sourceId: null,
          sourceRevisionId: null,
          routineRevisionId: null,
        }),
        JSON.stringify(sessionAdjustments(options)),
        now,
      ],
    )
  }
  await startOrganization(db, id, { ...options, ...(routineId ? { routineId } : {}) })
  const workout = await db.queryOne<WorkoutRow>('SELECT * FROM workouts WHERE id = ?', [id])
  if (!workout) throw new Error('Could not load started workout')
  return loadSession(db, workout)
}

async function loadCompletedSets(
  db: DbAdapter,
  exercises: WorkoutExerciseRow[],
): Promise<SetRow[]> {
  const completed: SetRow[] = []
  for (const exercise of exercises) {
    completed.push(
      ...(await db.queryAll<SetRow>(
        `SELECT ${SET_COLUMNS} FROM sets WHERE workout_exercise_id = ? AND completed = 1 AND removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workout_set_skips WHERE set_id=sets.id)`,
        [exercise.id],
      )),
    )
  }
  return completed
}

async function activityLoggingMode(db: DbAdapter, workoutExerciseId: string) {
  const row = await db.queryOne<{ logging_mode: string }>(
    'SELECT logging_mode FROM workout_exercises WHERE id=?',
    [workoutExerciseId],
  )
  return row?.logging_mode
}

async function recordStrengthPRs(
  db: DbAdapter,
  workout: WorkoutRow,
  exercises: WorkoutExerciseRow[],
  completedSets: SetRow[],
  previousRecords: readonly PersonalRecordRow[] = [],
): Promise<{ newPRs: PersonalRecordRow[]; strengthSets: SetRow[] }> {
  const newPRs: PersonalRecordRow[] = []
  const strengthSets: SetRow[] = []
  for (const exercise of exercises) {
    const exerciseSets = completedSets.filter(
      (set) =>
        set.workout_exercise_id === exercise.id &&
        set.reps !== null &&
        (set.reps > 0 || set.failure_flag === 1),
    )
    if (!exerciseSets.length) continue
    if ((await activityLoggingMode(db, exercise.id)) !== 'strength') continue
    strengthSets.push(...exerciseSets)
    const existing = await db.queryAll<PersonalRecordRow>(
      'SELECT * FROM personal_records WHERE exercise_id = ?',
      [exercise.exercise_id],
    )
    for (const pr of detectPRs(existing, exerciseSets, exercise.exercise_id, workout.date)) {
      const previous = previousRecords.find(
        (record) =>
          record.exercise_id === pr.exercise_id &&
          record.record_type === pr.record_type &&
          record.set_id === pr.set_id,
      )
      if (previous) pr.id = previous.id
      await db.exec(
        'INSERT INTO personal_records (id,exercise_id,record_type,value,set_id,date) VALUES (?,?,?,?,?,?)',
        [pr.id, pr.exercise_id, pr.record_type, pr.value, pr.set_id, pr.date],
      )
      newPRs.push(pr)
    }
  }
  return { newPRs, strengthSets }
}

function buildWorkoutSummary(
  workout: WorkoutRow,
  endedAt: string,
  strengthSets: SetRow[],
  newPRs: PersonalRecordRow[],
  distanceM: number,
): WorkoutSummary {
  return {
    totalSets: strengthSets.filter((set) => set.is_warmup === 0).length,
    totalVolume: calculateWorkoutVolume(strengthSets),
    newPRs,
    durationSec: Math.max(
      0,
      Math.round((new Date(endedAt).getTime() - new Date(workout.started_at).getTime()) / 1000),
    ),
    distanceM,
    sessionType: workout.session_type,
  }
}

async function finishedSummary(db: DbAdapter, workoutId: string): Promise<WorkoutSummary | null> {
  const saved = await db.queryOne<{ summary_json: string }>(
    'SELECT summary_json FROM workout_finish_summaries WHERE workout_id = ?',
    [workoutId],
  )
  return saved ? (JSON.parse(saved.summary_json) as WorkoutSummary) : null
}

async function finish(db: DbAdapter, payload: Payload): Promise<WorkoutSummary> {
  const workoutId = String(payload['workoutId'] ?? '')
  const saved = await finishedSummary(db, workoutId)
  if (saved) return saved
  const workout = await db.queryOne<WorkoutRow>('SELECT * FROM workouts WHERE id = ?', [workoutId])
  if (!workout || workout.ended_at) throw new Error('Session is no longer active')
  const endedAt =
    typeof payload['endedAt'] === 'string' ? payload['endedAt'] : new Date().toISOString()
  const opts = record(payload['options'] ?? {})
  const exercises = await db.queryAll<WorkoutExerciseRow>(
    'SELECT * FROM workout_exercises WHERE workout_id = ? AND removed_at IS NULL',
    [workoutId],
  )
  const completedSets = await loadCompletedSets(db, exercises)
  const { newPRs, strengthSets } = await recordStrengthPRs(db, workout, exercises, completedSets)
  const run =
    workout.session_type === 'run'
      ? await db.queryOne<RunRow>('SELECT * FROM runs WHERE workout_id = ?', [workoutId])
      : null
  const distanceM =
    run?.distance_m ?? completedSets.reduce((sum, set) => sum + (set.distance_m ?? 0), 0)
  const runDuration =
    run?.duration_sec ?? completedSets.reduce((sum, set) => sum + (set.duration_sec ?? 0), 0)
  const gymSets = strengthSets.filter((set) => set.is_warmup === 0).length
  const summary = buildWorkoutSummary(workout, endedAt, strengthSets, newPRs, distanceM)
  await db.exec('UPDATE workouts SET ended_at=?,mood_rating=?,energy_rating=?,notes=? WHERE id=?', [
    endedAt,
    opts['moodRating'] ?? null,
    opts['energyRating'] ?? null,
    opts['notes'] ?? null,
    workoutId,
  ])
  const week = isoWeek(parseDateString(workout.date))
  await db.exec(
    `INSERT INTO weekly_training_load (week,gym_volume,gym_sets,run_distance_m,run_duration_sec)
    VALUES (?,?,?,?,?) ON CONFLICT(week) DO UPDATE SET
      gym_volume=COALESCE(weekly_training_load.gym_volume,0)+excluded.gym_volume,
      gym_sets=COALESCE(weekly_training_load.gym_sets,0)+excluded.gym_sets,
      run_distance_m=COALESCE(weekly_training_load.run_distance_m,0)+excluded.run_distance_m,
      run_duration_sec=COALESCE(weekly_training_load.run_duration_sec,0)+excluded.run_duration_sec`,
    [
      week,
      summary.totalVolume,
      gymSets,
      workout.session_type === 'run' ? distanceM : 0,
      workout.session_type === 'run' ? runDuration : 0,
    ],
  )
  await finishOrganization(db, workoutId)
  await db.exec('INSERT INTO workout_finish_summaries (workout_id,summary_json) VALUES (?,?)', [
    workoutId,
    JSON.stringify(summary),
  ])
  return summary
}

/** Rebuild derived facts after a factual correction, within the caller's storage transaction. */
export async function recomputeWorkoutDerivedState(
  db: DbAdapter,
  workoutId: string,
): Promise<void> {
  const corrected = await db.queryOne<{ ended_at: string | null }>(
    'SELECT ended_at FROM workouts WHERE id=?',
    [workoutId],
  )
  if (!corrected?.ended_at) throw new Error('Only finished workouts can recompute corrected facts')
  const previousRecords = await db.queryAll<PersonalRecordRow>('SELECT * FROM personal_records')
  const workouts = await db.queryAll<WorkoutRow>(
    'SELECT * FROM workouts WHERE ended_at IS NOT NULL ORDER BY date,started_at,id',
  )
  await db.exec('DELETE FROM personal_records')
  await db.exec('DELETE FROM weekly_training_load')
  for (const workout of workouts) {
    if (!workout.ended_at) continue
    const exercises = await db.queryAll<WorkoutExerciseRow>(
      'SELECT * FROM workout_exercises WHERE workout_id=? AND removed_at IS NULL ORDER BY order_num,id',
      [workout.id],
    )
    const completedSets = await loadCompletedSets(db, exercises)
    const { newPRs, strengthSets } = await recordStrengthPRs(
      db,
      workout,
      exercises,
      completedSets,
      previousRecords,
    )
    const run =
      workout.session_type === 'run'
        ? await db.queryOne<RunRow>('SELECT * FROM runs WHERE workout_id=?', [workout.id])
        : null
    const distanceM =
      run?.distance_m ?? completedSets.reduce((total, set) => total + (set.distance_m ?? 0), 0)
    const runDuration =
      run?.duration_sec ?? completedSets.reduce((total, set) => total + (set.duration_sec ?? 0), 0)
    const summary = buildWorkoutSummary(workout, workout.ended_at, strengthSets, newPRs, distanceM)
    await db.exec(
      'INSERT INTO workout_finish_summaries(workout_id,summary_json) VALUES(?,?) ON CONFLICT(workout_id) DO UPDATE SET summary_json=excluded.summary_json',
      [workout.id, JSON.stringify(summary)],
    )
    await db.exec(
      `INSERT INTO weekly_training_load(week,gym_volume,gym_sets,run_distance_m,run_duration_sec) VALUES(?,?,?,?,?)
      ON CONFLICT(week) DO UPDATE SET gym_volume=COALESCE(weekly_training_load.gym_volume,0)+excluded.gym_volume,
      gym_sets=COALESCE(weekly_training_load.gym_sets,0)+excluded.gym_sets,
      run_distance_m=COALESCE(weekly_training_load.run_distance_m,0)+excluded.run_distance_m,
      run_duration_sec=COALESCE(weekly_training_load.run_duration_sec,0)+excluded.run_duration_sec`,
      [
        isoWeek(parseDateString(workout.date)),
        summary.totalVolume,
        strengthSets.filter((set) => set.is_warmup === 0).length,
        workout.session_type === 'run' ? distanceM : 0,
        workout.session_type === 'run' ? runDuration : 0,
      ],
    )
  }
}

function readSet(payload: Payload): SetRow {
  const row = record(payload['set'])
  const text = (key: string): string => {
    const value = row[key]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid set ${key}`)
    return value
  }
  const nullableText = (key: string): string | null => {
    const value = row[key]
    if (value === null || typeof value === 'string') return value
    throw new Error(`Invalid set ${key}`)
  }
  const numeric = (
    key: string,
    integer = false,
    maximum = Number.POSITIVE_INFINITY,
  ): number | null => {
    const value = row[key]
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum)
      throw new Error(`Set ${key} must be finite, nonnegative and within range`)
    if (integer && !Number.isSafeInteger(value)) throw new Error(`Set ${key} must be an integer`)
    return value
  }
  const flag = (key: string): 0 | 1 => {
    const value = row[key]
    if (value !== 0 && value !== 1) throw new Error(`Invalid set ${key}`)
    return value
  }
  const setNum = numeric('set_num', true)
  if (setNum === null || setNum < 1) throw new Error('Set number must be a positive integer')
  const technique = row['technique_flag']
  if (
    technique !== null &&
    technique !== 'good' &&
    technique !== 'grinding' &&
    technique !== 'failed' &&
    technique !== 'partial_range'
  )
    throw new Error('Invalid technique flag')
  const bodyFeel = row['body_feel']
  if (
    bodyFeel !== null &&
    bodyFeel !== 'pumped' &&
    bodyFeel !== 'sharp_pain' &&
    bodyFeel !== 'unusually_strong' &&
    bodyFeel !== 'tight'
  )
    throw new Error('Invalid body feel')
  const failure = row['failure_type']
  if (
    failure !== null &&
    failure !== 'muscular' &&
    failure !== 'technical' &&
    failure !== 'near_failure'
  )
    throw new Error('Invalid failure type')
  return {
    id: text('id'),
    workout_exercise_id: text('workout_exercise_id'),
    set_num: setNum,
    is_warmup: flag('is_warmup'),
    weight_kg: numeric('weight_kg'),
    reps: numeric('reps', true),
    rpe: numeric('rpe', false, 10),
    rir: numeric('rir', false, 10),
    notes: nullableText('notes'),
    completed: flag('completed'),
    logged_at: nullableText('logged_at'),
    distance_m: numeric('distance_m'),
    duration_sec: numeric('duration_sec'),
    speed_kmh: numeric('speed_kmh'),
    level: numeric('level'),
    technique_flag: technique,
    body_feel: bodyFeel,
    failure_flag: flag('failure_flag'),
    failure_type: failure,
    partial_reps: numeric('partial_reps', true),
  }
}

async function findPriorSet(db: DbAdapter, type: string, set: SetRow) {
  const session = await db.queryOne<{ ended_at: string | null }>(
    'SELECT w.ended_at FROM workout_exercises we JOIN workouts w ON w.id=we.workout_id WHERE we.id=?',
    [set.workout_exercise_id],
  )
  if (!session || session.ended_at) throw new Error('Session is not writable')
  const target = await db.queryOne<{ id: string; completed: number }>(
    'SELECT id,completed FROM sets WHERE id=? AND workout_exercise_id=?',
    [set.id, set.workout_exercise_id],
  )
  if (type === 'WORKOUT_UPDATE_SET' && !target) {
    throw new Error('Set is not part of the active session')
  }
  const prior =
    type === 'WORKOUT_LOG_SET' || type === 'WORKOUT_SAVE_DRAFT'
      ? (target ??
        (await db.queryOne<{ id: string; completed: number }>(
          'SELECT id,completed FROM sets WHERE workout_exercise_id=? AND set_num=? AND is_warmup=?',
          [set.workout_exercise_id, set.set_num, set.is_warmup],
        )))
      : null
  return prior
}

async function validateSetCompletion(db: DbAdapter, set: SetRow, prior: { id: string } | null) {
  if (set.completed !== 1) throw new Error('Use undo to return a completed set to a draft')
  const skipped = await db.queryOne('SELECT set_id FROM workout_set_skips WHERE set_id=?', [
    prior?.id ?? set.id,
  ])
  if (skipped) throw new Error('Restore the skipped row before completing it')
  const mode = await activityLoggingMode(db, set.workout_exercise_id)
  if (mode === 'strength' && (set.reps === null || (set.reps === 0 && !set.failure_flag)))
    throw new Error('Achieved reps are required')
  if (mode !== 'strength' && (set.distance_m ?? 0) <= 0 && (set.duration_sec ?? 0) <= 0)
    throw new Error('A completed activity needs a positive distance or duration')
}

/** Serialized worker-side lifecycle operations for local workout writes. */
async function saveSet(db: DbAdapter, type: string, payload: Payload): Promise<SetRow> {
  const set = readSet(payload)
  const prior = await findPriorSet(db, type, set)
  if (type === 'WORKOUT_SAVE_DRAFT') {
    if (prior?.completed === 1) throw new Error('A completed set cannot be edited as a draft')
    set.completed = 0
    set.logged_at = null
  } else {
    await validateSetCompletion(db, set, prior)
  }
  const binds = [
    set.set_num,
    set.is_warmup,
    set.weight_kg,
    set.reps,
    set.rpe,
    set.rir,
    set.notes,
    set.completed,
    set.logged_at,
    set.distance_m,
    set.duration_sec,
    set.speed_kmh,
    set.level,
    set.technique_flag,
    set.body_feel,
    set.failure_flag,
    set.failure_type,
    set.partial_reps,
  ]
  if (type === 'WORKOUT_UPDATE_SET' || prior) {
    const id = type === 'WORKOUT_UPDATE_SET' ? set.id : (prior?.id ?? set.id)
    await db.exec(
      'UPDATE sets SET set_num=?,is_warmup=?,weight_kg=?,reps=?,rpe=?,rir=?,notes=?,completed=?,logged_at=?,distance_m=?,duration_sec=?,speed_kmh=?,level=?,technique_flag=?,body_feel=?,failure_flag=?,failure_type=?,partial_reps=? WHERE id=? AND workout_exercise_id=?',
      [...binds, id, set.workout_exercise_id],
    )
    if (prior) set.id = id
  } else {
    await db.exec(
      `INSERT INTO sets (${SET_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [set.id, set.workout_exercise_id, ...binds],
    )
  }
  return set
}

async function writableSet(db: DbAdapter, payload: Payload): Promise<SetRow> {
  if (typeof payload['setId'] !== 'string') throw new Error('Set identity is required')
  const row = await db.queryOne<SetRow>('SELECT * FROM sets WHERE id=?', [payload['setId']])
  if (!row) throw new Error('Set is not part of the active session')
  const owner = await db.queryOne<{ ended_at: string | null }>(
    'SELECT w.ended_at FROM workout_exercises e JOIN workouts w ON w.id=e.workout_id WHERE e.id=?',
    [row.workout_exercise_id],
  )
  if (!owner || owner.ended_at) throw new Error('Session is not writable')
  return row
}

async function undoSet(db: DbAdapter, payload: Payload): Promise<SetRow> {
  const set = await writableSet(db, payload)
  await db.exec('UPDATE sets SET completed=0,logged_at=NULL WHERE id=?', [set.id])
  return { ...set, completed: 0, logged_at: null }
}

async function skipSet(db: DbAdapter, payload: Payload): Promise<SetRow> {
  const set = await saveSet(db, 'WORKOUT_SAVE_DRAFT', payload)
  if (typeof payload['skipped'] !== 'boolean') throw new Error('Skipped state must be boolean')
  if (payload['skipped']) {
    await db.exec('INSERT OR IGNORE INTO workout_set_skips (set_id,skipped_at) VALUES (?,?)', [
      set.id,
      new Date().toISOString(),
    ])
  } else await db.exec('DELETE FROM workout_set_skips WHERE set_id=?', [set.id])
  return set
}

async function activeSession(db: DbAdapter): Promise<WorkoutSession | null> {
  const workout = await db.queryOne<WorkoutRow>(
    'SELECT * FROM workouts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  )
  return workout ? loadSession(db, workout) : null
}

async function addExercise(db: DbAdapter, payload: Payload): Promise<WorkoutExerciseRow> {
  const row = payload['exercise'] as Omit<WorkoutExerciseRow, 'logging_mode'>
  await requireActiveWorkout(db, row.workout_id)
  const exercise = await db.queryOne<{ logging_mode: WorkoutExerciseRow['logging_mode'] }>(
    'SELECT logging_mode FROM exercises WHERE id=?',
    [row.exercise_id],
  )
  if (!exercise) throw new Error('Exercise not found')
  await db.exec(
    'INSERT INTO workout_exercises (id,workout_id,exercise_id,logging_mode,order_num,superset_group,rest_seconds) VALUES (?,?,?,?,?,?,?)',
    [
      row.id,
      row.workout_id,
      row.exercise_id,
      exercise.logging_mode,
      row.order_num,
      row.superset_group,
      row.rest_seconds,
    ],
  )
  const pending = payload['pendingSets']
  if (pending !== undefined) {
    if (!Array.isArray(pending)) throw new Error('Pending rows must be an array')
    for (const input of pending) {
      const set = readSet({ set: input })
      if (set.workout_exercise_id !== row.id)
        throw new Error('Pending row belongs to another exercise')
      await saveSet(db, 'WORKOUT_SAVE_DRAFT', { set })
    }
  }
  return { ...row, logging_mode: exercise.logging_mode }
}

async function saveRun(db: DbAdapter, payload: Payload): Promise<RunRow> {
  const run = payload['run'] as RunRow
  await requireActiveWorkout(db, run.workout_id)
  if (
    run.distance_m != null &&
    run.distance_m > 0 &&
    run.duration_sec != null &&
    run.avg_pace_sec_km == null
  ) {
    run.avg_pace_sec_km = Math.round(run.duration_sec / (run.distance_m / 1000))
  }
  await db.exec(
    `INSERT INTO runs (id,workout_id,run_type,distance_m,duration_sec,avg_pace_sec_km,avg_hr,max_hr,elevation_gain_m,avg_cadence,avg_power_w,manual_entry)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workout_id) DO UPDATE SET run_type=excluded.run_type,distance_m=excluded.distance_m,duration_sec=excluded.duration_sec,avg_pace_sec_km=excluded.avg_pace_sec_km,avg_hr=excluded.avg_hr,max_hr=excluded.max_hr,elevation_gain_m=excluded.elevation_gain_m,avg_cadence=excluded.avg_cadence,avg_power_w=excluded.avg_power_w,manual_entry=excluded.manual_entry`,
    [
      run.id,
      run.workout_id,
      run.run_type,
      run.distance_m,
      run.duration_sec,
      run.avg_pace_sec_km,
      run.avg_hr,
      run.max_hr,
      run.elevation_gain_m,
      run.avg_cadence,
      run.avg_power_w,
      run.manual_entry,
    ],
  )
  return run
}

async function discard(db: DbAdapter, payload: Payload): Promise<boolean> {
  const id = String(payload['workoutId'] ?? '')
  const workout = await db.queryOne<WorkoutRow>(
    'SELECT * FROM workouts WHERE id=? AND ended_at IS NULL',
    [id],
  )
  if (workout) {
    await discardOrganization(db, id)
    await db.exec('DELETE FROM workouts WHERE id=?', [id])
  }
  return true
}

export async function dispatchWorkout(
  db: DbAdapter,
  type: string,
  input: unknown,
): Promise<unknown> {
  const payload = record(input ?? {})
  switch (type) {
    case 'WORKOUT_START':
      return start(db, payload)
    case 'WORKOUT_ACTIVE':
      return activeSession(db)
    case 'WORKOUT_LOG_SET':
    case 'WORKOUT_UPDATE_SET':
    case 'WORKOUT_SAVE_DRAFT':
      return saveSet(db, type, payload)
    case 'WORKOUT_UNDO_SET':
      return undoSet(db, payload)
    case 'WORKOUT_SKIP_SET':
      return skipSet(db, payload)
    case 'WORKOUT_ADD_EXERCISE':
      return addExercise(db, payload)
    case 'WORKOUT_RUN_DATA':
      return saveRun(db, payload)
    case 'WORKOUT_DISCARD':
      return discard(db, payload)
    case 'WORKOUT_FINISH':
      return finish(db, payload)
    default:
      throw new Error(`Unknown workout operation: ${type}`)
  }
}
