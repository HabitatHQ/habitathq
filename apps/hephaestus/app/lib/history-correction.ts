import { organizationCreditPreview, recomputeOrganizationCredit } from '~/lib/organization-storage'
import { parseSerializablePrescription } from '~/lib/prescription-domain'
import { recomputeWorkoutDerivedState } from '~/lib/workout-storage'
import type { DbAdapter, LoggingMode, RunRow } from '~/types/database'
import type {
  AppointmentCandidate,
  CapturedActivityIntent,
  CapturedSetIntent,
  CorrectableActivity,
  CorrectableSet,
  CorrectableWorkout,
  FieldComparison,
  HistoryCorrectionDetail,
  HistoryCorrectionDraft,
  HistoryCorrectionPreview,
  HistoryCorrectionResult,
  HistoryOperation,
  HistoryOperationMap,
  HistorySetValues,
} from '~/types/history-correction'

function record(value: unknown): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Correction data must be an object')
  return value
}
function property(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Reflect.get(value, key)
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}
function finite(value: unknown, label: string, maximum = Number.MAX_VALUE): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum)
    throw new Error(`${label} is invalid`)
  return value
}
function localDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('Performed date must be a local YYYY-MM-DD date')
  const parsed = new Date(`${value}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error('Performed date is invalid')
  return value
}
function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(`${label} must be a valid ISO timestamp`)
  localDate(value.slice(0, 10))
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Correction rows must be an array')
  return value
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Correction flags must be boolean')
  return value
}
function values(value: unknown): HistorySetValues {
  const source = record(value),
    result: HistorySetValues = {}
  for (const key of ['weightKg', 'reps', 'rpe', 'rir', 'durationSec', 'distanceM'] as const) {
    if (!Object.hasOwn(source, key)) continue
    const number = finite(property(source, key), key, key === 'rpe' ? 10 : Number.MAX_VALUE)
    if (number !== null && ['reps', 'rir'].includes(key) && !Number.isSafeInteger(number))
      throw new Error(`${key} must be a whole number`)
    result[key] = number
  }
  if (Object.hasOwn(source, 'notes')) {
    const notes = property(source, 'notes')
    if (notes !== null && typeof notes !== 'string')
      throw new Error('Set notes must be text or null')
    result.notes = notes
  }
  if (Object.hasOwn(source, 'completed')) result.completed = boolean(property(source, 'completed'))
  if (Object.hasOwn(source, 'isWarmup')) result.isWarmup = boolean(property(source, 'isWarmup'))
  return result
}
function parseHistoryCorrectionDraft(value: unknown): HistoryCorrectionDraft {
  const source = record(value)
  const version = property(source, 'expectedVersion')
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)
    throw new Error('Correction version is invalid')
  const result: HistoryCorrectionDraft = {
    workoutId: text(property(source, 'workoutId'), 'Workout'),
    expectedVersion: version,
  }
  if (Object.hasOwn(source, 'title'))
    result.title =
      property(source, 'title') === null ? null : text(property(source, 'title'), 'Title')
  if (Object.hasOwn(source, 'performedDate'))
    result.performedDate = localDate(property(source, 'performedDate'))
  if (Object.hasOwn(source, 'startedAt'))
    result.startedAt = timestamp(property(source, 'startedAt'), 'Start time')
  if (Object.hasOwn(source, 'endedAt'))
    result.endedAt = timestamp(property(source, 'endedAt'), 'Finish time')
  if (Object.hasOwn(source, 'appointmentId'))
    result.appointmentId =
      property(source, 'appointmentId') === null
        ? null
        : text(property(source, 'appointmentId'), 'Appointment')
  if (Object.hasOwn(source, 'activities')) {
    const activityIds = new Set<string>(),
      setIds = new Set<string>()
    result.activities = array(property(source, 'activities')).map((value) => {
      const item = record(value),
        activity: NonNullable<HistoryCorrectionDraft['activities']>[number] = {
          id: text(property(item, 'id'), 'Activity'),
        }
      if (activityIds.has(activity.id)) throw new Error('Duplicate correction activity')
      activityIds.add(activity.id)
      if (Object.hasOwn(item, 'exerciseId'))
        activity.exerciseId = text(property(item, 'exerciseId'), 'Exercise')
      if (Object.hasOwn(item, 'removed')) activity.removed = boolean(property(item, 'removed'))
      if (Object.hasOwn(item, 'sets'))
        activity.sets = array(property(item, 'sets')).map((value) => {
          const row = record(value),
            set: NonNullable<typeof activity.sets>[number] = {
              id: text(property(row, 'id'), 'Set'),
            }
          if (setIds.has(set.id)) throw new Error('Duplicate correction set')
          setIds.add(set.id)
          if (Object.hasOwn(row, 'removed')) set.removed = boolean(property(row, 'removed'))
          if (Object.hasOwn(row, 'values')) set.values = values(property(row, 'values'))
          return set
        })
      if (Object.hasOwn(item, 'addSets'))
        activity.addSets = array(property(item, 'addSets')).map(values)
      return activity
    })
  }
  if (Object.hasOwn(source, 'addActivities'))
    result.addActivities = array(property(source, 'addActivities')).map((value) => {
      const item = record(value),
        sets = array(property(item, 'sets')).map(values)
      if (!sets.length) throw new Error('An added actual activity requires a result row')
      return { exerciseId: text(property(item, 'exerciseId'), 'Exercise'), sets }
    })
  if (Object.hasOwn(source, 'run')) {
    const run = record(property(source, 'run'))
    result.run = {}
    if (Object.hasOwn(run, 'distanceM'))
      result.run.distanceM = finite(property(run, 'distanceM'), 'Run distance')
    if (Object.hasOwn(run, 'durationSec'))
      result.run.durationSec = finite(property(run, 'durationSec'), 'Run duration')
  }
  return result
}

function numericTarget(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const resolved = property(value, 'resolvedValue')
  if (typeof resolved === 'number' && Number.isFinite(resolved)) return resolved
  const rule = property(value, 'rule'),
    fixed = property(rule, 'value')
  return property(rule, 'kind') === 'fixed' && typeof fixed === 'number' && Number.isFinite(fixed)
    ? fixed
    : null
}
function targetFor(snapshot: unknown, field: FieldComparison['field']): FieldComparison['target'] {
  const raw = property(snapshot, field)
  if (field === 'reps') {
    if (property(raw, 'kind') === 'range' || property(raw, 'kind') === 'minimum') {
      const minimum = property(raw, 'minimum'),
        maximum = property(raw, 'maximum')
      if (typeof minimum !== 'number' || !Number.isFinite(minimum)) return null
      return property(raw, 'kind') === 'range' &&
        typeof maximum === 'number' &&
        Number.isFinite(maximum)
        ? { kind: 'range', minimum, maximum }
        : { kind: 'minimum', minimum }
    }
    if (property(raw, 'kind') === 'exact') {
      const minimum = numericTarget(property(raw, 'value'))
      return minimum === null ? null : { kind: 'exact', minimum }
    }
  }
  const minimum = numericTarget(raw)
  return minimum === null ? null : { kind: 'exact', minimum }
}
function comparisonStatus(
  target: FieldComparison['target'],
  actual: number | null,
): FieldComparison['status'] {
  if (!target || actual === null) return 'unknown'
  if (actual < target.minimum) return 'below'
  if (target.kind === 'range')
    return target.maximum !== undefined && actual > target.maximum ? 'above' : 'matches'
  return actual === target.minimum ? 'matches' : 'above'
}
function comparisonsFor(
  sets: CorrectableSet[],
  intents: CapturedSetIntent[],
  activityTargets: unknown = {},
): HistoryCorrectionDetail['activities'][number]['comparisons'] {
  const intentBySet = new Map(intents.map((intent) => [intent.set_id, intent]))
  return sets
    .filter((set) => set.removed_at === null)
    .map((set) => {
      const intent = intentBySet.get(set.id)
      const snapshot: unknown = intent ? JSON.parse(intent.target_snapshot_json) : {}
      const fields = (
        [
          ['weightKg', 'weight_kg'],
          ['reps', 'reps'],
          ['rpe', 'rpe'],
          ['rir', 'rir'],
          ['durationSec', 'duration_sec'],
          ['distanceM', 'distance_m'],
        ] as const
      ).map(([field, column]): FieldComparison => {
        const target = targetFor(
          field === 'durationSec' || field === 'distanceM' ? activityTargets : snapshot,
          field,
        )
        const actual = set.completed === 1 ? set[column] : null
        const status = comparisonStatus(target, actual)
        return { field, target, actual, status }
      })
      return { setId: set.id, fields }
    })
}
async function readDetail(db: DbAdapter, workoutId: string): Promise<HistoryCorrectionDetail> {
  const workout = await db.queryOne<CorrectableWorkout>('SELECT * FROM workouts WHERE id=?', [
    workoutId,
  ])
  if (!workout) throw new Error('Workout not found')
  const activities = await db.queryAll<CorrectableActivity>(
    'SELECT we.*,e.name AS exercise_name FROM workout_exercises we JOIN exercises e ON e.id=we.exercise_id WHERE we.workout_id=? ORDER BY we.order_num,we.id',
    [workoutId],
  )
  const intentActivities = await db.queryAll<CapturedActivityIntent>(
    'SELECT ia.* FROM workout_intent_activities ia JOIN workout_exercises we ON we.id=ia.workout_exercise_id WHERE we.workout_id=? ORDER BY ia.intent_order,ia.workout_exercise_id',
    [workoutId],
  )
  const intentSets = await db.queryAll<CapturedSetIntent>(
    'SELECT ins.*,s.workout_exercise_id FROM workout_intent_sets ins JOIN sets s ON s.id=ins.set_id JOIN workout_exercises we ON we.id=s.workout_exercise_id WHERE we.workout_id=? ORDER BY s.set_num,s.id',
    [workoutId],
  )
  const captured = await db.queryOne<{ prescription_json: string | null }>(
    'SELECT prescription_json FROM workout_intents WHERE workout_id=?',
    [workoutId],
  )
  const prescription = captured?.prescription_json
    ? parseSerializablePrescription(JSON.parse(captured.prescription_json))
    : null
  const result: HistoryCorrectionDetail['activities'] = []
  for (const activity of activities) {
    const sets = await db.queryAll<CorrectableSet>(
      'SELECT * FROM sets WHERE workout_exercise_id=? ORDER BY set_num,id',
      [activity.id],
    )
    const intentId = intentActivities.find(
      (intent) => intent.workout_exercise_id === activity.id,
    )?.intent_activity_id
    const targets = prescription?.activities.find((item) => item.id === intentId)?.targets
    result.push({
      activity,
      sets,
      comparisons: comparisonsFor(sets, intentSets, targets ? { ...targets } : {}),
    })
  }
  const skippedSetIds = (
    await db.queryAll<{ set_id: string }>(
      'SELECT sk.set_id FROM workout_set_skips sk JOIN sets s ON s.id=sk.set_id JOIN workout_exercises we ON we.id=s.workout_exercise_id WHERE we.workout_id=?',
      [workoutId],
    )
  ).map((row) => row.set_id)
  return {
    workout,
    activities: result,
    intentActivities,
    intentSets,
    skippedSetIds,
    run: await db.queryOne<RunRow>('SELECT * FROM runs WHERE workout_id=?', [workoutId]),
    appointmentId:
      (
        await db.queryOne<{ appointment_id: string | null }>(
          'SELECT appointment_id FROM organization_source_links WHERE workout_id=?',
          [workoutId],
        )
      )?.appointment_id ?? null,
    version: workout.correction_version,
  }
}
async function candidates(db: DbAdapter, workoutId: string): Promise<AppointmentCandidate[]> {
  return db.queryAll<AppointmentCandidate>(
    `SELECT a.id,a.plan_id AS planId,p.name AS planName,a.routine_id AS routineId,r.name AS routineName,a.planned_date AS plannedDate,a.status,a.workout_id AS workoutId,CASE WHEN a.workout_id IS NOT NULL AND a.workout_id<>? THEN 1 ELSE 0 END AS protected
    FROM organization_appointments a JOIN training_plans p ON p.id=a.plan_id JOIN saved_routines r ON r.id=a.routine_id WHERE a.id=(SELECT appointment_id FROM organization_source_links WHERE workout_id=?) OR (a.status='open' AND a.workout_id IS NULL) ORDER BY a.planned_date,a.id`,
    [workoutId, workoutId],
  )
}
function context(detail: HistoryCorrectionDetail): HistoryCorrectionPreview['before'] {
  return {
    title: detail.workout.title,
    date: detail.workout.date,
    startedAt: detail.workout.started_at,
    endedAt: detail.workout.ended_at,
  }
}
function correctedContext(
  detail: HistoryCorrectionDetail,
  change: HistoryCorrectionDraft,
): HistoryCorrectionPreview['after'] {
  const result = context(detail)
  if (change.title !== undefined) result.title = change.title
  if (change.performedDate !== undefined) result.date = change.performedDate
  if (change.startedAt !== undefined) result.startedAt = change.startedAt
  if (change.endedAt !== undefined) result.endedAt = change.endedAt
  if (!result.endedAt || Date.parse(result.endedAt) < Date.parse(result.startedAt))
    throw new Error('Finish time precedes start time')
  return result
}
async function exerciseMode(db: DbAdapter, id: string): Promise<LoggingMode> {
  const row = await db.queryOne<{ logging_mode: LoggingMode }>(
    'SELECT logging_mode FROM exercises WHERE id=?',
    [id],
  )
  if (!row) throw new Error('Exercise does not exist')
  return row.logging_mode
}
function columnsFor(values: HistorySetValues): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {}
  for (const [key, column] of [
    ['weightKg', 'weight_kg'],
    ['reps', 'reps'],
    ['rpe', 'rpe'],
    ['rir', 'rir'],
    ['durationSec', 'duration_sec'],
    ['distanceM', 'distance_m'],
  ] as const)
    if (values[key] !== undefined) result[column] = values[key]
  if (values.notes !== undefined) result['notes'] = values.notes
  if (values.completed !== undefined) result['completed'] = values.completed ? 1 : 0
  if (values.isWarmup !== undefined) result['is_warmup'] = values.isWarmup ? 1 : 0
  return result
}
async function validateActualResults(db: DbAdapter, activityId: string): Promise<void> {
  const rows = await db.queryAll<{
    logging_mode: LoggingMode
    reps: number | null
    failure_flag: number
    duration_sec: number | null
    distance_m: number | null
  }>(
    `SELECT we.logging_mode,s.reps,s.failure_flag,s.duration_sec,s.distance_m FROM sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id
     WHERE we.id=? AND we.removed_at IS NULL AND s.removed_at IS NULL AND s.completed=1 AND NOT EXISTS (SELECT 1 FROM workout_set_skips sk WHERE sk.set_id=s.id)`,
    [activityId],
  )
  for (const row of rows) {
    if (
      row.logging_mode === 'strength' &&
      (row.reps === null || (row.reps === 0 && !row.failure_flag))
    )
      throw new Error('Achieved reps are required for a performed strength result')
    if (
      row.logging_mode !== 'strength' &&
      (row.distance_m ?? 0) <= 0 &&
      (row.duration_sec ?? 0) <= 0
    )
      throw new Error('A performed non-strength result needs a positive distance or duration')
  }
}
async function relink(
  db: DbAdapter,
  workoutId: string,
  from: string | null,
  to: string | null,
): Promise<void> {
  if (from === to) return
  if (from) {
    const old = await db.queryOne<{ workout_id: string | null }>(
      'SELECT workout_id FROM organization_appointments WHERE id=?',
      [from],
    )
    if (!old || old.workout_id !== workoutId)
      throw new Error('Existing appointment link changed after preview')
    await db.exec(
      "UPDATE organization_appointments SET status='open',workout_id=NULL WHERE id=? AND workout_id=?",
      [from, workoutId],
    )
  }
  if (to) {
    const next = await db.queryOne<{ status: string; workout_id: string | null }>(
      'SELECT status,workout_id FROM organization_appointments WHERE id=?',
      [to],
    )
    if (next?.status !== 'open' || next.workout_id !== null)
      throw new Error('Appointment is unavailable or protected by another workout')
    await db.exec('UPDATE organization_appointments SET workout_id=? WHERE id=?', [workoutId, to])
  }
  await db.exec(
    'INSERT INTO organization_source_links(workout_id,appointment_id) VALUES(?,?) ON CONFLICT(workout_id) DO UPDATE SET appointment_id=excluded.appointment_id',
    [workoutId, to],
  )
}

async function insertActualSet(
  db: DbAdapter,
  activityId: string,
  setNumber: number,
  values: HistorySetValues,
): Promise<void> {
  const entries = Object.entries(columnsFor(values))
  const columns = ['id', 'workout_exercise_id', 'set_num', ...entries.map(([column]) => column)]
  await db.exec(
    `INSERT INTO sets(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
    [crypto.randomUUID(), activityId, setNumber, ...entries.map(([, value]) => value)],
  )
}

