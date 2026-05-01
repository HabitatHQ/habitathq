import { describe, expect, it } from 'vitest'
import { calculateConsistency, estimateTemplateDuration, scaleWeight } from '~/lib/template-stats'

describe('calculateConsistency', () => {
  it('returns 100 for perfect weekly usage', () => {
    const refDate = new Date('2026-03-10')
    const dates = ['2026-03-10', '2026-03-03', '2026-02-24', '2026-02-17']
    expect(calculateConsistency(dates, 28, refDate)).toBe(100)
  })

  it('returns 0 when no sessions in window', () => {
    const refDate = new Date('2026-03-10')
    expect(calculateConsistency([], 28, refDate)).toBe(0)
  })

  it('returns 50 for 2 out of 4 weeks', () => {
    const refDate = new Date('2026-03-10')
    const dates = ['2026-03-10', '2026-02-24']
    expect(calculateConsistency(dates, 28, refDate)).toBe(50)
  })

  it('caps at 100 even with more sessions than expected', () => {
    const refDate = new Date('2026-03-10')
    const dates = [
      '2026-03-10',
      '2026-03-08',
      '2026-03-03',
      '2026-03-01',
      '2026-02-24',
      '2026-02-22',
    ]
    expect(calculateConsistency(dates, 28, refDate)).toBe(100)
  })
})

describe('estimateTemplateDuration', () => {
  it('calculates (sets × 45s) + totalRest + warmup buffer', () => {
    // 3 exercises × 3 sets = 9 sets; 9 × 45 = 405s; rest = 9 × 120 = 1080; warmup = 300
    expect(estimateTemplateDuration(3, 9, 120)).toBe(405 + 1080 + 300)
  })

  it('returns 0 for 0 sets', () => {
    expect(estimateTemplateDuration(0, 0, 120)).toBe(0)
  })

  it('adds warmup buffer when exerciseCount > 0', () => {
    const base = estimateTemplateDuration(2, 6, 120)
    expect(base).toBeGreaterThan(6 * 45)
  })
})

describe('scaleWeight', () => {
  it('rounds to nearest 2.5', () => {
    expect(scaleWeight(100, 0.8)).toBe(80)
    expect(scaleWeight(100, 0.85)).toBe(85)
  })

  it('rounds down to nearest 2.5 when not exact', () => {
    // 100 × 0.77 = 77 → rounds to 77.5
    expect(scaleWeight(100, 0.77)).toBe(77.5)
  })

  it('handles 0 weight', () => {
    expect(scaleWeight(0, 1.0)).toBe(0)
  })
})
