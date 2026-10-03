import { buildPendingSet } from '~/lib/workout-helpers'
import type { WorkoutSession, WorkoutSetIntent, WorkoutSummary } from '~/lib/workout-storage'
import type {
  RunRow,
  SessionType,
  SetRow,
  TemplateGroupRow,
  WorkoutExerciseRow,
  WorkoutRow,
} from '~/types/database'
import type { RoutineInputValue, SerializablePrescription } from '~/types/prescription'

const activeWorkout = ref<WorkoutRow | null>(null)
const workoutExercises = ref<WorkoutExerciseRow[]>([])
const sets = ref<Map<string, SetRow[]>>(new Map())
const templateGroups = ref<Map<string, TemplateGroupRow>>(new Map())
const setIntents = ref<Record<string, WorkoutSetIntent>>({})
const activityIntents = ref<WorkoutSession['activityIntents']>({})
const skippedSetIds = ref<Set<string>>(new Set())
const prescription = ref<SerializablePrescription | null>(null)
const routine = ref<WorkoutSession['routine']>(null)
const lastFinishedWorkoutId = ref<string | null>(null)
const elapsedSeconds = ref(0)
const restTimer = ref<{
  active: boolean
  remaining: number
  total: number
  exerciseId: string | null
  setId: string | null
}>({
  active: false,
  remaining: 0,
  total: 0,
  exerciseId: null,
  setId: null,
})
const recoverySession = ref(false)
const writerUnavailable = ref(false)
const runData = ref<RunRow | null>(null)
let elapsedInterval: number | null = null
const sessionIntensityModifier = ref(1)
const sessionVolumeModifier = ref(1)

function stopElapsedClock() {
  window.clearInterval(elapsedInterval ?? undefined)
  elapsedInterval = null
  document.removeEventListener('visibilitychange', syncElapsed)
  window.removeEventListener('focus', syncElapsed)
}
let restInterval: number | null = null

function syncElapsed() {
  if (!activeWorkout.value) return
  elapsedSeconds.value = Math.max(
    0,
    Math.floor((Date.now() - new Date(activeWorkout.value.started_at).getTime()) / 1000),
  )
}

function startElapsedClock() {
  stopElapsedClock()
  syncElapsed()
  document.addEventListener('visibilitychange', syncElapsed)
  window.addEventListener('focus', syncElapsed)
  elapsedInterval = window.setInterval(syncElapsed, 1000)
}

function installSession(data: WorkoutSession) {
  activeWorkout.value = data.workout
  workoutExercises.value = data.exercises
  templateGroups.value = new Map(data.groups.map((group) => [group.label, group]))
  runData.value = data.run
  sessionIntensityModifier.value = data.options?.intensity_modifier ?? 1
  sessionVolumeModifier.value = data.options?.volume_modifier ?? 1
  setIntents.value = data.setIntents
  activityIntents.value = data.activityIntents
  skippedSetIds.value = new Set(data.skippedSetIds)
  prescription.value = data.prescription
  routine.value = data.routine
  const byExercise = new Map<string, SetRow[]>()
  for (const exercise of data.exercises) {
    const exerciseSets = data.sets.filter((set) => set.workout_exercise_id === exercise.id)
    if (!exerciseSets.some((set) => set.completed === 0 && !skippedSetIds.value.has(set.id))) {
      const lastCompleted = [...exerciseSets].reverse().find((set) => set.completed === 1) ?? null
      const nextSetNum = exerciseSets.reduce((max, set) => Math.max(max, set.set_num), 0) + 1
      exerciseSets.push(buildPendingSet(exercise.id, lastCompleted, nextSetNum))
    }
    byExercise.set(exercise.id, exerciseSets)
  }
  sets.value = byExercise
  startElapsedClock()
}

type RunMetric =
  | 'distance_m'
  | 'duration_sec'
  | 'avg_pace_sec_km'
  | 'avg_hr'
  | 'max_hr'
  | 'elevation_gain_m'
  | 'avg_cadence'
  | 'avg_power_w'

