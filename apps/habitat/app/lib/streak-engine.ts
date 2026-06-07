/**
 * streak-engine — pure, schedule-aware streak calculation with "never miss twice".
 *
 * Single source of truth for streak state across the app (db-shared `getStreak`
 * and any UI that needs a habit's streak). No DB access: callers pass the habit's
 * completion dates and/or per-day logged sums, the schedule, and "today".
 *
 * Rules (see product spec):
 *  - A "miss" is only counted on a habit's SCHEDULED units.
 *      · DAILY / SPECIFIC_DAYS → unit = a scheduled day.
 *      · WEEKLY_FLEX           → unit = a week (Sun-start); a week is "met" when
 *        it reaches the weekly frequency.
 *  - One missed unit → `at_risk` (streak number frozen, not reset).
 *    A second consecutive missed unit → `broken` (resets to 0).
 *  - Completing the unit right after a single miss "saves" the streak (+1 `saved`).
 *  - Target habits (NUMERIC) with partial progress (0 < sum < target) on a
 *    scheduled day still count as a hit ("showing up counts") — they increment
 *    and avoid at-risk. LIMIT habits count when logged and at/under the limit.
 *  - The current in-progress unit (today, or the current week) is never penalized
 *    until it closes — an incomplete today does not count as a miss.
 */

export type StreakStatus = 'active' | 'at_risk' | 'broken'

/** Per-unit classification. `partial` only occurs for NUMERIC habits. */
export type DayStatus = 'met' | 'partial' | 'missed'

export interface StreakResult {
  /** Current streak length (days for DAILY/SPECIFIC_DAYS, weeks for WEEKLY_FLEX). */
  current: number
  /** Longest streak ever reached. */
  longest: number
  /** State of the current streak. */
  status: StreakStatus
  /** Recovery counter — times an at-risk streak was rescued (never-miss-twice saves). */
  saved: number
}

export interface StreakSchedule {
  type: 'DAILY' | 'SPECIFIC_DAYS' | 'WEEKLY_FLEX'
  /** 0=Sun … 6=Sat. Only used for SPECIFIC_DAYS. */
  daysOfWeek?: number[] | null
  /** Times per week. Only used for WEEKLY_FLEX. */
  frequencyCount?: number | null
  /** YYYY-MM-DD; days before this are ignored. */
  startDate?: string | null
}

export interface StreakInput {
  type: 'BOOLEAN' | 'NUMERIC' | 'LIMIT'
  target: number
  schedule: StreakSchedule
  /** Completion dates (YYYY-MM-DD) — used for BOOLEAN habits. */
  completions?: Set<string>
  /** date(YYYY-MM-DD) → total logged value that day — used for NUMERIC/LIMIT habits. */
  sums?: Map<string, number>
  /** Reference "today" as YYYY-MM-DD. */
  today: string
}

// ─── Date helpers (UTC, calendar-only) ──────────────────────────────────────────

