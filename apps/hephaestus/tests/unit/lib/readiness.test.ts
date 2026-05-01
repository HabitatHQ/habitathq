import { describe, expect, it } from 'vitest'
import { calculateReadiness } from '~/lib/readiness'

describe('calculateReadiness', () => {
  it('returns moderate with no data (acwr=0, days=0)', () => {
    const r = calculateReadiness(0, 0, null)
    expect(r.score).toBe(0)
    expect(r.label).toBe('Moderate')
  })

  it('returns High for optimal acwr + 1 rest day + good mood', () => {
    const r = calculateReadiness(0.9, 1, 4)
    expect(r.label).toBe('High')
    expect(r.score).toBeGreaterThanOrEqual(75)
  })

  it('returns Low for acwr > 1.5', () => {
    const r = calculateReadiness(1.8, 0, null)
    expect(r.label).toBe('Low')
  })

  it('returns Detraining for > 7 days since last workout', () => {
    const r = calculateReadiness(0.5, 8, null)
    expect(r.label).toBe('Detraining')
  })

  it('penalises bad mood', () => {
    const base = calculateReadiness(1.0, 0, null)
    const badMood = calculateReadiness(1.0, 0, 2)
    expect(badMood.score).toBeLessThan(base.score)
  })

  it('boosts good mood', () => {
    const base = calculateReadiness(1.0, 0, null)
    const goodMood = calculateReadiness(1.0, 0, 4)
    expect(goodMood.score).toBeGreaterThan(base.score)
  })

  it('score is clamped 0-100', () => {
    const r = calculateReadiness(3.0, 10, 1)
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
  })

  it('returns description string', () => {
    const r = calculateReadiness(1.0, 1, 4)
    expect(typeof r.description).toBe('string')
    expect(r.description.length).toBeGreaterThan(0)
  })
})
