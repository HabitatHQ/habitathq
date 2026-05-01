import type {
  ExerciseSessionStat,
  MuscleFrequency,
  WeekDot,
  WorkoutComparison,
} from '~/lib/analytics'
import { aggregateMuscleFrequency, buildExerciseHistory, buildWeekGrid } from '~/lib/analytics'
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
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    return db.query<WorkoutRow>('SELECT * FROM workouts WHERE date >= ? ORDER BY date DESC', [
      cutoffStr,
    ])
  }

  async function dotGrid(weeks: number = 12): Promise<WeekDot[][]> {
    const today = new Date().toISOString().slice(0, 10)
    const workouts = await getRecentWorkouts(weeks * 7)
    const dates = workouts.map((w) => w.date)
    return buildWeekGrid(dates, weeks, today)
  }

  async function muscleFrequency(days: 7 | 28 | 90 = 28): Promise<MuscleFrequency[]> {
    const today = new Date().toISOString().slice(0, 10)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const [workouts, workoutExercises, exercises] = await Promise.all([
      db.query<WorkoutRow>('SELECT id, date FROM workouts WHERE date >= ? ORDER BY date DESC', [
        cutoffStr,
      ]),
      db.query<WorkoutExerciseRow>(
        'SELECT we.* FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.date >= ? AND w.ended_at IS NOT NULL',
        [cutoffStr],
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
         WHERE we.exercise_id = ?`,
        [exerciseId],
      ),
      db.query<Pick<WorkoutRow, 'id' | 'date'>>(
        `SELECT w.id, w.date FROM workouts w
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
    if (!current) {
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
       WHERE we.workout_id = ? AND s.is_warmup = 0 AND s.completed = 1`,
      [workoutId],
    )

    // Get last workout (same template if available, otherwise any previous finished workout)
    const lastWorkouts = current.template_id
      ? await db.query<WorkoutRow>(
          `SELECT * FROM workouts
           WHERE id != ? AND template_id = ? AND ended_at IS NOT NULL
           ORDER BY date DESC LIMIT 1`,
          [workoutId, current.template_id],
        )
      : await db.query<WorkoutRow>(
          `SELECT * FROM workouts
           WHERE id != ? AND ended_at IS NOT NULL
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
    const thirtyDaysAgo = new Date(current.date)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10)

    const [avgStats] = await db.query<{ avg_volume: number; avg_sets: number }>(
      `SELECT AVG(vol) AS avg_volume, AVG(cnt) AS avg_sets
       FROM (
         SELECT we.workout_id,
                COALESCE(SUM(s.weight_kg * s.reps), 0) AS vol,
                COUNT(*) AS cnt
         FROM sets s
         JOIN workout_exercises we ON we.id = s.workout_exercise_id
         JOIN workouts w ON w.id = we.workout_id
         WHERE w.date >= ? AND w.date < ? AND s.is_warmup = 0 AND s.completed = 1
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
    const today = new Date().toISOString().slice(0, 10)

    // Get recent workouts for ACWR
    const recentWorkouts = await db.query<WorkoutRow>(
      'SELECT * FROM workouts WHERE ended_at IS NOT NULL ORDER BY date DESC LIMIT 28',
    )

    // Days since last workout (999 = no history, signals "Detraining" path in calculateReadiness)
    const lastWorkout = recentWorkouts[0]
    const daysSinceLast = lastWorkout
      ? Math.floor((new Date(today).getTime() - new Date(lastWorkout.date).getTime()) / 86400000)
      : 999

    // Mood average from last 5 workouts
    const moodWorkouts = recentWorkouts.filter((w) => w.mood_rating !== null).slice(0, 5)
    const recentMoodAvg =
      moodWorkouts.length > 0
        ? moodWorkouts.reduce((sum, w) => sum + (w.mood_rating ?? 0), 0) / moodWorkouts.length
        : null

    // Compute ACWR from recent weekly volumes
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
