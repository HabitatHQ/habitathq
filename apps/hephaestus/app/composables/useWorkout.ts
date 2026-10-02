import { buildPendingSet } from '~/lib/workout-helpers'
import type { WorkoutSession, WorkoutSummary } from '~/lib/workout-storage'
import type {
  RunRow,
  SessionType,
  SetRow,
  TemplateGroupRow,
  WorkoutExerciseRow,
  WorkoutRow,
} from '~/types/database'

const activeWorkout = ref<WorkoutRow | null>(null)
const workoutExercises = ref<WorkoutExerciseRow[]>([])
const sets = ref<Map<string, SetRow[]>>(new Map())
const templateGroups = ref<Map<string, TemplateGroupRow>>(new Map())
const elapsedSeconds = ref(0)
const restTimer = ref<{
  active: boolean
  remaining: number
  total: number
  exerciseId: string | null
}>({
  active: false,
  remaining: 0,
  total: 0,
  exerciseId: null,
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
  const byExercise = new Map<string, SetRow[]>()
  for (const exercise of data.exercises) {
    const exerciseSets = data.sets.filter((set) => set.workout_exercise_id === exercise.id)
    if (!exerciseSets.some((set) => set.completed === 0)) {
      exerciseSets.push(
        buildPendingSet(
          exercise.id,
          [...exerciseSets].reverse().find((set) => set.completed === 1) ?? null,
          exerciseSets.filter((set) => set.completed === 1).length + 1,
        ),
      )
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
       WHERE we.exercise_id = ? AND w.ended_at IS NOT NULL AND s.completed = 1 AND s.is_warmup = 0
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
      const data = await db.workout<WorkoutSession | null>('WORKOUT_ACTIVE')
      writerUnavailable.value = false
      if (!data) {
        stopElapsedClock()
        activeWorkout.value = null
        workoutExercises.value = []
        sets.value = new Map()
        templateGroups.value = new Map()
        runData.value = null
        recoverySession.value = false
        sessionIntensityModifier.value = 1
        sessionVolumeModifier.value = 1
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
  }

  async function discardWorkout(): Promise<void> {
    if (!activeWorkout.value) return
    await db.workout('WORKOUT_DISCARD', { workoutId: activeWorkout.value.id })
    stopElapsedClock()
    stopRestTimer()
    activeWorkout.value = null
    workoutExercises.value = []
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
    } = {},
  ): Promise<void> {
    if (activeWorkout.value) throw new Error('An active workout already exists')
    try {
      const data = await db.workout<WorkoutSession>('WORKOUT_START', {
        id: crypto.randomUUID(),
        now: new Date().toISOString(),
        templateId: templateId ?? null,
        options,
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
    const row: WorkoutExerciseRow = {
      id: crypto.randomUUID(),
      workout_id: activeWorkout.value.id,
      exercise_id: exerciseId,
      order_num: opts.orderNum ?? workoutExercises.value.length + 1,
      superset_group: opts.supersetGroup ?? null,
      rest_seconds: opts.restSeconds ?? 120,
    }
    await db.workout('WORKOUT_ADD_EXERCISE', { exercise: row })
    workoutExercises.value = [...workoutExercises.value, row]
    const planned = Math.max(0, opts.setsPlanned ?? 0)
    const pending = Array.from({ length: planned }, (_, index) =>
      buildPendingSet(row.id, null, index + 1),
    )
    if (!pending.length) pending.push(buildPendingSet(row.id, null, 1))
    sets.value = new Map(sets.value).set(row.id, pending)
    return row
  }

  async function logSet(workoutExerciseId: string, partial: Partial<SetRow>): Promise<SetRow> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const current = sets.value.get(workoutExerciseId) ?? []
    const pendingIdx = current.findIndex((set) => set.completed === 0)
    const setNum =
      pendingIdx >= 0 ? (current[pendingIdx]?.set_num ?? current.length + 1) : current.length + 1
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
    const committed = await db.workout<SetRow>('WORKOUT_LOG_SET', { set })
    replaceSetInState(workoutExerciseId, pendingIdx, committed)
    startRestForSet(workoutExerciseId, committed)
    return committed
  }

  async function updateSet(setId: string, partial: Partial<SetRow>): Promise<SetRow> {
    const entry = [...sets.value.entries()]
      .flatMap(([exerciseId, values]) =>
        values.map((set, index) => ({ exerciseId, values, index, set })),
      )
      .find((item) => item.set.id === setId)
    if (!entry || !activeWorkout.value) throw new Error('Set is not part of the active session')
    const committed = await db.workout<SetRow>('WORKOUT_UPDATE_SET', {
      set: { ...entry.set, ...partial, id: setId },
    })
    const next = [...entry.values]
    next[entry.index] = committed
    sets.value = new Map(sets.value).set(entry.exerciseId, next)
    return committed
  }

  function replaceSetInState(workoutExerciseId: string, pendingIdx: number, set: SetRow) {
    const updated = [...(sets.value.get(workoutExerciseId) ?? [])]
    if (pendingIdx >= 0) updated[pendingIdx] = set
    else updated.push(set)
    if (!updated.some((item) => item.completed === 0)) {
      const nextNum = updated.filter((item) => item.completed === 1).length + 1
      updated.push(buildPendingSet(workoutExerciseId, set, nextNum))
    }
    sets.value = new Map(sets.value).set(workoutExerciseId, updated)
  }

  async function saveRunData(partial: Partial<RunRow>): Promise<void> {
    if (!activeWorkout.value) throw new Error('No active workout')
    const run = buildRunRow(activeWorkout.value.id, runData.value, partial)
    runData.value = await db.workout<RunRow>('WORKOUT_RUN_DATA', { run })
  }

  function startRestForSet(workoutExerciseId: string, set: SetRow) {
    const we = workoutExercises.value.find((exercise) => exercise.id === workoutExerciseId)
    if (!we || set.is_warmup) return
    const group = we.superset_group ? templateGroups.value.get(we.superset_group) : null
    if (group) {
      const groupExercises = workoutExercises.value.filter(
        (exercise) => exercise.superset_group === we.superset_group,
      )
      const counts = groupExercises.map(
        (exercise) =>
          (sets.value.get(exercise.id) ?? []).filter((item) => item.completed === 1).length,
      )
      const minimum = Math.min(...counts)
      const complete = minimum > 0 && counts.every((count) => count === minimum)
      const seconds = complete ? group.rest_after_round_sec : group.transition_rest_sec
      if (seconds > 0) startRestTimer(seconds, workoutExerciseId)
    } else startRestTimer(we.rest_seconds, workoutExerciseId)
  }

  function startRestTimer(seconds: number, exerciseId: string) {
    window.clearInterval(restInterval ?? undefined)
    restTimer.value = { active: true, remaining: seconds, total: seconds, exerciseId }
    restInterval = window.setInterval(() => {
      restTimer.value.remaining--
      if (restTimer.value.remaining <= 0) stopRestTimer()
    }, 1000)
  }

  function stopRestTimer() {
    window.clearInterval(restInterval ?? undefined)
    restInterval = null
    restTimer.value = { active: false, remaining: 0, total: 0, exerciseId: null }
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
    const summary = await db.workout<WorkoutSummary>('WORKOUT_FINISH', {
      workoutId: activeWorkout.value.id,
      endedAt: new Date().toISOString(),
      options: opts,
    })
    stopElapsedClock()
    stopRestTimer()
    activeWorkout.value = null
    workoutExercises.value = []
    sets.value = new Map()
    templateGroups.value = new Map()
    runData.value = null
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
    addExercise,
    logSet,
    updateSet,
    saveRunData,
    loadProgressionHistory,
    finishWorkout,
    stopRestTimer,
    addRestTime,
  }
}
