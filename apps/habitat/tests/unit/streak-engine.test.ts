import { describe, it, expect } from 'vitest'
import {
  computeStreak,
  isStruggling,
  recentCompletionRate,
  type StreakInput,
} from '~/lib/streak-engine'

// ─── Test helpers ──────────────────────────────────────────────────────────────

/** Inclusive list of consecutive YYYY-MM-DD dates (UTC). */
function range(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

function dailyBoolean(over: Partial<StreakInput> = {}): StreakInput {
  return {
    type: 'BOOLEAN',
    target: 1,
    schedule: { type: 'DAILY', startDate: '2024-01-11' },
    completions: new Set(),
    sums: new Map(),
    today: '2024-01-15',
    ...over,
  }
}

// ─── DAILY · BOOLEAN ────────────────────────────────────────────────────────────

describe('computeStreak — daily boolean', () => {
  it('counts a clean consecutive streak including today', () => {
    const r = computeStreak(
      dailyBoolean({ completions: new Set(range('2024-01-11', '2024-01-15')) }),
    )
    expect(r).toEqual({ current: 5, longest: 5, status: 'active', saved: 0 })
  })

  it('does not penalize today if it is not done yet', () => {
    // done through yesterday; today (15th) still open
    const r = computeStreak(
      dailyBoolean({ completions: new Set(range('2024-01-11', '2024-01-14')) }),
    )
    expect(r.current).toBe(4)
    expect(r.status).toBe('active')
  })

  it('goes at-risk after a single missed scheduled day', () => {
    // 11,12,13 done; 14 missed; today 15 open
    const r = computeStreak(
      dailyBoolean({ completions: new Set(['2024-01-11', '2024-01-12', '2024-01-13']) }),
    )
    expect(r.current).toBe(3) // frozen
    expect(r.status).toBe('at_risk')
    expect(r.saved).toBe(0)
  })

  it('recovers an at-risk streak and counts a save', () => {
    // 11,12,13 done; 14 missed; 15 (today) done -> saved
    const r = computeStreak(
      dailyBoolean({
        completions: new Set(['2024-01-11', '2024-01-12', '2024-01-13', '2024-01-15']),
      }),
    )
    expect(r.current).toBe(4)
    expect(r.status).toBe('active')
    expect(r.saved).toBe(1)
    expect(r.longest).toBe(4)
  })

  it('breaks after two consecutive missed scheduled days', () => {
    // 11,12,13 done; 14 & 15 missed; today 16 open
    const r = computeStreak(
      dailyBoolean({
        completions: new Set(['2024-01-11', '2024-01-12', '2024-01-13']),
        today: '2024-01-16',
      }),
    )
    expect(r.current).toBe(0)
    expect(r.status).toBe('broken')
    expect(r.longest).toBe(3)
    expect(r.saved).toBe(0)
  })

  it('stays broken (0) after 3+ consecutive misses, not negative', () => {
    const r = computeStreak(
      dailyBoolean({
        completions: new Set(['2024-01-11', '2024-01-12', '2024-01-13']),
        today: '2024-01-18', // 14,15,16,17 missed; 18 open
      }),
    )
    expect(r.current).toBe(0)
    expect(r.status).toBe('broken')
  })

  it('restarts cleanly after a break (no save credited for a fresh start)', () => {
    // 11,12,13 done; 14,15 missed (break); 16,17 done; today 17
    const r = computeStreak(
      dailyBoolean({
        completions: new Set([
          '2024-01-11',
          '2024-01-12',
          '2024-01-13',
          '2024-01-16',
          '2024-01-17',
        ]),
        today: '2024-01-17',
      }),
    )
    expect(r.current).toBe(2)
    expect(r.status).toBe('active')
    expect(r.saved).toBe(0)
    expect(r.longest).toBe(3)
  })

  it('ignores days before start_date', () => {
    const r = computeStreak(
      dailyBoolean({
        schedule: { type: 'DAILY', startDate: '2024-01-13' },
        completions: new Set(['2024-01-13', '2024-01-14', '2024-01-15']),
      }),
    )
    expect(r.current).toBe(3)
    expect(r.status).toBe('active')
  })
})

// ─── SPECIFIC_DAYS ──────────────────────────────────────────────────────────────

describe('computeStreak — specific days (Mon/Wed/Fri)', () => {
  // 2024-01-01 is a Monday. M/W/F = days_of_week [1,3,5].
  const MWF = { type: 'SPECIFIC_DAYS' as const, daysOfWeek: [1, 3, 5], startDate: '2024-01-01' }

  it('counts only scheduled weekdays; off-days are not misses', () => {
    // All M/W/F done Jan 1..19; today Fri the 19th
    const dates = ['01', '03', '05', '08', '10', '12', '15', '17', '19'].map((d) => `2024-01-${d}`)
    const r = computeStreak({
      type: 'BOOLEAN',
      target: 1,
      schedule: MWF,
      completions: new Set(dates),
      sums: new Map(),
      today: '2024-01-19',
    })
    expect(r.current).toBe(9)
    expect(r.status).toBe('active')
  })

  it('treats a missed scheduled weekday as a miss and recovers on the next scheduled day', () => {
    // Skip Wed Jan 10 only; today Fri 19
    const dates = ['01', '03', '05', '08', '12', '15', '17', '19'].map((d) => `2024-01-${d}`)
    const r = computeStreak({
      type: 'BOOLEAN',
      target: 1,
      schedule: MWF,
      completions: new Set(dates),
      sums: new Map(),
      today: '2024-01-19',
    })
    expect(r.saved).toBe(1)
    expect(r.status).toBe('active')
    expect(r.current).toBe(8)
  })
})

// ─── NUMERIC (partial counts) ───────────────────────────────────────────────────

describe('computeStreak — numeric target', () => {
  const base = {
    type: 'NUMERIC' as const,
    target: 10,
    schedule: { type: 'DAILY' as const, startDate: '2024-01-11' },
    completions: new Set<string>(),
    today: '2024-01-15',
  }

  it('partial days (0 < sum < target) still increment the streak', () => {
    const sums = new Map([
      ['2024-01-11', 10],
      ['2024-01-12', 10],
      ['2024-01-13', 4], // partial
      ['2024-01-14', 10],
      ['2024-01-15', 10],
    ])
    const r = computeStreak({ ...base, sums })
    expect(r.current).toBe(5)
    expect(r.status).toBe('active')
  })

  it('a partial day rescues an at-risk streak (counts as a save)', () => {
    const sums = new Map([
      ['2024-01-11', 10],
      // 12 missed (no entry)
      ['2024-01-13', 3], // partial -> recover
      ['2024-01-14', 10],
    ])
    const r = computeStreak({ ...base, sums, today: '2024-01-14' })
    expect(r.saved).toBe(1)
    expect(r.current).toBe(3)
    expect(r.status).toBe('active')
  })

  it('a day with zero logged value is a miss', () => {
    const sums = new Map([
      ['2024-01-11', 10],
      ['2024-01-12', 10],
      // 13 missing -> miss -> at_risk; today 14 open... use today 15 with 14 missing too -> break
    ])
    const r = computeStreak({ ...base, sums, today: '2024-01-15' })
    expect(r.status).toBe('broken')
    expect(r.current).toBe(0)
  })
})

// ─── LIMIT (stay under) ─────────────────────────────────────────────────────────

describe('computeStreak — limit habit', () => {
  const base = {
    type: 'LIMIT' as const,
    target: 2,
    schedule: { type: 'DAILY' as const, startDate: '2024-01-11' },
    completions: new Set<string>(),
    today: '2024-01-14',
  }

  it('days at or under the limit (and logged) count as met', () => {
    const sums = new Map([
      ['2024-01-11', 1],
      ['2024-01-12', 2],
      ['2024-01-13', 1],
      ['2024-01-14', 2],
    ])
    const r = computeStreak({ ...base, sums })
    expect(r.current).toBe(4)
    expect(r.status).toBe('active')
  })

  it('going over the limit is a miss', () => {
    const sums = new Map([
      ['2024-01-11', 1],
      ['2024-01-12', 5], // over limit -> miss -> at_risk
      ['2024-01-13', 1], // recover
      ['2024-01-14', 1],
    ])
    const r = computeStreak({ ...base, sums })
    expect(r.saved).toBe(1)
    expect(r.status).toBe('active')
  })
})

// ─── WEEKLY_FLEX (week-based) ────────────────────────────────────────────────────

describe('computeStreak — weekly flex (3x/week, weeks start Sunday)', () => {
  // Weeks (Sun..Sat): wk1 2023-12-31..2024-01-06, wk2 01-07..01-13, wk3 01-14..01-20
  const flex = {
    type: 'BOOLEAN' as const,
    target: 1,
    schedule: { type: 'WEEKLY_FLEX' as const, frequencyCount: 3, startDate: '2023-12-31' },
    sums: new Map<string, number>(),
  }

  it('counts consecutive weeks that hit the weekly frequency', () => {
    const completions = new Set([
      // wk1: 3 days
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
      // wk2: 3 days
      '2024-01-08',
      '2024-01-09',
      '2024-01-10',
      // wk3 (current): 3 days
      '2024-01-15',
      '2024-01-16',
      '2024-01-17',
    ])
    const r = computeStreak({ ...flex, completions, today: '2024-01-17' })
    expect(r.current).toBe(3)
    expect(r.status).toBe('active')
  })

  it('a week short of the goal puts the streak at-risk', () => {
    const completions = new Set([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03', // wk1 ok
      '2024-01-08',
      '2024-01-09', // wk2 only 2 -> short
    ])
    // today in wk3, current week still open
    const r = computeStreak({ ...flex, completions, today: '2024-01-15' })
    expect(r.status).toBe('at_risk')
    expect(r.current).toBe(1)
  })

  it('two consecutive closed short weeks break the streak', () => {
    const completions = new Set([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03', // wk1 ok
      '2024-01-08', // wk2 short (closed)
      '2024-01-15', // wk3 short (closed)
    ])
    // today in wk4 (2024-01-21..27), so wk2 & wk3 are both closed and short
    const r = computeStreak({ ...flex, completions, today: '2024-01-24' })
    expect(r.current).toBe(0)
    expect(r.status).toBe('broken')
  })
})

// ─── Struggling detector (recent completion rate) ────────────────────────────────

describe('recentCompletionRate & isStruggling', () => {
  function daily(over: Partial<StreakInput> = {}): StreakInput {
    return {
      type: 'BOOLEAN',
      target: 1,
      schedule: { type: 'DAILY', startDate: '2023-12-01' },
      completions: new Set(),
      today: '2024-01-15',
      ...over,
    }
  }

  it('measures the rate over the last 14 closed days (excludes today)', () => {
    // completed 4 of the 14 days before today (2024-01-01 .. 2024-01-14)
    const done = new Set(['2024-01-02', '2024-01-05', '2024-01-09', '2024-01-14'])
    const w = recentCompletionRate(daily({ completions: done }))
    expect(w.scheduled).toBe(14)
    expect(w.hit).toBe(4)
    expect(w.rate).toBeCloseTo(4 / 14)
  })

  it('flags a habit below 30% as struggling', () => {
    const done = new Set(['2024-01-02', '2024-01-09']) // 2 / 14 ≈ 14%
    expect(isStruggling(daily({ completions: done }))).toBe(true)
  })

  it('does not flag a habit at or above 30%', () => {
    // 5 / 14 ≈ 36%
    const done = new Set([
      '2024-01-02',
      '2024-01-05',
      '2024-01-08',
      '2024-01-11',
      '2024-01-14',
    ])
    expect(isStruggling(daily({ completions: done }))).toBe(false)
  })

  it('does not flag a brand-new habit (too few scheduled days)', () => {
    // habit started 4 days ago → only 4 scheduled closed days, below minScheduled
    const input = daily({ schedule: { type: 'DAILY', startDate: '2024-01-11' }, completions: new Set() })
    expect(recentCompletionRate(input).scheduled).toBe(4)
    expect(isStruggling(input)).toBe(false)
  })

  it('counts partial numeric days as hits', () => {
    const sums = new Map([
      ['2024-01-03', 2], // partial
      ['2024-01-07', 10], // met
      ['2024-01-12', 1], // partial
    ])
    const input: StreakInput = {
      type: 'NUMERIC',
      target: 10,
      schedule: { type: 'DAILY', startDate: '2023-12-01' },
      sums,
      today: '2024-01-15',
    }
    expect(recentCompletionRate(input).hit).toBe(3)
  })

  it('returns an empty window for weekly-flex habits', () => {
    const w = recentCompletionRate(
      daily({ schedule: { type: 'WEEKLY_FLEX', frequencyCount: 3, startDate: '2023-12-01' } }),
    )
    expect(w).toEqual({ scheduled: 0, hit: 0, rate: 0 })
    expect(isStruggling(daily({ schedule: { type: 'WEEKLY_FLEX', frequencyCount: 3 } }))).toBe(false)
  })
})