function toUTC(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(date: string, n: number): string {
  const d = toUTC(date)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

function dayOfWeek(date: string): number {
  return toUTC(date).getUTCDay()
}

/** Sunday-aligned week start for a date. */
function weekStart(date: string): string {
  return addDays(date, -dayOfWeek(date))
}

// ─── Per-day classification ─────────────────────────────────────────────────────

function classifyDay(input: StreakInput, date: string): DayStatus {
  if (input.type === 'BOOLEAN') {
    return input.completions?.has(date) ? 'met' : 'missed'
  }
  const sum = input.sums?.get(date) ?? 0
  if (input.type === 'NUMERIC') {
    if (sum >= input.target) return 'met'
    return sum > 0 ? 'partial' : 'missed'
  }
  // LIMIT — "stay under". Logged and at/under the limit = met; otherwise a miss.
  return sum > 0 && sum <= input.target ? 'met' : 'missed'
}

/** Whether a calendar day shows any activity (used for weekly-flex day counting). */
function hasActivity(input: StreakInput, date: string): boolean {
  if (input.type === 'BOOLEAN') return input.completions?.has(date) ?? false
  return (input.sums?.get(date) ?? 0) > 0
}

// ─── Unit sequence builders ─────────────────────────────────────────────────────

/** Earliest date we have any data for, or null. */
function earliestDataDate(input: StreakInput): string | null {
  let min: string | null = null
  for (const d of input.completions ?? []) if (min === null || d < min) min = d
  for (const d of input.sums?.keys() ?? []) if (min === null || d < min) min = d
  return min
}

function effectiveStart(input: StreakInput): string {
  return input.schedule.startDate ?? earliestDataDate(input) ?? input.today
}

/**
 * Build the ordered hit/miss sequence to feed the state machine.
 * Excludes the current in-progress unit unless it is already a hit.
 */
function buildSequence(input: StreakInput): boolean[] {
  return input.schedule.type === 'WEEKLY_FLEX' ? buildWeekSequence(input) : buildDaySequence(input)
}

function buildDaySequence(input: StreakInput): boolean[] {
  const start = effectiveStart(input)
  if (start > input.today) return []
  const isSpecific = input.schedule.type === 'SPECIFIC_DAYS'
  const days = isSpecific ? new Set(input.schedule.daysOfWeek ?? []) : null

  const seq: boolean[] = []
  for (let date = start; date <= input.today; date = addDays(date, 1)) {
    if (days && !days.has(dayOfWeek(date))) continue // not a scheduled day
    const hit = classifyDay(input, date) !== 'missed'
    // The current day (today) is only included if it is already a hit.
    if (date === input.today && !hit) continue
    seq.push(hit)
  }
  return seq
}

function buildWeekSequence(input: StreakInput): boolean[] {
  const start = effectiveStart(input)
  if (start > input.today) return []
  const freq = input.schedule.frequencyCount ?? 1
  const firstWeek = weekStart(start)
  const currentWeek = weekStart(input.today)

  const seq: boolean[] = []
  for (let ws = firstWeek; ws <= currentWeek; ws = addDays(ws, 7)) {
    const weekEnd = addDays(ws, 6)
    // Count distinct activity days within the week, bounded by today.
    let activeDays = 0
    for (let date = ws; date <= weekEnd && date <= input.today; date = addDays(date, 1)) {
      if (hasActivity(input, date)) activeDays++
    }
    const met = activeDays >= freq
    // The current (in-progress) week is only included if already met.
    if (ws === currentWeek && !met) continue
    seq.push(met)
  }
  return seq
}

// ─── State machine ──────────────────────────────────────────────────────────────

function runMachine(seq: boolean[]): StreakResult {
  let current = 0
  let longest = 0
  let saved = 0
  let status: StreakStatus = 'broken'
  let atRisk = false

  for (const hit of seq) {
    if (hit) {
      if (atRisk) {
        saved++ // rescued a single miss — never miss twice
        atRisk = false
      }
      current++
      if (current > longest) longest = current
      status = 'active'
    } else if (atRisk) {
      // second consecutive miss → break
      current = 0
      atRisk = false
      status = 'broken'
    } else if (current > 0) {
      // first miss on an active streak → grace
      atRisk = true
      status = 'at_risk'
    } else {
      status = 'broken'
    }
  }

  return { current, longest, status, saved }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

export function computeStreak(input: StreakInput): StreakResult {
  return runMachine(buildSequence(input))
}

/** Streak lengths at which the sprout advances a growth stage (1‑indexed stages). */
export const GROWTH_THRESHOLDS = [1, 3, 7, 14, 21, 30] as const

/**
 * Growth stage (0–6) for a streak: 0 = dormant/seed (broken or no streak),
 * 1 = seed … 6 = bloom. Shared by SproutPlant and the garden.
 */
export function growthStage(streak: number, status: StreakStatus): number {
  if (status === 'broken' || streak < 1) return 0
  let s = 0
  for (const t of GROWTH_THRESHOLDS) if (streak >= t) s++
  return s
}

export interface CompletionWindow {
  /** Number of scheduled (closed) days in the window. */
  scheduled: number
  /** How many of those were hit (met or partial). */
  hit: number
  /** hit / scheduled, or 0 when nothing was scheduled. */
  rate: number
}

/**
 * Completion rate over the last `windowDays` CLOSED days (ending yesterday — today
 * is still open and never penalised). WEEKLY_FLEX returns an empty window.
 */
export function recentCompletionRate(input: StreakInput, windowDays = 14): CompletionWindow {
  const empty: CompletionWindow = { scheduled: 0, hit: 0, rate: 0 }
  if (input.schedule.type === 'WEEKLY_FLEX') return empty

  const from = addDays(input.today, -windowDays)
  const start = effectiveStart(input)
  const begin = start > from ? start : from
  const end = addDays(input.today, -1) // yesterday
  if (begin > end) return empty

  const days =
    input.schedule.type === 'SPECIFIC_DAYS' ? new Set(input.schedule.daysOfWeek ?? []) : null
  let scheduled = 0
  let hit = 0
  for (let date = begin; date <= end; date = addDays(date, 1)) {
    if (days && !days.has(dayOfWeek(date))) continue
    scheduled++
    if (classifyDay(input, date) !== 'missed') hit++
  }
  return { scheduled, hit, rate: scheduled === 0 ? 0 : hit / scheduled }
}

/**
 * A habit is "struggling" when it has enough recent scheduled days to judge AND a
 * low hit rate. The `minScheduled` guard prevents brand-new habits from flagging.
 */
export function isStruggling(
  input: StreakInput,
  { windowDays = 14, minScheduled = 7, threshold = 0.3 } = {},
): boolean {
  const w = recentCompletionRate(input, windowDays)
  return w.scheduled >= minScheduled && w.rate < threshold
}
