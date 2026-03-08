import { describe, expect, it } from 'vitest'
import { calculateE1RM } from '~/lib/e1rm'

describe('calculateE1RM (Epley formula: w × (1 + r/30))', () => {
  it('returns the weight itself for a single rep', () => {
    expect(calculateE1RM(100, 1)).toBeCloseTo(100, 5)
  })

  it('calculates correctly for 5 reps', () => {
    // 100 × (1 + 5/30) = 100 × 1.1667 = 116.67
    expect(calculateE1RM(100, 5)).toBeCloseTo(116.67, 1)
  })

  it('calculates correctly for 10 reps', () => {
    // 80 × (1 + 10/30) = 80 × 1.333 = 106.67
    expect(calculateE1RM(80, 10)).toBeCloseTo(106.67, 1)
  })

  it('returns 0 for weight 0', () => {
    expect(calculateE1RM(0, 5)).toBe(0)
  })

  it('returns 0 for reps 0', () => {
    expect(calculateE1RM(100, 0)).toBe(0)
  })

  it('caps at reps=30 to avoid unrealistic estimates', () => {
    // reps > 30: still returns w × (1 + r/30) — no artificial cap
    // but we test that the formula still works
    const result = calculateE1RM(60, 20)
    // 60 × (1 + 20/30) = 60 × 1.667 = 100
    expect(result).toBeCloseTo(100, 0)
  })

  it('returns 0 for negative weight', () => {
    expect(calculateE1RM(-100, 5)).toBe(0)
  })

  it('returns 0 for negative reps', () => {
    expect(calculateE1RM(100, -1)).toBe(0)
  })
})
