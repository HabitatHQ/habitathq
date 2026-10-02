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
import { isoWeek, localDateString } from './format'
import { detectPRs } from './pr'
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
  sessionType?: string
  intensityModifier?: number
  volumeModifier?: number
}
type Payload = Record<string, unknown>
export interface WorkoutSession {
  workout: WorkoutRow
  exercises: WorkoutExerciseRow[]
  sets: SetRow[]
  run: RunRow | null
  groups: TemplateGroupRow[]
  options: { intensity_modifier: number; volume_modifier: number } | null
}
const SET_COLUMNS =
  'id,workout_exercise_id,set_num,is_warmup,weight_kg,reps,rpe,rir,notes,completed,logged_at,distance_m,duration_sec,speed_kmh,level,technique_flag,body_feel,failure_flag,failure_type,partial_reps'

function record(value: unknown): Payload {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid workout request')
  return value as Payload
}

async function loadSession(db: DbAdapter, workout: WorkoutRow) {
  const exercises = await db.queryAll<WorkoutExerciseRow>(
    'SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY order_num',
    [workout.id],
  )
  const sets: SetRow[] = []
  for (const exercise of exercises) {
    sets.push(
      ...(await db.queryAll<SetRow>(
        `SELECT ${SET_COLUMNS} FROM sets WHERE workout_exercise_id = ? ORDER BY set_num`,
        [exercise.id],
      )),
    )
  }
  const run = await db.queryOne<RunRow>('SELECT * FROM runs WHERE workout_id = ?', [workout.id])
  const groups = workout.template_id
    ? await db.queryAll<TemplateGroupRow>('SELECT * FROM template_groups WHERE template_id = ?', [
        workout.template_id,
      ])
    : []
  const options = await db.queryOne<{ intensity_modifier: number; volume_modifier: number }>(
    'SELECT intensity_modifier,volume_modifier FROM workout_session_options WHERE workout_id=?',
    [workout.id],
  )
  return { workout, exercises, sets, run, groups, options }
}

async function requireActiveWorkout(db: DbAdapter, workoutId: string): Promise<void> {
  const workout = await db.queryOne<{ id: string }>(
    'SELECT id FROM workouts WHERE id=? AND ended_at IS NULL',
    [workoutId],
  )
  if (!workout) throw new Error('Session is not writable')
}
function readStartRequest(payload: Payload) {
  const now = typeof payload['now'] === 'string' ? payload['now'] : new Date().toISOString()
  const id = typeof payload['id'] === 'string' ? payload['id'] : crypto.randomUUID()
  const templateId = typeof payload['templateId'] === 'string' ? payload['templateId'] : null
  const options = (payload['options'] ?? {}) as StartOptions
  return { now, id, templateId, options, sessionType: options.sessionType ?? 'gym' }
}

async function createPlannedExercises(
  db: DbAdapter,
  workoutId: string,
  templateId: string,
  options: StartOptions,
) {
  const excluded = new Set(options.excludedExerciseIds ?? [])
  const templates = await db.queryAll<{
    exercise_id: string
    order_num: number
    superset_group: string | null
    sets_planned: number | null
    rest_seconds: number | null
  }>(
    'SELECT exercise_id,order_num,superset_group,sets_planned,rest_seconds FROM template_exercises WHERE template_id = ? ORDER BY order_num',
    [templateId],
  )
  for (const planned of templates) {
    if (excluded.has(planned.exercise_id)) continue
    const exerciseId = crypto.randomUUID()
    await db.exec(
      'INSERT INTO workout_exercises (id,workout_id,exercise_id,order_num,superset_group,rest_seconds) VALUES (?,?,?,?,?,?)',
      [
        exerciseId,
        workoutId,
        planned.exercise_id,
        planned.order_num,
        planned.superset_group,
        planned.rest_seconds ?? 120,
      ],
    )
    const count = Math.max(
      0,
      Math.round(
        (planned.sets_planned ?? 0) * (options.scale ?? 1) * (options.volumeModifier ?? 1),
      ),
    )
    for (let n = 1; n <= count; n++) {
      await db.exec(
        `INSERT INTO sets (${SET_COLUMNS}) VALUES (?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL)`,
        [crypto.randomUUID(), exerciseId, n],
      )
    }
  }
}

async function start(db: DbAdapter, payload: Payload) {
  const { now, id, templateId, options, sessionType } = readStartRequest(payload)
  const unfinished = await db.queryOne<WorkoutRow>(
    'SELECT * FROM workouts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  )
  if (unfinished)
    throw new Error('An unfinished session already exists; resume or discard it first.')
  await db.exec(
    'INSERT INTO workouts (id,date,started_at,session_type,template_id,created_at) VALUES (?,?,?,?,?,?)',
    [id, localDateString(new Date(now)), now, sessionType, templateId, now],
  )
  await db.exec(
    'INSERT INTO workout_session_options (workout_id,intensity_modifier,volume_modifier) VALUES (?,?,?)',
    [id, options.intensityModifier ?? 1, options.volumeModifier ?? 1],
  )
  if (templateId) await createPlannedExercises(db, id, templateId, options)
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
        `SELECT ${SET_COLUMNS} FROM sets WHERE workout_exercise_id = ? AND completed = 1`,
        [exercise.id],
      )),
    )
  }
  return completed
}

