import { describe, expect, it } from 'vitest'
import {
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
