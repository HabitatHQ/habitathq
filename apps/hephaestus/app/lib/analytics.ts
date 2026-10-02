import type { ExerciseRow, SetRow, WorkoutExerciseRow, WorkoutRow } from '~/types/database'
import { calculateE1RM } from './e1rm'
/** Return an ISO calendar date in the local timezone; YYYY-MM-DD is parsed as local. */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Add calendar days without converting through UTC. */
export function addCalendarDays(dateKey: string, days: number): string {
  const date = parseCalendarDate(dateKey)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}
function parseCalendarDate(dateKey: string): Date {
  return new Date(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(5, 7)) - 1,
    Number(dateKey.slice(8, 10)),
  )
}

export interface WeeklyVolumeStat {
  week: string // ISO week label e.g. '2026-W10'
  volume: number // total tonnage (kg × reps)
  sets: number // number of working sets
}

export interface WeekDot {
  date: string // YYYY-MM-DD
  hasWorkout: boolean
}

export interface MuscleFrequency {
  muscle: string
  count: number
  lastTrained: string | null
}

export interface WorkoutComparison {
  vs30dAvg: {
    duration: number | null
    volume: number | null
    sets: number | null
  }
  vsLast: {
    duration: number | null
    volume: number | null
    sets: number | null
  }
}

export interface ExerciseSessionStat {
  date: string
  e1rm: number | null
  volume: number
  maxWeight: number | null
  totalReps: number
}

/**
 * Build a 2D grid of weekly dots for a training calendar.
 * Returns weeks × 7 days, oldest first.
 */
export function buildWeekGrid(
  workoutDates: string[],
  weeks: number,
  referenceDate: string,
): WeekDot[][] {
  const refDate = parseCalendarDate(referenceDate)
  // Align to Monday of current week
  const dayOfWeek = (refDate.getDay() + 6) % 7 // 0=Mon, 6=Sun
  const startDate = new Date(refDate)
  startDate.setDate(startDate.getDate() - dayOfWeek - (weeks - 1) * 7)

  const dateSet = new Set(workoutDates.filter((date) => date <= referenceDate))
  const grid: WeekDot[][] = []

  for (let w = 0; w < weeks; w++) {
    const week: WeekDot[] = []
    for (let d = 0; d < 7; d++) {
      const current = new Date(startDate)
      current.setDate(startDate.getDate() + w * 7 + d)
      const dateStr = localDateKey(current)
      week.push({ date: dateStr, hasWorkout: dateSet.has(dateStr) })
    }
    grid.push(week)
  }

  return grid
}

/**
 * Aggregate muscle training frequency over a time window.
 */
export function aggregateMuscleFrequency(
  workoutExercises: WorkoutExerciseRow[],
  exercises: ExerciseRow[],
  workouts: Array<
    Pick<WorkoutRow, 'id' | 'date'> & Partial<Pick<WorkoutRow, 'ended_at' | 'session_type'>>
  >,
  days: number,
  referenceDate: string,
): MuscleFrequency[] {
  const cutoffStr = addCalendarDays(referenceDate, -days)

  const workoutDateMap = new Map(
    workouts
      .filter(
        (w) =>
          (w.ended_at === undefined || w.ended_at !== null) &&
          (w.session_type === undefined || w.session_type === 'gym'),
      )
      .map((w) => [w.id, w.date]),
  )
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]))

  const muscleFreq = new Map<string, { count: number; lastTrained: string | null }>()

  for (const we of workoutExercises) {
    const workoutDate = workoutDateMap.get(we.workout_id)
    if (!workoutDate || workoutDate < cutoffStr || workoutDate > referenceDate) continue
    const exercise = exerciseMap.get(we.exercise_id)
    if (!exercise || exercise.logging_mode !== 'strength') continue

    let muscles: string[] = []
    try {
      muscles = JSON.parse(exercise.muscles) as string[]
    } catch {
      muscles = []
    }

    for (const muscle of muscles) {
      const existing = muscleFreq.get(muscle)
      if (existing) {
        existing.count++
        if (!existing.lastTrained || workoutDate > existing.lastTrained) {
          existing.lastTrained = workoutDate
        }
      } else {
        muscleFreq.set(muscle, { count: 1, lastTrained: workoutDate })
      }
    }
  }

  return Array.from(muscleFreq.entries())
    .map(([muscle, data]) => ({ muscle, ...data }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Build per-session stats for a given exercise.
 */
export function buildExerciseHistory(
  exerciseId: string,
  workoutExercises: WorkoutExerciseRow[],
  sets: SetRow[],
  workouts: Array<
    Pick<WorkoutRow, 'id' | 'date'> & Partial<Pick<WorkoutRow, 'ended_at' | 'session_type'>>
  >,
): ExerciseSessionStat[] {
  const workoutDateMap = new Map(
    workouts
      .filter(
        (w) =>
          (w.ended_at === undefined || w.ended_at !== null) &&
          (w.session_type === undefined || w.session_type === 'gym'),
      )
      .map((w) => [w.id, w.date]),
  )
  const relevantWEs = workoutExercises.filter((we) => we.exercise_id === exerciseId)
  const weIds = new Set(relevantWEs.map((we) => we.id))

  const byWorkout = new Map<string, SetRow[]>()
  for (const s of sets) {
    if (!weIds.has(s.workout_exercise_id)) continue
    const we = relevantWEs.find((w) => w.id === s.workout_exercise_id)
    if (!we) continue
    const existing = byWorkout.get(we.workout_id) ?? []
    existing.push(s)
    byWorkout.set(we.workout_id, existing)
  }

  const stats: ExerciseSessionStat[] = []
  for (const [workoutId, weSets] of byWorkout) {
    const date = workoutDateMap.get(workoutId)
    if (!date) continue
    const workingSets = weSets.filter((s) => s.is_warmup === 0 && s.completed === 1)
    const volume = workingSets.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)
    const maxWeight = workingSets.reduce<number | null>((max, s) => {
      if (s.weight_kg === null) return max
      return max === null ? s.weight_kg : Math.max(max, s.weight_kg)
    }, null)
    const totalReps = workingSets.reduce((sum, s) => sum + (s.reps ?? 0), 0)
    const e1rmValues = workingSets
      .filter((s) => s.weight_kg !== null && s.reps !== null)
      .map((s) => calculateE1RM(s.weight_kg as number, s.reps as number))
    const e1rm = e1rmValues.length > 0 ? Math.max(...e1rmValues) : null
    stats.push({ date, e1rm, volume, maxWeight, totalReps })
  }

  return stats.sort((a, b) => a.date.localeCompare(b.date))
}