async function recordStrengthPRs(
  db: DbAdapter,
  workout: WorkoutRow,
  exercises: WorkoutExerciseRow[],
  completedSets: SetRow[],
): Promise<{ newPRs: PersonalRecordRow[]; strengthSets: SetRow[] }> {
  const newPRs: PersonalRecordRow[] = []
  const strengthSets: SetRow[] = []
  if (workout.session_type !== 'gym') return { newPRs, strengthSets }
  for (const exercise of exercises) {
    const exerciseSets = completedSets.filter((set) => set.workout_exercise_id === exercise.id)
    if (!exerciseSets.length) continue
    const mode = await db.queryOne<{ logging_mode: string }>(
      'SELECT logging_mode FROM exercises WHERE id=?',
      [exercise.exercise_id],
    )
    if (mode?.logging_mode !== 'strength') continue
    strengthSets.push(...exerciseSets)
    const existing = await db.queryAll<PersonalRecordRow>(
      'SELECT * FROM personal_records WHERE exercise_id = ?',
      [exercise.exercise_id],
    )
    for (const pr of detectPRs(existing, exerciseSets, exercise.exercise_id, workout.date)) {
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
  completedSets: SetRow[],
  strengthSets: SetRow[],
  newPRs: PersonalRecordRow[],
  distanceM: number,
): WorkoutSummary {
  return {
    totalSets: completedSets.filter((set) => set.is_warmup === 0).length,
    totalVolume: workout.session_type === 'gym' ? calculateWorkoutVolume(strengthSets) : 0,
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
    'SELECT * FROM workout_exercises WHERE workout_id = ?',
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
  const summary = buildWorkoutSummary(
    workout,
    endedAt,
    completedSets,
    strengthSets,
    newPRs,
    distanceM,
  )
  await db.exec('UPDATE workouts SET ended_at=?,mood_rating=?,energy_rating=?,notes=? WHERE id=?', [
    endedAt,
    opts['moodRating'] ?? null,
    opts['energyRating'] ?? null,
    opts['notes'] ?? null,
    workoutId,
  ])
  const week = isoWeek(new Date(`${workout.date}T12:00:00`))
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
  if (workout.session_type === 'run' && !run) {
    await db.exec(
      'INSERT INTO runs (id,workout_id,run_type,distance_m,duration_sec,manual_entry) VALUES (?,?,?,?,?,1)',
      [crypto.randomUUID(), workoutId, 'other', distanceM || null, runDuration || null],
    )
  }
  await db.exec('INSERT INTO workout_finish_summaries (workout_id,summary_json) VALUES (?,?)', [
    workoutId,
    JSON.stringify(summary),
  ])
  return summary
}

/** Serialized worker-side lifecycle operations for local workout writes. */
async function saveSet(db: DbAdapter, type: string, payload: Payload): Promise<SetRow> {
  const set = payload['set'] as SetRow
  const session = await db.queryOne<{ ended_at: string | null }>(
    'SELECT w.ended_at FROM workout_exercises we JOIN workouts w ON w.id=we.workout_id WHERE we.id=?',
    [set.workout_exercise_id],
  )
  if (!session || session.ended_at) throw new Error('Session is not writable')
  if (type === 'WORKOUT_UPDATE_SET') {
    const target = await db.queryOne<{ id: string }>(
      'SELECT id FROM sets WHERE id=? AND workout_exercise_id=?',
      [set.id, set.workout_exercise_id],
    )
    if (!target) throw new Error('Set is not part of the active session')
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
  const prior =
    type === 'WORKOUT_LOG_SET'
      ? await db.queryOne<{ id: string }>(
          'SELECT id FROM sets WHERE workout_exercise_id=? AND set_num=? AND is_warmup=?',
          [set.workout_exercise_id, set.set_num, set.is_warmup],
        )
      : null
  if (type === 'WORKOUT_UPDATE_SET' || prior) {
    const id = type === 'WORKOUT_UPDATE_SET' ? set.id : (prior?.id ?? set.id)
    await db.exec(
      'UPDATE sets SET set_num=?,is_warmup=?,weight_kg=?,reps=?,rpe=?,rir=?,notes=?,completed=?,logged_at=?,distance_m=?,duration_sec=?,speed_kmh=?,level=?,technique_flag=?,body_feel=?,failure_flag=?,failure_type=?,partial_reps=? WHERE id=? AND workout_exercise_id=?',
      [...binds, id, set.workout_exercise_id],
    )
    if (type === 'WORKOUT_LOG_SET' && prior) set.id = id
  } else {
    await db.exec(
      `INSERT INTO sets (${SET_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [set.id, set.workout_exercise_id, ...binds],
    )
  }
  return set
}

async function activeSession(db: DbAdapter): Promise<WorkoutSession | null> {
  const workout = await db.queryOne<WorkoutRow>(
    'SELECT * FROM workouts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  )
  return workout ? loadSession(db, workout) : null
}

async function addExercise(db: DbAdapter, payload: Payload): Promise<WorkoutExerciseRow> {
  const row = payload['exercise'] as WorkoutExerciseRow
  await requireActiveWorkout(db, row.workout_id)
  await db.exec(
    'INSERT INTO workout_exercises (id,workout_id,exercise_id,order_num,superset_group,rest_seconds) VALUES (?,?,?,?,?,?)',
    [row.id, row.workout_id, row.exercise_id, row.order_num, row.superset_group, row.rest_seconds],
  )
  return row
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
  if (workout) await db.exec('DELETE FROM workouts WHERE id=?', [id])
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
      return saveSet(db, type, payload)
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
