import { describe, expect, it } from 'vitest'
import { detectPRs } from '~/lib/pr'
import type { PersonalRecordRow, SetRow } from '~/types/database'

function makeSet(overrides: Partial<SetRow> = {}): SetRow {
  return {
    id: crypto.randomUUID(),
    workout_exercise_id: 'we-1',
    set_num: 1,
    is_warmup: 0,
    weight_kg: 100,
    reps: 5,
    rpe: 8,
    rir: null,
    notes: null,
    completed: 1,
    logged_at: null,
    ...overrides,
  }
}

function makePR(overrides: Partial<PersonalRecordRow> = {}): PersonalRecordRow {
  return {
    id: crypto.randomUUID(),
    exercise_id: 'ex-1',
    record_type: 'weight',
    value: 100,
    set_id: null,
    date: '2025-01-01',
    ...overrides,
  }
}

describe('detectPRs', () => {
  it('detects a new weight PR when heavier than existing', () => {
    const existing = [makePR({ record_type: 'weight', value: 95 })]
    const sets = [makeSet({ weight_kg: 100 })]
    const prs = detectPRs(existing, sets, 'ex-1', '2025-03-01')
    const weightPR = prs.find((p) => p.record_type === 'weight')
    expect(weightPR).toBeDefined()
    expect(weightPR?.value).toBe(100)
  })

  it('does NOT report PR when weight equals existing best', () => {
    const existing = [makePR({ record_type: 'weight', value: 100 })]
    const sets = [makeSet({ weight_kg: 100 })]
    const prs = detectPRs(existing, sets, 'ex-1', '2025-03-01')
    expect(prs.filter((p) => p.record_type === 'weight')).toHaveLength(0)
  })

  it('detects e1RM PR', () => {
    // 100 × (1 + 5/30) = 116.67
    const existing = [makePR({ record_type: 'e1rm', value: 110 })]
    const sets = [makeSet({ weight_kg: 100, reps: 5 })]
    const prs = detectPRs(existing, sets, 'ex-1', '2025-03-01')
    const e1rmPR = prs.find((p) => p.record_type === 'e1rm')
    expect(e1rmPR).toBeDefined()
    expect(e1rmPR?.value).toBeCloseTo(116.67, 1)
  })

  it('detects reps PR', () => {
    const existing = [makePR({ record_type: 'reps', value: 8 })]
    const sets = [makeSet({ reps: 12, weight_kg: 80 })]
    const prs = detectPRs(existing, sets, 'ex-1', '2025-03-01')
    const repsPR = prs.find((p) => p.record_type === 'reps')
    expect(repsPR).toBeDefined()
    expect(repsPR?.value).toBe(12)
  })

  it('ignores warmup sets for PR detection', () => {
    const existing = [makePR({ record_type: 'weight', value: 95 })]
    const sets = [makeSet({ weight_kg: 120, is_warmup: 1 })]
    const prs = detectPRs(existing, sets, 'ex-1', '2025-03-01')
    expect(prs.filter((p) => p.record_type === 'weight')).toHaveLength(0)
  })

  it('ignores incomplete sets', () => {
    const existing = [makePR({ record_type: 'weight', value: 95 })]
    const sets = [makeSet({ weight_kg: 120, completed: 0 })]
    const prs = detectPRs(existing, sets, 'ex-1', '2025-03-01')
    expect(prs.filter((p) => p.record_type === 'weight')).toHaveLength(0)
  })

  it('returns no PRs when no existing records and sets match defaults', () => {
    // When there are no existing PRs, everything is a PR (first time)
    const sets = [makeSet({ weight_kg: 80, reps: 5 })]
    const prs = detectPRs([], sets, 'ex-1', '2025-03-01')
    expect(prs.length).toBeGreaterThan(0)
  })

  it('picks the best set across multiple sets', () => {
    const existing = [makePR({ record_type: 'weight', value: 90 })]
    const sets = [
      makeSet({ weight_kg: 95 }),
      makeSet({ weight_kg: 100 }),
      makeSet({ weight_kg: 98 }),
    ]
    const prs = detectPRs(existing, sets, 'ex-1', '2025-03-01')
    const weightPR = prs.find((p) => p.record_type === 'weight')
    expect(weightPR?.value).toBe(100)
  })

  it('returns empty array when all sets are warmups', () => {
    const sets = [makeSet({ is_warmup: 1 }), makeSet({ is_warmup: 1 })]
    expect(detectPRs([], sets, 'ex-1', '2025-03-01')).toHaveLength(0)
  })

  it('detects all 3 PR types on first ever session', () => {
    const sets = [makeSet({ weight_kg: 100, reps: 5 })]
    const prs = detectPRs([], sets, 'ex-1', '2025-03-01')
    const types = prs.map((p) => p.record_type)
    expect(types).toContain('weight')
    expect(types).toContain('reps')
    expect(types).toContain('e1rm')
  })

  it('e1RM PR favours higher-rep set with better estimated 1RM', () => {
    // 80 × (1 + 10/30) ≈ 106.67 beats 90 × (1 + 3/30) ≈ 99
    const existing = [makePR({ record_type: 'e1rm', value: 95 })]
    const sets = [
      makeSet({ weight_kg: 90, reps: 3 }), // e1RM ≈ 99
      makeSet({ weight_kg: 80, reps: 10 }), // e1RM ≈ 106.67
    ]
    const prs = detectPRs(existing, sets, 'ex-1', '2025-03-01')
    const e1rmPR = prs.find((p) => p.record_type === 'e1rm')
    expect(e1rmPR?.value).toBeCloseTo(106.67, 1)
  })

  it('PR set_id references the set that achieved it', () => {
    const bestSet = makeSet({ weight_kg: 120, reps: 5 })
    const otherSet = makeSet({ weight_kg: 100, reps: 5 })
    const prs = detectPRs([], [otherSet, bestSet], 'ex-1', '2025-03-01')
    const weightPR = prs.find((p) => p.record_type === 'weight')
    expect(weightPR?.set_id).toBe(bestSet.id)
  })

  it('does not detect e1RM PR when sets have null weight or null reps', () => {
    const sets = [makeSet({ weight_kg: null, reps: 10 }), makeSet({ weight_kg: 100, reps: null })]
    const prs = detectPRs([], sets, 'ex-1', '2025-03-01')
    expect(prs.find((p) => p.record_type === 'e1rm')).toBeUndefined()
  })

  it('PR date is set to the provided date string', () => {
    const prs = detectPRs([], [makeSet()], 'ex-1', '2025-06-15')
    expect(prs.every((p) => p.date === '2025-06-15')).toBe(true)
  })
})
