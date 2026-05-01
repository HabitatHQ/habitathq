import { describe, expect, it } from 'vitest'
import { BUILTIN_PROGRAMS, calculateProgramWeek, getTodaysProgramDays } from '~/lib/programs'

describe('calculateProgramWeek', () => {
  it('returns week 1 on day 0', () => {
    const start = new Date('2026-03-01')
    const ref = new Date('2026-03-01')
    expect(calculateProgramWeek(start, ref)).toBe(1)
  })

  it('returns week 2 after 7 days', () => {
    const start = new Date('2026-03-01')
    const ref = new Date('2026-03-08')
    expect(calculateProgramWeek(start, ref)).toBe(2)
  })

  it('returns week 3 after 14 days', () => {
    const start = new Date('2026-03-01')
    const ref = new Date('2026-03-15')
    expect(calculateProgramWeek(start, ref)).toBe(3)
  })
})

describe('getTodaysProgramDays', () => {
  it("returns days matching today's day number", () => {
    // Tuesday = 2
    const today = new Date('2026-03-10')
    const days = [
      { id: 'd1', week_id: 'w1', day_num: 2, template_id: 't1', label: 'Squat A' },
      { id: 'd2', week_id: 'w1', day_num: 4, template_id: 't2', label: 'Press A' },
    ]
    const result = getTodaysProgramDays(days, today)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('d1')
  })

  it('returns empty array when no days match', () => {
    const today = new Date('2026-03-10') // Tuesday
    const days = [{ id: 'd1', week_id: 'w1', day_num: 1, template_id: null, label: null }]
    expect(getTodaysProgramDays(days, today)).toHaveLength(0)
  })
})

describe('BUILTIN_PROGRAMS', () => {
  it('includes 5 builtin programs', () => {
    expect(BUILTIN_PROGRAMS.length).toBeGreaterThanOrEqual(5)
  })

  it('each program has a name and weeks', () => {
    for (const p of BUILTIN_PROGRAMS) {
      expect(p.name).toBeTruthy()
      expect(p.weeks).toBeGreaterThan(0)
    }
  })
})
