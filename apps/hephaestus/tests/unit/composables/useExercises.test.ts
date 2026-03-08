import { describe, expect, it } from 'vitest'
import { filterExercises, searchExercises, sortExercises } from '~/lib/exercise-helpers'
import type { ExerciseRow } from '~/types/database'

function makeExercise(overrides: Partial<ExerciseRow> = {}): ExerciseRow {
  return {
    id: crypto.randomUUID(),
    name: 'Barbell Squat',
    slug: 'barbell-squat',
    equipment: 'barbell',
    movement: 'squat',
    muscles: '["quads","glutes"]',
    muscles_sec: '["hamstrings","core"]',
    cues: null,
    is_custom: 0,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

const LIBRARY: ExerciseRow[] = [
  makeExercise({
    name: 'Barbell Squat',
    slug: 'barbell-squat',
    equipment: 'barbell',
    movement: 'squat',
  }),
  makeExercise({
    name: 'Dumbbell Squat',
    slug: 'dumbbell-squat',
    equipment: 'dumbbell',
    movement: 'squat',
  }),
  makeExercise({
    name: 'Bench Press',
    slug: 'bench-press',
    equipment: 'barbell',
    movement: 'press',
  }),
  makeExercise({ name: 'Pull-up', slug: 'pull-up', equipment: 'bodyweight', movement: 'row' }),
  makeExercise({ name: 'Deadlift', slug: 'deadlift', equipment: 'barbell', movement: 'hinge' }),
]

describe('searchExercises', () => {
  it('returns all when query is empty', () => {
    expect(searchExercises(LIBRARY, '')).toHaveLength(5)
  })

  it('filters by name substring (case-insensitive)', () => {
    const result = searchExercises(LIBRARY, 'squat')
    expect(result).toHaveLength(2)
    expect(result.every((e) => e.name.toLowerCase().includes('squat'))).toBe(true)
  })

  it('returns empty array when no match', () => {
    expect(searchExercises(LIBRARY, 'zxzxzx')).toHaveLength(0)
  })

  it('matches partial name', () => {
    const result = searchExercises(LIBRARY, 'bench')
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Bench Press')
  })

  it('matches slug as well', () => {
    const result = searchExercises(LIBRARY, 'pull-up')
    expect(result).toHaveLength(1)
  })
})

describe('filterExercises', () => {
  it('filters by equipment', () => {
    const result = filterExercises(LIBRARY, { equipment: 'barbell' })
    expect(result).toHaveLength(3) // squat, bench, deadlift
    expect(result.every((e) => e.equipment === 'barbell')).toBe(true)
  })

  it('filters by movement', () => {
    const result = filterExercises(LIBRARY, { movement: 'squat' })
    expect(result).toHaveLength(2)
  })

  it('combines equipment and movement filters', () => {
    const result = filterExercises(LIBRARY, { equipment: 'barbell', movement: 'squat' })
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Barbell Squat')
  })

  it('returns all when no filters', () => {
    expect(filterExercises(LIBRARY, {})).toHaveLength(5)
  })

  it('filters custom exercises', () => {
    const withCustom = [
      ...LIBRARY,
      makeExercise({ name: 'My Custom Move', slug: 'my-custom-move', is_custom: 1 }),
    ]
    const result = filterExercises(withCustom, { isCustom: true })
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('My Custom Move')
  })
})

describe('sortExercises', () => {
  it('sorts alphabetically by name', () => {
    const result = sortExercises(LIBRARY, 'name')
    expect(result[0]?.name).toBe('Barbell Squat')
    expect(result[result.length - 1]?.name).toBe('Pull-up')
  })

  it('sorts custom exercises last when mixed', () => {
    const withCustom = [
      ...LIBRARY,
      makeExercise({ name: 'Aardvark Press', slug: 'aardvark-press', is_custom: 1 }),
    ]
    const result = sortExercises(withCustom, 'custom-last')
    const firstCustomIdx = result.findIndex((e) => e.is_custom === 1)
    const lastBuiltinIdx = result.findLastIndex((e) => e.is_custom === 0)
    expect(firstCustomIdx).toBeGreaterThan(lastBuiltinIdx)
  })
})