async function correctActualSet(
  db: DbAdapter,
  currentSets: CorrectableSet[],
  set: NonNullable<NonNullable<HistoryCorrectionDraft['activities']>[number]['sets']>[number],
  correctionId: string,
): Promise<void> {
  if (!currentSets.some((row) => row.id === set.id))
    throw new Error('Set is not part of this activity')
  if (set.removed !== undefined)
    await db.exec('UPDATE sets SET removed_at=?,removed_by_correction_id=? WHERE id=?', [
      set.removed ? new Date().toISOString() : null,
      set.removed ? correctionId : null,
      set.id,
    ])
  if (!set.values) return
  const entries = Object.entries(columnsFor(set.values))
  if (entries.length)
    await db.exec(
      `UPDATE sets SET ${entries.map(([column]) => `${column}=?`).join(',')} WHERE id=?`,
      [...entries.map(([, value]) => value), set.id],
    )
  if (set.values.completed === true)
    await db.exec('DELETE FROM workout_set_skips WHERE set_id=?', [set.id])
}

async function correctActivity(
  db: DbAdapter,
  detail: HistoryCorrectionDetail,
  activity: NonNullable<HistoryCorrectionDraft['activities']>[number],
  correctionId: string,
): Promise<void> {
  const current = detail.activities.find((item) => item.activity.id === activity.id)
  if (!current) throw new Error('Activity is not part of this workout')
  if (activity.exerciseId !== undefined) {
    await exerciseMode(db, activity.exerciseId)
    await db.exec('UPDATE workout_exercises SET exercise_id=? WHERE id=?', [
      activity.exerciseId,
      activity.id,
    ])
  }
  if (activity.removed !== undefined)
    await db.exec(
      'UPDATE workout_exercises SET removed_at=?,removed_by_correction_id=? WHERE id=?',
      [
        activity.removed ? new Date().toISOString() : null,
        activity.removed ? correctionId : null,
        activity.id,
      ],
    )
  for (const set of activity.sets ?? []) await correctActualSet(db, current.sets, set, correctionId)
  let setNumber = Math.max(0, ...current.sets.map((set) => set.set_num))
  for (const set of activity.addSets ?? []) await insertActualSet(db, activity.id, ++setNumber, set)
  await validateActualResults(db, activity.id)
}