function mergeRunMetric(
  current: RunRow | null,
  partial: Partial<RunRow>,
  metric: RunMetric,
): number | null {
  if (partial[metric] !== undefined) return partial[metric]
  if (current?.[metric] !== undefined && current[metric] !== null) return current[metric]
  return null
}

function buildRunRow(workoutId: string, current: RunRow | null, partial: Partial<RunRow>): RunRow {
  return {
    id: current?.id ?? crypto.randomUUID(),
    workout_id: workoutId,
    run_type: partial.run_type ?? current?.run_type ?? 'easy',
    distance_m: mergeRunMetric(current, partial, 'distance_m'),
    duration_sec: mergeRunMetric(current, partial, 'duration_sec'),
    avg_pace_sec_km: mergeRunMetric(current, partial, 'avg_pace_sec_km'),
    avg_hr: mergeRunMetric(current, partial, 'avg_hr'),
    max_hr: mergeRunMetric(current, partial, 'max_hr'),
    elevation_gain_m: mergeRunMetric(current, partial, 'elevation_gain_m'),
    avg_cadence: mergeRunMetric(current, partial, 'avg_cadence'),
    avg_power_w: mergeRunMetric(current, partial, 'avg_power_w'),
    manual_entry: 1,
  }
}

export function useWorkout() {
  const db = useDatabase()
  const hasActiveWorkout = computed(() => activeWorkout.value !== null)
  async function loadProgressionHistory(exerciseId: string): Promise<{
    completedSessions: SetRow[][]
    lastWeightKg: number | null
    targetRpe: number
    incrementKg: number
  }> {
    const rows = await db.query<SetRow & { workout_id: string }>(
      `SELECT s.*, w.id AS workout_id
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       WHERE we.exercise_id = ? AND we.logging_mode = 'strength' AND w.ended_at IS NOT NULL AND s.completed = 1 AND s.is_warmup = 0 AND we.removed_at IS NULL AND s.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workout_set_skips WHERE set_id=s.id)
       ORDER BY w.ended_at DESC, s.set_num ASC`,
      [exerciseId],
    )
    const completedSessions: SetRow[][] = []
    let workoutId: string | null = null
    for (const row of rows) {
      if (row.workout_id !== workoutId) {
        completedSessions.push([])
        workoutId = row.workout_id
      }
      completedSessions[completedSessions.length - 1]?.push(row)
    }
    const latest = completedSessions[0] ?? []
    const lastWeightKg =
      [...latest].reverse().find((set) => set.weight_kg != null)?.weight_kg ?? null
    const target = activeWorkout.value?.template_id
      ? await db.query<{ rpe_target: number | null; increment_kg: number | null }>(
          'SELECT rpe_target, increment_kg FROM template_exercises WHERE template_id=? AND exercise_id=? LIMIT 1',
          [activeWorkout.value.template_id, exerciseId],
        )
      : []
    return {
      completedSessions,
      lastWeightKg,
      targetRpe: target[0]?.rpe_target ?? 8,
      incrementKg: target[0]?.increment_kg ?? 2.5,
    }
  }

  async function hydrateActiveWorkout(): Promise<boolean> {
    try {
      const data = await db.workout('WORKOUT_ACTIVE', {})
      writerUnavailable.value = false
      if (!data) {
        stopElapsedClock()
        activeWorkout.value = null
        workoutExercises.value = []
        sets.value = new Map()
        templateGroups.value = new Map()
        setIntents.value = {}
        activityIntents.value = {}
        skippedSetIds.value = new Set()
        prescription.value = null
        routine.value = null
        runData.value = null
        recoverySession.value = false
        sessionIntensityModifier.value = 1
        sessionVolumeModifier.value = 1
        setIntents.value = {}
        skippedSetIds.value = new Set()
        prescription.value = null
        routine.value = null
        return false
      }
      const requiresResume = activeWorkout.value?.id !== data.workout.id || recoverySession.value
      installSession(data)
      recoverySession.value = requiresResume
      return true
    } catch (error) {
      writerUnavailable.value = db.status.value === 'lock_unavailable'
      throw error
    }
  }

  async function resumeWorkout(): Promise<void> {
    recoverySession.value = false
    startElapsedClock()
    restoreRestTimer()
  }

  async function discardWorkout(): Promise<void> {
    if (!activeWorkout.value) return
    await db.workout('WORKOUT_DISCARD', { workoutId: activeWorkout.value.id })
    stopElapsedClock()
    stopRestTimer()
    activeWorkout.value = null
    workoutExercises.value = []
    setIntents.value = {}
    activityIntents.value = {}
    skippedSetIds.value = new Set()
    prescription.value = null
    routine.value = null
    sets.value = new Map()
    runData.value = null
    await hydrateActiveWorkout()
  }

  async function startWorkout(
    templateId?: string,
    options: {
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
    } = {},
    routineId?: string,
  ): Promise<void> {
    if (activeWorkout.value) throw new Error('An active workout already exists')
    try {
      const data = await db.workout('WORKOUT_START', {
        id: crypto.randomUUID(),
        now: new Date().toISOString(),
        templateId: templateId ?? null,
        routineId: routineId ?? null,
        options: {
          ...options,
          ...(options.inputs === undefined ? {} : { inputs: { ...options.inputs } }),
          ...(options.fixedTargetValues === undefined
            ? {}
            : { fixedTargetValues: { ...options.fixedTargetValues } }),
        },
      })
      installSession(data)
      recoverySession.value = false
      writerUnavailable.value = false
      templateGroups.value = new Map(data.groups.map((group) => [group.label, group]))
    } catch (error) {
      writerUnavailable.value = db.status.value === 'lock_unavailable'
      throw error
    }
  }

  async function startRoutineWorkout(
    routineId: string,
    options: {
      sessionType?: SessionType
      intensityModifier?: number
      volumeModifier?: number
      expectedRoutineRevisionId?: string
      appointmentId?: string
      rotationId?: string
      rotationGeneration?: number
    } = {},
  ): Promise<void> {
    if (!routineId.trim()) throw new Error('Routine identity is required')
    await startWorkout(undefined, options, routineId)
  }

  async function addExercise(
    exerciseId: string,
    opts: {
      orderNum?: number
      supersetGroup?: string | null
      restSeconds?: number
      setsPlanned?: number | null
    } = {},
  ): Promise<WorkoutExerciseRow> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const row: Omit<WorkoutExerciseRow, 'logging_mode'> = {
      id: crypto.randomUUID(),
      workout_id: activeWorkout.value.id,
      exercise_id: exerciseId,
      order_num: opts.orderNum ?? workoutExercises.value.length + 1,
      superset_group: opts.supersetGroup ?? null,
      rest_seconds: opts.restSeconds ?? 120,
    }
    const planned = Math.max(0, opts.setsPlanned ?? 0)
    const pending = Array.from({ length: planned }, (_, index) =>
      buildPendingSet(row.id, null, index + 1),
    )
    if (!pending.length) pending.push(buildPendingSet(row.id, null, 1))
    const saved = await db.workout('WORKOUT_ADD_EXERCISE', { exercise: row, pendingSets: pending })
    workoutExercises.value = [...workoutExercises.value, saved]
    sets.value = new Map(sets.value).set(row.id, pending)
    return saved
  }

  async function createPendingSet(workoutExerciseId: string): Promise<SetRow> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const current = sets.value.get(workoutExerciseId) ?? []
    const pending = current.find((set) => set.completed === 0 && !skippedSetIds.value.has(set.id))
    if (pending) return pending
    const previous = [...current].reverse().find((set) => set.completed === 1) ?? null
    const draft = buildPendingSet(workoutExerciseId, previous, nextSetNumber(current))
    const committed = await db.workout('WORKOUT_SAVE_DRAFT', { set: draft })
    sets.value = new Map(sets.value).set(workoutExerciseId, [...current, committed])
    return committed
  }

  async function logSet(workoutExerciseId: string, partial: Partial<SetRow>): Promise<SetRow> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const current = sets.value.get(workoutExerciseId) ?? []
    const pendingIdx = current.findIndex(
      (set) => set.completed === 0 && !skippedSetIds.value.has(set.id),
    )
    const setNum =
      pendingIdx >= 0
        ? (current[pendingIdx]?.set_num ?? nextSetNumber(current))
        : nextSetNumber(current)
    const set: SetRow = {
      id: pendingIdx >= 0 ? (current[pendingIdx]?.id ?? crypto.randomUUID()) : crypto.randomUUID(),
      workout_exercise_id: workoutExerciseId,
      set_num: setNum,
      is_warmup: partial.is_warmup ?? 0,
      weight_kg: null,
      reps: null,
      rpe: null,
      rir: null,
      notes: null,
      completed: 1,
      logged_at: new Date().toISOString(),
      distance_m: null,
      duration_sec: null,
      speed_kmh: null,
      level: null,
      technique_flag: null,
      body_feel: null,
      failure_flag: 0,
      failure_type: null,
      partial_reps: null,
      ...partial,
    }
    const committed = await db.workout('WORKOUT_LOG_SET', { set })
    replaceSetInState(workoutExerciseId, pendingIdx, committed)
    startRestForSet(workoutExerciseId, committed)
    return committed
  }

  async function completeSet(setId: string, partial: Partial<SetRow> = {}): Promise<SetRow> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const entry = findSet(setId)
    if (entry.set.completed) throw new Error('This set is already completed')
    const workoutExercise = workoutExercises.value.find(
      (exercise) => exercise.id === entry.exerciseId,
    )
    const set: SetRow = {
      ...entry.set,
      ...partial,
      id: entry.set.id,
      workout_exercise_id: entry.exerciseId,
      set_num: entry.set.set_num,
      completed: 1,
      logged_at: new Date().toISOString(),
    }
    if (
      workoutExercise?.logging_mode === 'strength' &&
      (set.reps === null || (set.reps < 1 && !set.failure_flag))
    )
      throw new Error('Enter achieved reps before completing this set.')
    const committed = await db.workout('WORKOUT_LOG_SET', { set })
    replaceSetInState(entry.exerciseId, entry.index, committed)
    startRestForSet(entry.exerciseId, committed)
    return committed
  }

  async function updateSet(setId: string, partial: Partial<SetRow>): Promise<SetRow> {
    const entry = [...sets.value.entries()]
      .flatMap(([exerciseId, values]) =>
        values.map((set, index) => ({ exerciseId, values, index, set })),
      )
      .find((item) => item.set.id === setId)
    if (!entry || !activeWorkout.value) throw new Error('Set is not part of the active session')
    if (entry.set.completed === 0)
      throw new Error('A pending set must be saved as a draft or completed explicitly.')
    const committed = await db.workout('WORKOUT_UPDATE_SET', {
      set: { ...entry.set, ...partial, id: setId },
    })
    const next = [...entry.values]
    next[entry.index] = committed
    sets.value = new Map(sets.value).set(entry.exerciseId, next)
    return committed
  }

  function findSet(setId: string) {
    for (const [exerciseId, values] of sets.value) {
      const index = values.findIndex((set) => set.id === setId)
      const set = values[index]
      if (set) return { exerciseId, values, index, set }
    }
    throw new Error('Set is not part of the active session')
  }

  async function saveDraft(setId: string, partial: Partial<SetRow> = {}): Promise<SetRow> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const entry = findSet(setId)
    if (entry.set.completed) throw new Error('A completed set cannot be edited as a draft')
    const committed = await db.workout('WORKOUT_SAVE_DRAFT', {
      set: {
        ...entry.set,
        ...partial,
        id: entry.set.id,
        workout_exercise_id: entry.exerciseId,
        set_num: entry.set.set_num,
        completed: 0,
        logged_at: null,
      },
    })
    const next = [...(sets.value.get(entry.exerciseId) ?? [])]
    const index = next.findIndex((set) => set.id === entry.set.id)
    if (index >= 0) next[index] = committed
    sets.value = new Map(sets.value).set(entry.exerciseId, next)
    return committed
  }

  async function undoSet(setId: string): Promise<void> {
    const entry = findSet(setId)
    const committed = await db.workout('WORKOUT_UNDO_SET', { setId })
    const next = [...(sets.value.get(entry.exerciseId) ?? [])]
    next[entry.index] = committed
    sets.value = new Map(sets.value).set(entry.exerciseId, next)
    if (restTimer.value.setId === setId) stopRestTimer()
  }

  async function skipSet(setId: string, skipped: boolean): Promise<void> {
    const entry = findSet(setId)
    const committed = await db.workout('WORKOUT_SKIP_SET', { set: { ...entry.set }, skipped })
    const current = [...(sets.value.get(entry.exerciseId) ?? [])]
    current[entry.index] = committed
    const nextSkipped = new Set(skippedSetIds.value)
    if (skipped) nextSkipped.add(committed.id)
    else nextSkipped.delete(committed.id)
    skippedSetIds.value = nextSkipped
    if (!current.some((set) => set.completed === 0 && !nextSkipped.has(set.id))) {
      current.push(buildPendingSet(entry.exerciseId, null, nextSetNumber(current)))
    }
    sets.value = new Map(sets.value).set(entry.exerciseId, current)
  }

  function nextSetNumber(current: SetRow[]): number {
    return current.reduce((max, set) => Math.max(max, set.set_num), 0) + 1
  }

  function replaceSetInState(workoutExerciseId: string, pendingIdx: number, set: SetRow) {
    const updated = [...(sets.value.get(workoutExerciseId) ?? [])]
    if (pendingIdx >= 0) updated[pendingIdx] = set
    else updated.push(set)
    if (!updated.some((item) => item.completed === 0 && !skippedSetIds.value.has(item.id))) {
      updated.push(buildPendingSet(workoutExerciseId, set, nextSetNumber(updated)))
    }
    sets.value = new Map(sets.value).set(workoutExerciseId, updated)
  }

  async function saveRunData(partial: Partial<RunRow>): Promise<void> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const run = buildRunRow(activeWorkout.value.id, runData.value, partial)
    runData.value = await db.workout('WORKOUT_RUN_DATA', { run })
  }

  function restSecondsForSet(workoutExerciseId: string, set: SetRow): number {
    const we = workoutExercises.value.find((exercise) => exercise.id === workoutExerciseId)
    if (!we || set.is_warmup) return 0
    const group = we.superset_group ? templateGroups.value.get(we.superset_group) : null
    if (!group) return setIntents.value[set.id]?.restSec ?? we.rest_seconds
    if (group.group_type === 'circuit' && group.circuit_rest_mode === 'after_each')
      return group.rest_after_round_sec
    const groupExercises = workoutExercises.value.filter(
      (exercise) => exercise.superset_group === we.superset_group,
    )
    const counts = groupExercises.map(
      (exercise) =>
        (sets.value.get(exercise.id) ?? []).filter(
          (item) =>
            item.is_warmup === 0 && (item.completed === 1 || skippedSetIds.value.has(item.id)),
        ).length,
    )
    const minimum = Math.min(...counts)
    const complete = minimum > 0 && counts.every((count) => count === minimum)
    return complete ? group.rest_after_round_sec : group.transition_rest_sec
  }

  function startRestForSet(workoutExerciseId: string, set: SetRow) {
    if (set.is_warmup) return
    stopRestTimer()
    const seconds = restSecondsForSet(workoutExerciseId, set)
    if (seconds > 0) startRestTimer(seconds, workoutExerciseId, set.id)
  }

  function restoreRestTimer() {
    const completed = [...sets.value.values()]
      .flat()
      .filter((set) => set.completed === 1 && set.is_warmup === 0 && set.logged_at !== null)
      .sort((a, b) => (b.logged_at ?? '').localeCompare(a.logged_at ?? ''))
    const last = completed[0]
    if (!last?.logged_at) return
    const seconds = restSecondsForSet(last.workout_exercise_id, last)
    const elapsed = Math.floor((Date.now() - new Date(last.logged_at).getTime()) / 1000)
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < seconds) {
      startRestTimer(seconds - elapsed, last.workout_exercise_id, last.id)
      restTimer.value.total = seconds
    }
  }

  function startRestTimer(seconds: number, exerciseId: string, setId: string | null = null) {
    window.clearInterval(restInterval ?? undefined)
    restTimer.value = { active: true, remaining: seconds, total: seconds, exerciseId, setId }
    restInterval = window.setInterval(() => {
      restTimer.value.remaining--
      if (restTimer.value.remaining <= 0) stopRestTimer()
    }, 1000)
  }

  function stopRestTimer() {
    window.clearInterval(restInterval ?? undefined)
    restInterval = null
    restTimer.value = { active: false, remaining: 0, total: 0, exerciseId: null, setId: null }
  }

  function addRestTime(seconds: number) {
    if (restTimer.value.active) {
      restTimer.value = {
        ...restTimer.value,
        remaining: restTimer.value.remaining + seconds,
        total: restTimer.value.total + seconds,
      }
    } else {
      const last = workoutExercises.value[workoutExercises.value.length - 1]
      if (last) startRestTimer(seconds, last.id)
    }
  }

  async function finishWorkout(
    opts: { moodRating?: number; energyRating?: number; notes?: string } = {},
  ): Promise<WorkoutSummary> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const finishedId = activeWorkout.value.id
    const summary = await db.workout('WORKOUT_FINISH', {
      workoutId: activeWorkout.value.id,
      endedAt: new Date().toISOString(),
      options: opts,
    })
    lastFinishedWorkoutId.value = finishedId
    stopElapsedClock()
    stopRestTimer()
    activeWorkout.value = null
    workoutExercises.value = []
    sets.value = new Map()
    templateGroups.value = new Map()
    runData.value = null
    setIntents.value = {}
    activityIntents.value = {}
    skippedSetIds.value = new Set()
    prescription.value = null
    routine.value = null
    sessionIntensityModifier.value = 1
    sessionVolumeModifier.value = 1
    return summary
  }

  return {
    activeWorkout: readonly(activeWorkout),
    hasActiveWorkout,
    workoutExercises: readonly(workoutExercises),
    sets: readonly(sets),
    templateGroups: readonly(templateGroups),
    setIntents: readonly(setIntents),
    activityIntents: readonly(activityIntents),
    skippedSetIds: readonly(skippedSetIds),
    prescription: readonly(prescription),
    routine: readonly(routine),
    lastFinishedWorkoutId: readonly(lastFinishedWorkoutId),
    elapsedSeconds: readonly(elapsedSeconds),
    restTimer: readonly(restTimer),
    recoverySession: readonly(recoverySession),
    writerUnavailable: readonly(writerUnavailable),
    runData: readonly(runData),
    sessionIntensityModifier: readonly(sessionIntensityModifier),
    sessionVolumeModifier: readonly(sessionVolumeModifier),
    hydrateActiveWorkout,
    resumeWorkout,
    discardWorkout,
    startWorkout,
    startRoutineWorkout,
    addExercise,
    logSet,
    updateSet,
    completeSet,
    saveDraft,
    undoSet,
    skipSet,
    saveRunData,
    createPendingSet,
    loadProgressionHistory,
    finishWorkout,
    stopRestTimer,
    addRestTime,
  }
}
