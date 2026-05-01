import { describe, expect, it } from 'vitest'
import {
  calculateMuscleBalance,
  checkMuscleBalance,
  findNeglectedTemplates,
  findSimilarTemplates,
} from '~/lib/template-discovery'

const NOW = new Date('2026-03-10')

function makeTemplate(id: string, lastUsedAt: string | null = null) {
  return {
    id,
    name: `Template ${id}`,
    last_used_at: lastUsedAt,
    created_at: '2026-01-01T00:00:00Z',
    use_count: 1,
  }
}

describe('findNeglectedTemplates', () => {
  it('returns templates not used within threshold', () => {
    const t1 = makeTemplate('t1', '2026-03-01') // 9 days ago
    const t2 = makeTemplate('t2', '2026-03-08') // 2 days ago
    const neglected = findNeglectedTemplates([t1, t2] as any, 7, NOW)
    expect(neglected.map((t) => t.id)).toContain('t1')
    expect(neglected.map((t) => t.id)).not.toContain('t2')
  })

  it('includes templates never used', () => {
    const t1 = makeTemplate('t1', null)
    const result = findNeglectedTemplates([t1] as any, 7, NOW)
    expect(result.map((t) => t.id)).toContain('t1')
  })
})

describe('calculateMuscleBalance', () => {
  it('counts push vs pull muscles', () => {
    const exercises = [
      {
        muscles_primary: JSON.stringify(['chest', 'anterior_deltoid', 'triceps']),
        movement: 'press',
      },
      { muscles_primary: JSON.stringify(['chest']), movement: 'press' },
      { muscles_primary: JSON.stringify(['lats', 'biceps']), movement: 'row' },
    ]
    const balance = calculateMuscleBalance(exercises as any)
    expect(balance.push).toBeGreaterThan(0)
    expect(balance.pull).toBeGreaterThan(0)
  })

  it('returns 0 for both when no exercises', () => {
    const balance = calculateMuscleBalance([])
    expect(balance.push).toBe(0)
    expect(balance.pull).toBe(0)
  })
})

describe('findSimilarTemplates', () => {
  it('finds templates with overlapping exercises', () => {
    const target = { id: 't1', exerciseIds: ['ex1', 'ex2', 'ex3'] }
    const candidates = [
      { id: 't2', exerciseIds: ['ex1', 'ex2', 'ex4'] }, // 2/4 = 0.5 Jaccard
      { id: 't3', exerciseIds: ['ex5', 'ex6', 'ex7'] }, // 0/6 = 0 Jaccard
    ]
    const result = findSimilarTemplates(target.exerciseIds, candidates, 0.4)
    expect(result.map((r) => r.id)).toContain('t2')
    expect(result.map((r) => r.id)).not.toContain('t3')
  })
})

describe('checkMuscleBalance', () => {
  it('warns when push significantly exceeds pull', () => {
    const exercises = [
      { muscles_primary: JSON.stringify(['chest']), movement: 'press' },
      { muscles_primary: JSON.stringify(['chest']), movement: 'press' },
      { muscles_primary: JSON.stringify(['chest']), movement: 'press' },
      { muscles_primary: JSON.stringify(['lats']), movement: 'row' },
    ]
    const warning = checkMuscleBalance(exercises as any)
    expect(warning).toBeTruthy()
  })

  it('returns null when balanced', () => {
    const exercises = [
      { muscles_primary: JSON.stringify(['chest']), movement: 'press' },
      { muscles_primary: JSON.stringify(['lats']), movement: 'row' },
    ]
    expect(checkMuscleBalance(exercises as any)).toBeNull()
  })
})
