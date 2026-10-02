import { describe, expect, it } from 'vitest'
import {
  advanceIntervalPhase,
  buildAmrap,
  buildEmom,
  buildTabata,
  calculateIntervalTotalTime,
} from '~/lib/interval-templates'

describe('buildTabata', () => {
  it('creates 8 rounds of 20s on / 10s off', () => {
    const result = buildTabata()
    expect(result.rounds).toBe(8)
    expect(result.work_sec).toBe(20)
    expect(result.rest_sec).toBe(10)
    expect(result.type).toBe('tabata')
  })
})

describe('buildEmom', () => {
  it('creates an EMOM with 10 rounds by default', () => {
    const result = buildEmom(10)
    expect(result.rounds).toBe(10)
    expect(result.work_sec).toBe(60)
    expect(result.type).toBe('emom')
  })
})

describe('buildAmrap', () => {
  it('creates an AMRAP with the given time cap', () => {
    const result = buildAmrap(300)
    expect(result.time_cap_sec).toBe(300)
    expect(result.type).toBe('amrap')
  })
})

describe('calculateIntervalTotalTime', () => {
  it('calculates total time for tabata (8 × 30s = 240s)', () => {
    const tabata = buildTabata()
    expect(calculateIntervalTotalTime(tabata)).toBe(8 * 30) // 8 × (20 + 10)
  })

  it('calculates total time for EMOM (10 × 60s = 600s)', () => {
    const emom = buildEmom(10)
    expect(calculateIntervalTotalTime(emom)).toBe(600)
  })

  it('returns time_cap_sec for AMRAP', () => {
    const amrap = buildAmrap(300)
    expect(calculateIntervalTotalTime(amrap)).toBe(300)
  })
})
describe('advanceIntervalPhase', () => {
  it('moves through work, rest, rounds, and completion without exceeding planned rounds', () => {
    const tabata = buildTabata()
    expect(advanceIntervalPhase({ phase: 'work', round: 1, remainingSeconds: 0 }, tabata)).toEqual({
      phase: 'rest',
      round: 1,
      remainingSeconds: 10,
    })
    expect(advanceIntervalPhase({ phase: 'rest', round: 1, remainingSeconds: 0 }, tabata)).toEqual({
      phase: 'work',
      round: 2,
      remainingSeconds: 20,
    })
    expect(advanceIntervalPhase({ phase: 'rest', round: 8, remainingSeconds: 0 }, tabata)).toEqual({
      phase: 'complete',
      round: 8,
      remainingSeconds: 0,
    })
  })

  it('completes an AMRAP at its time cap without creating resistance-set progression', () => {
    const amrap = buildAmrap(300)
    expect(advanceIntervalPhase({ phase: 'work', round: 1, remainingSeconds: 0 }, amrap)).toEqual({
      phase: 'complete',
      round: 1,
      remainingSeconds: 0,
    })
  })
})
