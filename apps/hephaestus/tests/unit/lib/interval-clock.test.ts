import { describe, expect, it } from 'vitest'
import {
  intervalElapsedSeconds,
  intervalProgressAt,
  parseIntervalConfiguration,
} from '~/lib/interval-clock'
import { buildAmrap, buildEmom, buildTabata } from '~/lib/interval-templates'

const start = {
  phase: 'work',
  round: 1,
  phase_deadline_ms: 20000,
  paused_remaining_sec: null,
} as const

describe('durable interval clock', () => {
  it('catches up across multiple phases after suspension instead of counting callbacks', () => {
    expect(intervalProgressAt(start, buildTabata(), 65000)).toEqual({
      phase: 'work',
      round: 3,
      phase_deadline_ms: 80000,
      paused_remaining_sec: null,
    })
    expect(intervalElapsedSeconds(start, buildTabata(), 65000)).toBe(65)
  })

  it('keeps the final rest and completes exactly at the training deadline', () => {
    expect(intervalProgressAt(start, buildTabata(), 239999)).toMatchObject({
      phase: 'rest',
      round: 8,
    })
    expect(intervalProgressAt(start, buildTabata(), 240000)).toEqual({
      phase: 'complete',
      round: 8,
      phase_deadline_ms: null,
      paused_remaining_sec: null,
    })
    expect(intervalElapsedSeconds(start, buildTabata(), 999999999)).toBe(240)
  })

  it('freezes during a pause and excludes the break after a resumed deadline', () => {
    const paused = {
      phase: 'work',
      round: 3,
      phase_deadline_ms: null,
      paused_remaining_sec: 15,
    } as const
    expect(intervalProgressAt(paused, buildTabata(), 200000)).toEqual(paused)
    expect(intervalElapsedSeconds(paused, buildTabata(), 200000)).toBe(65)
    const resumed = { ...paused, paused_remaining_sec: null, phase_deadline_ms: 215000 }
    expect(intervalElapsedSeconds(resumed, buildTabata(), 200000)).toBe(65)
    expect(intervalProgressAt(resumed, buildTabata(), 216000)).toMatchObject({
      phase: 'rest',
      round: 3,
    })
    expect(intervalElapsedSeconds(resumed, buildTabata(), 216000)).toBe(81)
  })

  it('advances zero-rest rounds and one-phase AMRAP caps', () => {
    expect(
      intervalProgressAt({ ...start, phase_deadline_ms: 60000 }, buildEmom(3), 120000),
    ).toMatchObject({ phase: 'work', round: 3, phase_deadline_ms: 180000 })
    expect(
      intervalProgressAt({ ...start, phase_deadline_ms: 120000 }, buildAmrap(120), 120000),
    ).toMatchObject({ phase: 'complete', round: 1 })
  })

  it.each([
    null,
    { ...buildTabata(), rounds: 0 },
    { ...buildTabata(), work_sec: 0 },
    { ...buildTabata(), rest_sec: Number.POSITIVE_INFINITY },
    { ...buildTabata(), rounds: Number.MAX_SAFE_INTEGER },
  ])('rejects unusable configuration snapshots: %j', (value) => {
    expect(() => parseIntervalConfiguration(value)).toThrow()
  })
})
