import type {
  ExerciseSessionStat,
  MuscleFrequency,
  WeekDot,
  WorkoutComparison,
} from '~/lib/analytics'
import {
  addCalendarDays,
  aggregateMuscleFrequency,
  buildExerciseHistory,
  buildWeekGrid,
  localDateKey,
} from '~/lib/analytics'
import type { ReadinessResult } from '~/lib/readiness'
import { calculateReadiness } from '~/lib/readiness'
import { calculateAcuteLoad, calculateChronicLoad, getLoadRatio } from '~/lib/training-load'
import type {
  ExerciseRow,
  PersonalRecordRow,
  SetRow,
  WorkoutExerciseRow,
  WorkoutRow,
} from '~/types/database'

export function useProgress() {
  const db = useDatabase()

  async function getRecentWorkouts(days: number): Promise<WorkoutRow[]> {
    const cutoff = addCalendarDays(localDateKey(), -days)
    return db.query<WorkoutRow>(
      'SELECT * FROM workouts WHERE ended_at IS NOT NULL AND date >= ? AND date <= ? ORDER BY date DESC',
      [cutoff, localDateKey()],
    )
  }

  async function dotGrid(weeks: number = 12): Promise<WeekDot[][]> {
    const today = localDateKey()
    const workouts = await getRecentWorkouts(weeks * 7)
    return buildWeekGrid(
      workouts.map((w) => w.date),
      weeks,
      today,
    )
  }

  async function muscleFrequency(days: 7 | 28 | 90 = 28): Promise<MuscleFrequency[]> {
    const today = localDateKey()
    const cutoff = addCalendarDays(today, -days)
    const [workouts, workoutExercises, exercises] = await Promise.all([
      db.query<Pick<WorkoutRow, 'id' | 'date' | 'ended_at'>>(
        'SELECT id, date, ended_at FROM workouts WHERE ended_at IS NOT NULL AND date >= ? AND date <= ?',
        [cutoff, today],
      ),
      db.query<WorkoutExerciseRow>(
        'SELECT we.* FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.ended_at IS NOT NULL AND w.date >= ? AND w.date <= ?',
        [cutoff, today],
      ),
      db.query<ExerciseRow>('SELECT * FROM exercises'),
    ])
    return aggregateMuscleFrequency(workoutExercises, exercises, workouts, days, today)
  }

  async function exerciseHistory(exerciseId: string): Promise<ExerciseSessionStat[]> {
    const [workoutExercises, sets, workouts] = await Promise.all([
      db.query<WorkoutExerciseRow>(
        'SELECT we.* FROM workout_exercises we WHERE we.exercise_id = ?',
        [exerciseId],
      ),
      db.query<SetRow>(
        `SELECT s.* FROM sets s
         JOIN workout_exercises we ON we.id = s.workout_exercise_id
         JOIN workouts w ON w.id = we.workout_id
         WHERE we.exercise_id = ? AND w.ended_at IS NOT NULL`,
        [exerciseId],
      ),
      db.query<Pick<WorkoutRow, 'id' | 'date' | 'ended_at' | 'session_type'>>(
        `SELECT w.id, w.date, w.ended_at, w.session_type FROM workouts w
         JOIN workout_exercises we ON we.workout_id = w.id
         WHERE we.exercise_id = ? AND w.ended_at IS NOT NULL
         GROUP BY w.id`,
        [exerciseId],
      ),
    ])
    return buildExerciseHistory(exerciseId, workoutExercises, sets, workouts)
  }
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: comparison logic aggregates many metrics
  async function workoutComparison(workoutId: string): Promise<WorkoutComparison> {
    // Get current workout
    const [current] = await db.query<WorkoutRow>('SELECT * FROM workouts WHERE id = ?', [workoutId])
    if (!current || current.ended_at === null || current.session_type !== 'gym') {
      return {
        vs30dAvg: { duration: null, volume: null, sets: null },
        vsLast: { duration: null, volume: null, sets: null },
      }
    }

    // Get volume + sets for current workout
    const [currentStats] = await db.query<{ volume: number; sets: number }>(
      `SELECT COALESCE(SUM(s.weight_kg * s.reps), 0) AS volume, COUNT(*) AS sets
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN exercises e ON e.id = we.exercise_id AND e.logging_mode = 'strength'
       WHERE we.workout_id = ? AND s.is_warmup = 0 AND s.completed = 1`,
      [workoutId],
    )

    // Get last workout (same template if available, otherwise any previous finished workout)
    const lastWorkouts = current.template_id
      ? await db.query<WorkoutRow>(
          `SELECT * FROM workouts
           WHERE id != ? AND template_id = ? AND ended_at IS NOT NULL AND session_type = 'gym' ORDER BY date DESC LIMIT 1`,
          [workoutId, current.template_id],
        )
      : await db.query<WorkoutRow>(
          `SELECT * FROM workouts
           WHERE id != ? AND ended_at IS NOT NULL AND session_type = 'gym'
           ORDER BY date DESC LIMIT 1`,
          [workoutId],
        )
    const lastWorkout = lastWorkouts[0] ?? null

    let vsLast: WorkoutComparison['vsLast'] = { duration: null, volume: null, sets: null }
    if (lastWorkout) {
      const [lastStats] = await db.query<{ volume: number; sets: number }>(
        `SELECT COALESCE(SUM(s.weight_kg * s.reps), 0) AS volume, COUNT(*) AS sets
         FROM sets s
         JOIN workout_exercises we ON we.id = s.workout_exercise_id
         JOIN exercises e ON e.id = we.exercise_id AND e.logging_mode = 'strength'
         WHERE we.workout_id = ? AND s.is_warmup = 0 AND s.completed = 1`,
        [lastWorkout.id],
      )
      const currentDuration = current.ended_at
        ? (new Date(current.ended_at).getTime() - new Date(current.started_at).getTime()) / 60000
        : null
      const lastDuration = lastWorkout.ended_at
        ? (new Date(lastWorkout.ended_at).getTime() - new Date(lastWorkout.started_at).getTime()) /
          60000
        : null
      vsLast = {
        duration:
          currentDuration !== null && lastDuration !== null ? currentDuration - lastDuration : null,
        volume: (currentStats?.volume ?? 0) - (lastStats?.volume ?? 0),
        sets: (currentStats?.sets ?? 0) - (lastStats?.sets ?? 0),
      }
    }

    // 30-day average
    const thirtyDaysAgoStr = addCalendarDays(current.date, -30)

    const [avgStats] = await db.query<{ avg_volume: number; avg_sets: number }>(
      `SELECT AVG(vol) AS avg_volume, AVG(cnt) AS avg_sets
       FROM (
         SELECT we.workout_id,
                COALESCE(SUM(s.weight_kg * s.reps), 0) AS vol,
                COUNT(*) AS cnt
         FROM sets s
         JOIN workout_exercises we ON we.id = s.workout_exercise_id
         JOIN workouts w ON w.id = we.workout_id
         WHERE w.date >= ? AND w.date < ? AND w.ended_at IS NOT NULL
           AND w.session_type = 'gym' AND s.is_warmup = 0 AND s.completed = 1
         GROUP BY we.workout_id
       )`,
      [thirtyDaysAgoStr, current.date],
    )

    const vs30dAvg: WorkoutComparison['vs30dAvg'] = {
      duration: null, // Complex to avg duration without more data
      volume: avgStats ? (currentStats?.volume ?? 0) - avgStats.avg_volume : null,
      sets: avgStats ? (currentStats?.sets ?? 0) - avgStats.avg_sets : null,
    }

    return { vs30dAvg, vsLast }
  }

  async function readinessData(): Promise<ReadinessResult> {
    const today = localDateKey()
    const recentWorkouts = await db.query<WorkoutRow>(
      "SELECT * FROM workouts WHERE ended_at IS NOT NULL AND date <= ? AND session_type = 'gym' ORDER BY date DESC LIMIT 28",
      [today],
    )

    const lastWorkout = recentWorkouts[0]
    const daysSinceLast = lastWorkout
      ? Math.floor(
          (new Date(`${today}T00:00:00`).getTime() -
            new Date(`${lastWorkout.date}T00:00:00`).getTime()) /
            86400000,
        )
      : 999

    const moodWorkouts = recentWorkouts.filter((w) => w.mood_rating !== null).slice(0, 5)
    const recentMoodAvg =
      moodWorkouts.length > 0
        ? moodWorkouts.reduce((sum, w) => sum + (w.mood_rating ?? 0), 0) / moodWorkouts.length
        : null

    const loadRows = await db.query<{ gym_volume: number | null }>(
      'SELECT gym_volume FROM weekly_training_load ORDER BY week DESC LIMIT 4',
    )
    const volumes = loadRows.map((r) => r.gym_volume ?? 0).reverse()
    const acute = calculateAcuteLoad(volumes)
    const chronic = calculateChronicLoad(volumes)
    const acwr = getLoadRatio(acute, chronic)
    return calculateReadiness(acwr, daysSinceLast, recentMoodAvg)
  }
  async function weeklyVolume(
    weeks: number = 8,
  ): Promise<{ week: string; volume: number; sets: number }[]> {
    const rows = await db.query<{
      week: string
      gym_volume: number | null
      gym_sets: number | null
    }>('SELECT week, gym_volume, gym_sets FROM weekly_training_load ORDER BY week DESC LIMIT ?', [
      weeks,
    ])
    return rows
      .map((r) => ({
        week: r.week,
        volume: r.gym_volume ?? 0,
        sets: r.gym_sets ?? 0,
      }))
      .reverse()
  }

  async function recentPRs(exerciseId?: string): Promise<PersonalRecordRow[]> {
    if (exerciseId) {
      return db.query<PersonalRecordRow>(
        'SELECT * FROM personal_records WHERE exercise_id = ? ORDER BY date DESC LIMIT 10',
        [exerciseId],
      )
    }
    return db.query<PersonalRecordRow>('SELECT * FROM personal_records ORDER BY date DESC LIMIT 20')
  }

  return {
    dotGrid,
    muscleFrequency,
    exerciseHistory,
    workoutComparison,
    readinessData,
    weeklyVolume,
    recentPRs,
  }
}