async function addActualActivities(db: DbAdapter, change: HistoryCorrectionDraft): Promise<void> {
  let order =
    (
      await db.queryOne<{ n: number }>(
        'SELECT COALESCE(MAX(order_num),0) AS n FROM workout_exercises WHERE workout_id=?',
        [change.workoutId],
      )
    )?.n ?? 0
  for (const activity of change.addActivities ?? []) {
    const mode = await exerciseMode(db, activity.exerciseId)
    const id = crypto.randomUUID()
    await db.exec(
      'INSERT INTO workout_exercises(id,workout_id,exercise_id,logging_mode,order_num,rest_seconds) VALUES(?,?,?,?,?,120)',
      [id, change.workoutId, activity.exerciseId, mode, ++order],
    )
    for (const [index, set] of activity.sets.entries())
      await insertActualSet(db, id, index + 1, set)
    await validateActualResults(db, id)
  }
}

/** Called inside the worker transaction or a rollback-only review savepoint. */
async function applyFacts(
  db: DbAdapter,
  detail: HistoryCorrectionDetail,
  change: HistoryCorrectionDraft,
  correctionId: string,
): Promise<void> {
  const after = correctedContext(detail, change)
  await db.exec(
    'UPDATE workouts SET title=?,date=?,started_at=?,ended_at=?,correction_version=correction_version+1 WHERE id=?',
    [after.title, after.date, after.startedAt, after.endedAt, change.workoutId],
  )
  for (const activity of change.activities ?? [])
    await correctActivity(db, detail, activity, correctionId)
  await addActualActivities(db, change)
  if (change.run) {
    if (detail.run?.manual_entry !== 1)
      throw new Error('Only a saved manual run can be factually corrected')
    await db.exec(
      'UPDATE runs SET distance_m=?,duration_sec=? WHERE workout_id=? AND manual_entry=1',
      [
        change.run.distanceM === undefined ? detail.run.distance_m : change.run.distanceM,
        change.run.durationSec === undefined ? detail.run.duration_sec : change.run.durationSec,
        change.workoutId,
      ],
    )
  }
  await relink(
    db,
    change.workoutId,
    detail.appointmentId,
    change.appointmentId === undefined ? detail.appointmentId : change.appointmentId,
  )
}
async function preview(db: DbAdapter, input: unknown): Promise<HistoryCorrectionPreview> {
  const change = parseHistoryCorrectionDraft(input),
    detail = await readDetail(db, change.workoutId)
  if (!detail.workout.ended_at) throw new Error('Only finished workouts can be corrected')
  if (detail.version !== change.expectedVersion)
    throw new Error('Workout changed; reload history before reviewing a correction')
  const beforeCredit = await organizationCreditPreview(db, { workoutId: change.workoutId })
  let proposed: HistoryCorrectionDetail, afterCredit: HistoryCorrectionPreview['credit']['after']
  await db.exec('SAVEPOINT history_correction_review')
  try {
    await applyFacts(db, detail, change, crypto.randomUUID())
    proposed = await readDetail(db, change.workoutId)
    afterCredit = await organizationCreditPreview(db, { workoutId: change.workoutId })
  } finally {
    await db.exec('ROLLBACK TO history_correction_review')
    await db.exec('RELEASE history_correction_review')
  }
  const snapshot = {
    draft: change,
    detailFingerprint: JSON.stringify(detail),
    creditFingerprint: JSON.stringify(beforeCredit),
  }
  const id = crypto.randomUUID(),
    fingerprint = JSON.stringify(snapshot)
  await db.exec(
    'INSERT INTO history_correction_previews(id,workout_id,fingerprint,snapshot_json,created_at) VALUES(?,?,?,?,?)',
    [id, change.workoutId, fingerprint, JSON.stringify(snapshot), new Date().toISOString()],
  )
  return {
    previewId: id,
    fingerprint,
    workoutId: change.workoutId,
    version: detail.version,
    before: context(detail),
    after: context(proposed),
    run: {
      before: detail.run
        ? { distanceM: detail.run.distance_m, durationSec: detail.run.duration_sec }
        : null,
      after: proposed.run
        ? { distanceM: proposed.run.distance_m, durationSec: proposed.run.duration_sec }
        : null,
    },
    appointment: { beforeId: detail.appointmentId, afterId: proposed.appointmentId },
    credit: { before: beforeCredit, after: afterCredit },
    comparisons: proposed.activities
      .filter((item) => item.activity.removed_at === null)
      .flatMap((item) =>
        item.comparisons
          .filter((row) => !proposed.skippedSetIds.includes(row.setId))
          .map((row) => ({
            activityId: item.activity.id,
            exerciseName: item.activity.exercise_name,
            setNumber: item.sets.find((set) => set.id === row.setId)?.set_num ?? 0,
            ...row,
          })),
      ),
    impact: {
      removedActivities: (change.activities ?? []).filter((item) => item.removed).length,
      removedSets: (change.activities ?? [])
        .flatMap((item) => item.sets ?? [])
        .filter((item) => item.removed).length,
      addedActivities: change.addActivities?.length ?? 0,
      addedSets:
        (change.addActivities ?? []).reduce((sum, item) => sum + item.sets.length, 0) +
        (change.activities ?? []).reduce((sum, item) => sum + (item.addSets?.length ?? 0), 0),
    },
  }
}
async function apply(db: DbAdapter, input: unknown): Promise<HistoryCorrectionResult> {
  const source = record(input),
    id = text(property(source, 'previewId'), 'Preview')
  const stored = await db.queryOne<{
    workout_id: string
    fingerprint: string
    snapshot_json: string
  }>('SELECT * FROM history_correction_previews WHERE id=?', [id])
  if (!stored || stored.fingerprint !== property(source, 'fingerprint'))
    throw new Error('History correction preview is stale or missing')
  const snapshot = record(JSON.parse(stored.snapshot_json)),
    change = parseHistoryCorrectionDraft(property(snapshot, 'draft'))
  const detail = await readDetail(db, stored.workout_id)
  if (
    change.workoutId !== stored.workout_id ||
    detail.version !== change.expectedVersion ||
    !detail.workout.ended_at
  )
    throw new Error('Workout changed after correction preview')
  if (JSON.stringify(detail) !== property(snapshot, 'detailFingerprint'))
    throw new Error('Workout facts changed after correction preview')
  if (
    JSON.stringify(await organizationCreditPreview(db, { workoutId: stored.workout_id })) !==
    property(snapshot, 'creditFingerprint')
  )
    throw new Error('Workout credit changed after correction preview')
  const correctionId = crypto.randomUUID()
  await applyFacts(db, detail, change, correctionId)
  await recomputeWorkoutDerivedState(db, stored.workout_id)
  await recomputeOrganizationCredit(db, stored.workout_id)
  const credit = await organizationCreditPreview(db, { workoutId: stored.workout_id })
  await db.exec(
    'INSERT INTO history_corrections(id,workout_id,base_version,operation_json,applied_at) VALUES(?,?,?,?,?)',
    [
      correctionId,
      stored.workout_id,
      detail.version,
      stored.snapshot_json,
      new Date().toISOString(),
    ],
  )
  await db.exec('DELETE FROM history_correction_previews WHERE id=?', [id])
  const result = await readDetail(db, stored.workout_id)
  return {
    workoutId: stored.workout_id,
    version: result.version,
    detail: result,
    unfulfilledAppointmentId: credit.qualifies ? null : result.appointmentId,
  }
}

export function dispatchHistory<K extends HistoryOperation>(
  db: DbAdapter,
  type: K,
  input: HistoryOperationMap[K]['payload'],
): Promise<HistoryOperationMap[K]['result']>
export function dispatchHistory(db: DbAdapter, type: string, input: unknown): Promise<unknown>
export async function dispatchHistory(
  db: DbAdapter,
  type: string,
  input: unknown,
): Promise<unknown> {
  switch (type) {
    case 'HISTORY_CORRECTION_READ':
      return readDetail(db, text(property(record(input), 'workoutId'), 'Workout'))
    case 'HISTORY_CORRECTION_PREVIEW':
      return preview(db, input)
    case 'HISTORY_CORRECTION_APPLY':
      return apply(db, input)
    case 'HISTORY_APPOINTMENT_CANDIDATES':
      return candidates(db, text(property(record(input), 'workoutId'), 'Workout'))
    default:
      throw new Error(`Unknown history request: ${type}`)
  }
}
