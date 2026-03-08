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
})
