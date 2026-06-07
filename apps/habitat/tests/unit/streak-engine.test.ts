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

// ─── DAILY · BOOLEAN — core forgiving model ─────────────────────────────────────

describe('computeStreak — daily boolean (forgiving model)', () => {
  it('counts a clean consecutive streak (active, plant grows with it)', () => {
    const r = computeStreak(
      dailyBoolean({ completions: new Set(range('2024-01-11', '2024-01-15')) }),
    )
    expect(r.current).toBe(5)
    expect(r.longest).toBe(5)
    expect(r.status).toBe('active')
    expect(r.plantLevel).toBe(5)
    expect(r.thawProgress).toBe(0)
    expect(r.thawed).toBe(0)
    expect(r.daisies).toBe(0)
  })

  it('does not penalize today while it is still open', () => {
    const r = computeStreak(
      dailyBoolean({ completions: new Set(range('2024-01-11', '2024-01-14')) }),
    )
    expect(r.current).toBe(4)
    expect(r.status).toBe('active')
  })

  it('freezes (not resets) on a single miss; plant drops one notch', () => {
    // 11,12,13 done; 14 missed; today 15 open
    const r = computeStreak(
      dailyBoolean({ completions: new Set(['2024-01-11', '2024-01-12', '2024-01-13']) }),
    )
    expect(r.current).toBe(3) // held, not zero
    expect(r.status).toBe('frozen')
    expect(r.plantLevel).toBe(2) // 3 grown, 1 lost to the miss
  })

  it('shows a partial-thaw state after 1–2 completions following a freeze', () => {
    // 11,12,13 done; 14 missed; 15,16 done; today 17 open (only 2 of 3 thaw days)
    const r = computeStreak(
      dailyBoolean({
        completions: new Set(['2024-01-11', '2024-01-12', '2024-01-13', '2024-01-15', '2024-01-16']),
        today: '2024-01-17',
      }),
    )
    expect(r.status).toBe('thawing')
    expect(r.thawProgress).toBe(2)
    expect(r.current).toBe(3) // still frozen value until fully thawed
  })

  it('thaws after 3 scheduled completions and resumes (crediting the thaw work)', () => {
    // 11,12,13 done; 14 missed; 15,16,17 done (3 thaw days), today 17
    const r = computeStreak(
      dailyBoolean({
        completions: new Set([
          '2024-01-11',
          '2024-01-12',
          '2024-01-13',
          '2024-01-15',
          '2024-01-16',
          '2024-01-17',
        ]),
        today: '2024-01-17',
      }),
    )
    expect(r.status).toBe('active')
    expect(r.current).toBe(6) // 3 frozen + 3 thaw completions
    expect(r.thawProgress).toBe(0)
    expect(r.thawed).toBe(1)
    expect(r.longest).toBe(6)
  })

  it('resets thaw progress if you miss again while thawing (stays frozen)', () => {
    // 11,12,13 done; 14 miss; 15 done (thaw 1); 16 miss; 17 done (thaw 1 again); today 18 open
    const r = computeStreak(
      dailyBoolean({
        completions: new Set([
          '2024-01-11',
          '2024-01-12',
          '2024-01-13',
          '2024-01-15',
          '2024-01-17',
        ]),
        today: '2024-01-18',
      }),
    )
    expect(r.status).toBe('thawing')
    expect(r.thawProgress).toBe(1)
    expect(r.current).toBe(3)
  })

  it('never resets to 0 on prolonged neglect; the plant regresses to seed', () => {
    // 11,12,13 done; then miss 14..18; today 19 open
    const r = computeStreak(
      dailyBoolean({
        completions: new Set(['2024-01-11', '2024-01-12', '2024-01-13']),
        today: '2024-01-19',
      }),
    )
    expect(r.current).toBe(3) // frozen, never zero
    expect(r.status).toBe('frozen')
    expect(r.plantLevel).toBe(0) // regressed all the way to a seed
    expect(r.longest).toBe(3)
  })

  it('awards a daisy at the 30-day bloom milestone', () => {
    const r = computeStreak(
      dailyBoolean({
        schedule: { type: 'DAILY', startDate: '2024-01-01' },
        completions: new Set(range('2024-01-01', '2024-01-30')),
        today: '2024-01-30',
      }),
    )
    expect(r.current).toBe(30)
    expect(r.daisies).toBe(1)
    expect(r.plantLevel).toBe(30)
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
  const MWF = { type: 'SPECIFIC_DAYS' as const, daysOfWeek: [1, 3, 5], startDate: '2024-01-01' }

  it('counts only scheduled weekdays; off-days never freeze it', () => {
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

  it('freezes on a missed scheduled weekday', () => {
    // skip Wed Jan 10; today Fri 19 open
    const dates = ['01', '03', '05', '08', '12', '15', '17'].map((d) => `2024-01-${d}`)
    const r = computeStreak({
      type: 'BOOLEAN',
      target: 1,
      schedule: MWF,
      completions: new Set(dates),
      sums: new Map(),
      today: '2024-01-19',
    })
    // 01,03,05,08 active (4) then 10 missed -> frozen; 12,15,17 are 3 thaw days -> thawed
    expect(r.status).toBe('active')
    expect(r.current).toBe(7) // 4 frozen + 3 thaw
    expect(r.thawed).toBe(1)
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

  it('partial days (0 < sum < target) still grow the streak and plant', () => {
    const sums = new Map([
      ['2024-01-11', 10],
      ['2024-01-12', 10],
      ['2024-01-13', 4], // partial
      ['2024-01-14', 10],
      ['2024-01-15', 10],
    ])
    const r = computeStreak({ ...base, sums })
    expect(r.current).toBe(5)
    expect(r.plantLevel).toBe(5)
    expect(r.status).toBe('active')
  })

  it('a zero-logged day freezes the streak', () => {
    const sums = new Map([
      ['2024-01-11', 10],
      ['2024-01-12', 10],
    ])
    const r = computeStreak({ ...base, sums, today: '2024-01-15' })
    expect(r.status).toBe('frozen')
    expect(r.current).toBe(2)
  })
})

// ─── WEEKLY_FLEX (week-based) ────────────────────────────────────────────────────

describe('computeStreak — weekly flex (3x/week)', () => {
  const flex = {
    type: 'BOOLEAN' as const,
    target: 1,
    schedule: { type: 'WEEKLY_FLEX' as const, frequencyCount: 3, startDate: '2023-12-31' },
    sums: new Map<string, number>(),
  }

  it('counts consecutive weeks that hit the frequency', () => {
    const completions = new Set([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
      '2024-01-08',
      '2024-01-09',
      '2024-01-10',
      '2024-01-15',
      '2024-01-16',
      '2024-01-17',
    ])
    const r = computeStreak({ ...flex, completions, today: '2024-01-17' })
    expect(r.current).toBe(3)
    expect(r.status).toBe('active')
  })

  it('freezes when a closed week misses the frequency', () => {
    const completions = new Set([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03', // wk1 ok
      '2024-01-08',
      '2024-01-09', // wk2 short -> freeze
    ])
    const r = computeStreak({ ...flex, completions, today: '2024-01-15' })
    expect(r.status).toBe('frozen')
    expect(r.current).toBe(1)
  })
})

// ─── Struggling detector (recent completion rate) — unchanged ────────────────────

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
    const done = new Set(['2024-01-02', '2024-01-05', '2024-01-09', '2024-01-14'])
    const w = recentCompletionRate(daily({ completions: done }))
    expect(w.scheduled).toBe(14)
    expect(w.hit).toBe(4)
    expect(w.rate).toBeCloseTo(4 / 14)
  })

  it('flags a habit below 30% as struggling', () => {
    const done = new Set(['2024-01-02', '2024-01-09'])
    expect(isStruggling(daily({ completions: done }))).toBe(true)
  })

  it('does not flag a habit at or above 30%', () => {
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
    const input = daily({
      schedule: { type: 'DAILY', startDate: '2024-01-11' },
      completions: new Set(),
    })
    expect(recentCompletionRate(input).scheduled).toBe(4)
    expect(isStruggling(input)).toBe(false)
  })

  it('returns an empty window for weekly-flex habits', () => {
    const w = recentCompletionRate(
      daily({ schedule: { type: 'WEEKLY_FLEX', frequencyCount: 3, startDate: '2023-12-01' } }),
    )
    expect(w).toEqual({ scheduled: 0, hit: 0, rate: 0 })
  })
})
