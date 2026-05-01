import { isoWeek, localDateString } from '~/lib/format'
import { detectPRs } from '~/lib/pr'
import { buildPendingSet, calculateWorkoutVolume } from '~/lib/workout-helpers'
import type {
  PersonalRecordRow,
  SetRow,
  TemplateGroupRow,
  WorkoutExerciseRow,
  WorkoutRow,
} from '~/types/database'

export interface WorkoutSummary {
  totalSets: number
  totalVolume: number
  newPRs: PersonalRecordRow[]
  durationSec: number
}

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

let elapsedInterval: ReturnType<typeof setInterval> | null = null
let restInterval: ReturnType<typeof setInterval> | null = null

export function useWorkout() {
  const db = useDatabase()

  async function startWorkout(templateId?: string): Promise<void> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const today = localDateString(new Date())

    await db.exec(
      `INSERT INTO workouts (id,date,started_at,session_type,template_id,created_at)
       VALUES (?,?,?,?,?,?)`,
      [id, today, now, 'gym', templateId ?? null, now],
    )

    activeWorkout.value = {
      id,
      date: today,
      started_at: now,
      ended_at: null,
      session_type: 'gym',
      training_block_id: null,
      template_id: templateId ?? null,
      mood_rating: null,
      energy_rating: null,
      notes: null,
      environment: null,
      created_at: now,
    }

    workoutExercises.value = []
    sets.value = new Map()
    templateGroups.value = new Map()
    elapsedSeconds.value = 0

    elapsedInterval = setInterval(() => {
      elapsedSeconds.value++
    }, 1000)

    // If template, load exercises
    if (templateId) {
      await loadTemplateExercises(templateId)
    }
  }

  async function loadTemplateExercises(templateId: string): Promise<void> {
    const [templateExercises, groupRows] = await Promise.all([
      db.query<{
        exercise_id: string
        order_num: number
        superset_group: string | null
        sets_planned: number | null
        rest_seconds: number
      }>('SELECT * FROM template_exercises WHERE template_id = ? ORDER BY order_num ASC', [
        templateId,
      ]),
      db.query<TemplateGroupRow>('SELECT * FROM template_groups WHERE template_id = ?', [
        templateId,
      ]),
    ])

    const groupMap = new Map<string, TemplateGroupRow>()
    for (const g of groupRows) {
      groupMap.set(g.label, g)
    }
    templateGroups.value = groupMap

    for (const te of templateExercises) {
      await addExercise(te.exercise_id, {
        orderNum: te.order_num,
        supersetGroup: te.superset_group,
        restSeconds: te.rest_seconds ?? 120,
        setsPlanned: te.sets_planned,
      })
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

    const id = crypto.randomUUID()
    const orderNum = opts.orderNum ?? workoutExercises.value.length + 1
    const restSeconds = opts.restSeconds ?? 120

    await db.exec(
      `INSERT INTO workout_exercises (id,workout_id,exercise_id,order_num,superset_group,rest_seconds)
       VALUES (?,?,?,?,?,?)`,
      [id, activeWorkout.value.id, exerciseId, orderNum, opts.supersetGroup ?? null, restSeconds],
    )

    const we: WorkoutExerciseRow = {
      id,
      workout_id: activeWorkout.value.id,
      exercise_id: exerciseId,
      order_num: orderNum,
      superset_group: opts.supersetGroup ?? null,
      rest_seconds: restSeconds,
    }
    workoutExercises.value = [...workoutExercises.value, we]

    // Pre-populate pending sets from plan
    const setsPlanned = opts.setsPlanned ?? 0
    const exerciseSets: SetRow[] = []
    for (let i = 0; i < setsPlanned; i++) {
      exerciseSets.push(buildPendingSet(id, null, i + 1))
    }
    sets.value = new Map(sets.value).set(id, exerciseSets)

    return we
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: set logging handles many field combinations
  async function logSet(workoutExerciseId: string, partial: Partial<SetRow>): Promise<SetRow> {
    const existingSets = sets.value.get(workoutExerciseId) ?? []
    const pendingIdx = existingSets.findIndex((s) => s.completed === 0)

    const setNum =
      pendingIdx >= 0
        ? (existingSets[pendingIdx]?.set_num ?? existingSets.length + 1)
        : existingSets.length + 1

    const set: SetRow = {
      id: crypto.randomUUID(),
      workout_exercise_id: workoutExerciseId,
      set_num: setNum,
      is_warmup: 0,
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

    await db.exec(
      `INSERT INTO sets
       (id,workout_exercise_id,set_num,is_warmup,weight_kg,reps,rpe,rir,notes,completed,logged_at,
        distance_m,duration_sec,speed_kmh,level,technique_flag,body_feel,failure_flag,failure_type,partial_reps)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        set.id,
        set.workout_exercise_id,
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
      ],
    )

    // Update in-memory: replace pending slot or append
    const updated = [...existingSets]
    if (pendingIdx >= 0) {
      updated[pendingIdx] = set
    } else {
      updated.push(set)
    }
    // Add next pending set
    const nextNum = updated.filter((s) => s.completed === 1).length + 1
    updated.push(buildPendingSet(workoutExerciseId, set, nextNum))
    sets.value = new Map(sets.value).set(workoutExerciseId, updated)

    // Start rest timer — superset groups use transition/round rest; solo exercises use rest_seconds
    const we = workoutExercises.value.find((e) => e.id === workoutExerciseId)
    if (we && !set.is_warmup) {
      const group = we.superset_group ? templateGroups.value.get(we.superset_group) : null
      if (group) {
        const groupExercises = workoutExercises.value.filter(
          (e) => e.superset_group === we.superset_group,
        )
        const completedCounts = groupExercises.map(
          (e) => (sets.value.get(e.id) ?? []).filter((s) => s.completed === 1).length,
        )
        const minCount = Math.min(...completedCounts)
        const roundComplete = minCount > 0 && completedCounts.every((c) => c === minCount)
        const restSecs = roundComplete ? group.rest_after_round_sec : group.transition_rest_sec
        if (restSecs > 0) startRestTimer(restSecs, workoutExerciseId)
      } else {
        startRestTimer(we.rest_seconds, workoutExerciseId)
      }
    }

    return set
  }

  function startRestTimer(seconds: number, exerciseId: string) {
    if (restInterval) clearInterval(restInterval)
    restTimer.value = { active: true, remaining: seconds, total: seconds, exerciseId }
    restInterval = setInterval(() => {
      restTimer.value.remaining--
      if (restTimer.value.remaining <= 0) {
        stopRestTimer()
      }
    }, 1000)
  }

  function stopRestTimer() {
    if (restInterval) {
      clearInterval(restInterval)
      restInterval = null
    }
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
      // Start a new timer for the last logged exercise
      const lastWe = workoutExercises.value[workoutExercises.value.length - 1]
      if (lastWe) startRestTimer(seconds, lastWe.id)
    }
  }

  async function finishWorkout(
    opts: { moodRating?: number; energyRating?: number; notes?: string } = {},
  ): Promise<WorkoutSummary> {
    if (!activeWorkout.value) throw new Error('No active workout')

    if (elapsedInterval) {
      clearInterval(elapsedInterval)
      elapsedInterval = null
    }
    stopRestTimer()

    const endedAt = new Date().toISOString()
    await db.exec('UPDATE workouts SET ended_at=? WHERE id=?', [endedAt, activeWorkout.value.id])

    if (
      opts.moodRating !== undefined ||
      opts.energyRating !== undefined ||
      opts.notes !== undefined
    ) {
      await db.exec('UPDATE workouts SET mood_rating=?, energy_rating=?, notes=? WHERE id=?', [
        opts.moodRating ?? null,
        opts.energyRating ?? null,
        opts.notes ?? null,
        activeWorkout.value.id,
      ])
    }

    // Collect all sets
    const allSets = [...sets.value.values()].flat().filter((s) => s.completed === 1)

    // Detect PRs per exercise
    const newPRs: PersonalRecordRow[] = []
    for (const we of workoutExercises.value) {
      const exerciseSets = (sets.value.get(we.id) ?? []).filter((s) => s.completed === 1)
      if (exerciseSets.length === 0) continue

      const existingPRs = await db.query<PersonalRecordRow>(
        'SELECT * FROM personal_records WHERE exercise_id = ?',
        [we.exercise_id],
      )
      const detected = detectPRs(existingPRs, exerciseSets, we.exercise_id, endedAt.slice(0, 10))

      for (const pr of detected) {
        await db.exec(
          `INSERT OR REPLACE INTO personal_records (id,exercise_id,record_type,value,set_id,date)
           VALUES (?,?,?,?,?,?)`,
          [pr.id, pr.exercise_id, pr.record_type, pr.value, pr.set_id, pr.date],
        )
        newPRs.push(pr)
      }
    }

    const started = new Date(activeWorkout.value.started_at).getTime()
    const ended = new Date(endedAt).getTime()
    const totalVolume = calculateWorkoutVolume(allSets)
    const totalSets = allSets.filter((s) => s.is_warmup === 0).length
    const summary: WorkoutSummary = {
      totalSets,
      totalVolume,
      newPRs,
      durationSec: Math.round((ended - started) / 1000),
    }

    // Update weekly_training_load for this workout's week
    const week = isoWeek(new Date(endedAt))
    await db.exec(
      `INSERT INTO weekly_training_load (week, gym_volume, gym_sets)
       VALUES (?, ?, ?)
       ON CONFLICT(week) DO UPDATE SET
         gym_volume = COALESCE(gym_volume, 0) + excluded.gym_volume,
         gym_sets   = COALESCE(gym_sets, 0)   + excluded.gym_sets`,
      [week, totalVolume, totalSets],
    )

    activeWorkout.value = null
    workoutExercises.value = []
    sets.value = new Map()
    templateGroups.value = new Map()

    return summary
  }

  return {
    activeWorkout: readonly(activeWorkout),
    workoutExercises: readonly(workoutExercises),
    sets: readonly(sets),
    templateGroups: readonly(templateGroups),
    elapsedSeconds: readonly(elapsedSeconds),
    restTimer: readonly(restTimer),
    startWorkout,
    addExercise,
    logSet,
    finishWorkout,
    stopRestTimer,
    addRestTime,
  }
}
