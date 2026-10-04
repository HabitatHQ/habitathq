import { addCalendarDays, localCalendarDate } from '@habitathq/utils'
import { describe, expect, it } from 'vitest'
import { aggregateMuscleFrequency, buildExerciseHistory, buildWeekGrid } from '~/lib/analytics'
import type { ExerciseRow, SetRow, WorkoutExerciseRow } from '~/types/database'

const REF_DATE = '2026-03-10'

describe('local calendar boundaries', () => {
  it('adds days by local calendar rather than UTC milliseconds', () => {
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('formats a Date using its local calendar fields', () => {
    expect(localCalendarDate(new Date(2026, 2, 8, 23, 30))).toBe('2026-03-08')
  })
})

describe('buildWeekGrid', () => {
  it('returns correct number of weeks', () => {
    const grid = buildWeekGrid([], 4, REF_DATE)
    expect(grid).toHaveLength(4)
  })

  it('each week has 7 days', () => {
    const grid = buildWeekGrid([], 4, REF_DATE)
    for (const week of grid) {
      expect(week).toHaveLength(7)
    }
  })

  it('marks workout dates', () => {
    const grid = buildWeekGrid(['2026-03-10'], 2, REF_DATE)
    const flat = grid.flat()
    const march10 = flat.find((d) => d.date === '2026-03-10')
    expect(march10?.hasWorkout).toBe(true)
  })

  it('non-workout dates are false', () => {
    const grid = buildWeekGrid(['2026-03-10'], 2, REF_DATE)
    const flat = grid.flat()
    const nonWorkout = flat.filter((d) => d.date !== '2026-03-10')
    for (const d of nonWorkout) {
      expect(d.hasWorkout).toBe(false)
    }
  })
})

describe('aggregateMuscleFrequency', () => {
  const workouts = [{ id: 'w1', date: '2026-03-10' }]
  const exercises: ExerciseRow[] = [
    {
      id: 'e1',
      name: 'Squat',
      slug: 'squat',
      equipment: 'barbell',
      movement: 'squat',
      muscles: '["quads","glutes"]',
      muscles_sec: '[]',
      cues: null,
      icon: null,
      is_custom: 0,
      created_at: '2026-01-01',
      logging_mode: 'strength',
    },
  ]
  const workoutExercises: WorkoutExerciseRow[] = [
    {
      id: 'we1',
      workout_id: 'w1',
      exercise_id: 'e1',
      logging_mode: 'strength',
      order_num: 1,
      superset_group: null,
      rest_seconds: 180,
    },
  ]

  it('counts muscle frequency', () => {
    const result = aggregateMuscleFrequency(workoutExercises, exercises, workouts, 30, REF_DATE)
    const quads = result.find((r) => r.muscle === 'quads')
    expect(quads?.count).toBe(1)
  })

  it('tracks lastTrained', () => {
    const result = aggregateMuscleFrequency(workoutExercises, exercises, workouts, 30, REF_DATE)
    const quads = result.find((r) => r.muscle === 'quads')
    expect(quads?.lastTrained).toBe('2026-03-10')
  })

  it('excludes workouts outside window', () => {
    const oldWorkouts = [{ id: 'w2', date: '2025-01-01' }]
    const oldWEs: WorkoutExerciseRow[] = [
      {
        id: 'we2',
        workout_id: 'w2',
        exercise_id: 'e1',
        logging_mode: 'strength',
        order_num: 1,
        superset_group: null,
        rest_seconds: 180,
      },
    ]
    const result = aggregateMuscleFrequency(oldWEs, exercises, oldWorkouts, 7, REF_DATE)
    expect(result).toHaveLength(0)
  })

  it('excludes unfinished, future, and cardio exercises from lifting frequency', () => {
    const exercise = exercises[0]
    const workoutExercise = workoutExercises[0]
    if (!exercise || !workoutExercise) throw new Error('Missing strength fixtures')
    const mixedExercises = [
      ...exercises,
      { ...exercise, id: 'cardio', logging_mode: 'cardio' as const },
    ]
    const mixedWorkouts = [
      ...workouts.map((workout) => ({ ...workout, ended_at: '2026-03-10T12:00:00Z' })),
      { id: 'unfinished', date: REF_DATE, ended_at: null },
      { id: 'future', date: '2026-03-11', ended_at: '2026-03-11T12:00:00Z' },
    ]
    const mixedRows = [
      ...workoutExercises,
      { ...workoutExercise, id: 'incomplete-we', workout_id: 'unfinished' },
      { ...workoutExercise, id: 'future-we', workout_id: 'future' },
      {
        ...workoutExercise,
        id: 'cardio-we',
        exercise_id: 'cardio',
        logging_mode: 'cardio' as const,
      },
    ]
    expect(aggregateMuscleFrequency(mixedRows, mixedExercises, mixedWorkouts, 7, REF_DATE)).toEqual(
      [
        { muscle: 'quads', count: 1, lastTrained: REF_DATE },
        { muscle: 'glutes', count: 1, lastTrained: REF_DATE },
      ],
    )
  })

  it('attributes performed lifting in mixed sessions even after reference mode changes', () => {
    const reference = exercises[0]
    if (!reference) throw new Error('Missing exercise fixture')
    expect(
      aggregateMuscleFrequency(
        workoutExercises,
        [{ ...reference, logging_mode: 'cardio' }],
        [
          {
            id: 'w1',
            date: REF_DATE,
            ended_at: `${REF_DATE}T12:00:00Z`,
            session_type: 'conditioning',
          },
        ],
        7,
        REF_DATE,
      ),
    ).toEqual([
      { muscle: 'quads', count: 1, lastTrained: REF_DATE },
      { muscle: 'glutes', count: 1, lastTrained: REF_DATE },
    ])
  })
})

describe('buildExerciseHistory', () => {
  const workouts = [{ id: 'w1', date: '2026-03-10' }]
  const workoutExercises: WorkoutExerciseRow[] = [
    {
      id: 'we1',
      workout_id: 'w1',
      exercise_id: 'e1',
      logging_mode: 'strength',
      order_num: 1,
      superset_group: null,
      rest_seconds: 180,
    },
  ]
  const sets: SetRow[] = [
    {
      id: 's1',
      workout_exercise_id: 'we1',
      set_num: 1,
      is_warmup: 0,
      weight_kg: 100,
      reps: 5,
      rpe: null,
      rir: null,
      notes: null,
      completed: 1,
      logged_at: null,
      distance_m: null,
      duration_sec: null,
      speed_kmh: null,
      level: null,
      technique_flag: null,
      body_feel: null,
    },
    {
      id: 's2',
      workout_exercise_id: 'we1',
      set_num: 2,
      is_warmup: 0,
      weight_kg: 100,
      reps: 5,
      rpe: null,
      rir: null,
      notes: null,
      completed: 1,
      logged_at: null,
      distance_m: null,
      duration_sec: null,
      speed_kmh: null,
      level: null,
      technique_flag: null,
      body_feel: null,
    },
  ]

  it('returns session stats', () => {
    const history = buildExerciseHistory('e1', workoutExercises, sets, workouts)
    expect(history).toHaveLength(1)
    expect(history[0]?.date).toBe('2026-03-10')
  })

  it('calculates volume', () => {
    const history = buildExerciseHistory('e1', workoutExercises, sets, workouts)
    expect(history[0]?.volume).toBe(1000) // 2 × 100 × 5
  })

  it('calculates max weight', () => {
    const history = buildExerciseHistory('e1', workoutExercises, sets, workouts)
    expect(history[0]?.maxWeight).toBe(100)
  })

  it('calculates total reps', () => {
    const history = buildExerciseHistory('e1', workoutExercises, sets, workouts)
    expect(history[0]?.totalReps).toBe(10)
  })

  it('calculates e1rm', () => {
    const history = buildExerciseHistory('e1', workoutExercises, sets, workouts)
    expect(history[0]?.e1rm).toBeGreaterThan(100) // Epley formula > 1RM for 5 reps
  })

  it('measures actual lifting in mixed sessions without counting non-strength rows', () => {
    const actual = workoutExercises[0]
    const set = sets[0]
    if (!actual || !set) throw new Error('Missing lifting fixture')
    expect(
      buildExerciseHistory(
        'e1',
        [...workoutExercises, { ...actual, id: 'cardio', logging_mode: 'cardio' }],
        [
          ...sets,
          { ...set, id: 'cardio-set', workout_exercise_id: 'cardio', weight_kg: 500, reps: 99 },
        ],
        [
          {
            id: 'w1',
            date: REF_DATE,
            ended_at: `${REF_DATE}T12:00:00Z`,
            session_type: 'conditioning',
          },
        ],
      ),
    ).toEqual([
      { date: REF_DATE, e1rm: 100 * (1 + 5 / 30), volume: 1000, maxWeight: 100, totalReps: 10 },
    ])
  })
})
