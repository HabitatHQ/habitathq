import { computeStreak } from '~/lib/streak-engine'
import type { CheckinHistoryRow, CheckinTemplate } from '~/types/database'

/**
 * Pure aggregation for the Check-in Insights tab. Turns raw per-question response
 * history into per-template insights: SCALE averages + trend series, BOOLEAN
 * percent-in-desired-direction, TEXT counts, reflection consistency + a gentle
 * (forgiving) streak. Trends are neutral — `delta` only carries a direction.
 */

export interface ScaleInsight {
  kind: 'scale'
  questionId: string
  prompt: string
  avg: number | null
  /** Current-window avg minus previous-window avg (0 when undeterminable). */
  delta: number
  count: number
  /** One entry per window day (ascending); value is null on days with no answer. */
  series: { date: string; value: number | null }[]
}

export interface BooleanInsight {
  kind: 'boolean'
  questionId: string
  prompt: string
  /** % of answered days matching desired_answer (null if none answered). */
  pctDesired: number | null
  delta: number
  count: number
}

export interface TextInsight {
  kind: 'text'
  questionId: string
  prompt: string
  count: number
}

export type QuestionInsight = ScaleInsight | BooleanInsight | TextInsight

export interface TemplateInsight {
  templateId: string
  title: string
  /** Distinct days with ≥1 response in the window. */
  consistencyDays: number
  windowDays: number
  /** Gentle forgiving streak (days for DAILY/WEEKLY; 0 for MONTHLY). */
  streak: number
  questions: QuestionInsight[]
}

export interface CheckinInsightsInput {
  rows: CheckinHistoryRow[]
  templates: Pick<CheckinTemplate, 'id' | 'title' | 'schedule_type' | 'days_active'>[]
  today: string
  windowDays: number
}

// ─── date helpers (UTC) ─────────────────────────────────────────────────────────

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function windowDates(today: string, windowDays: number): string[] {
  const out: string[] = []
  for (let i = windowDays - 1; i >= 0; i--) out.push(addDays(today, -i))
  return out
}

// ─── small stats ────────────────────────────────────────────────────────────────

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// ─── per-question builders ──────────────────────────────────────────────────────

function scaleInsight(
  q: { questionId: string; prompt: string },
  curr: CheckinHistoryRow[],
  prev: CheckinHistoryRow[],
  dates: string[],
): ScaleInsight {
  const nums = curr.map((r) => r.value_numeric).filter((v): v is number => v != null)
  const avg = mean(nums)
  const prevAvg = mean(prev.map((r) => r.value_numeric).filter((v): v is number => v != null))
  const byDate = new Map(curr.map((r) => [r.logged_date, r.value_numeric]))
  return {
    kind: 'scale',
    questionId: q.questionId,
    prompt: q.prompt,
    avg: avg == null ? null : round1(avg),
    delta: avg != null && prevAvg != null ? round1(avg - prevAvg) : 0,
    count: nums.length,
    series: dates.map((date) => ({ date, value: byDate.get(date) ?? null })),
  }
}

function booleanInsight(
  q: { questionId: string; prompt: string; desiredAnswer: number },
  curr: CheckinHistoryRow[],
  prev: CheckinHistoryRow[],
): BooleanInsight {
  const pct = (rows: CheckinHistoryRow[]): number | null => {
    const nums = rows.map((r) => r.value_numeric).filter((v): v is number => v != null)
    if (nums.length === 0) return null
    return (100 * nums.filter((v) => v === q.desiredAnswer).length) / nums.length
  }
  const cur = pct(curr)
  const pre = pct(prev)
  return {
    kind: 'boolean',
    questionId: q.questionId,
    prompt: q.prompt,
    pctDesired: cur == null ? null : Math.round(cur),
    delta: cur != null && pre != null ? Math.round(cur - pre) : 0,
    count: curr.filter((r) => r.value_numeric != null).length,
  }
}

function textInsight(
  q: { questionId: string; prompt: string },
  curr: CheckinHistoryRow[],
): TextInsight {
  return {
    kind: 'text',
    questionId: q.questionId,
    prompt: q.prompt,
    count: curr.filter((r) => (r.value_text ?? '').trim().length > 0).length,
  }
}

// ─── consistency streak ─────────────────────────────────────────────────────────

function consistencyStreak(
  schedule_type: string,
  days_active: number[] | null,
  responseDates: Set<string>,
  today: string,
): number {
  if (schedule_type === 'MONTHLY') return 0 // a day-streak doesn't fit monthly
  const sched =
    schedule_type === 'WEEKLY'
      ? { type: 'SPECIFIC_DAYS' as const, daysOfWeek: days_active ?? [0, 1, 2, 3, 4, 5, 6] }
      : { type: 'DAILY' as const }
  return computeStreak({
    type: 'BOOLEAN',
    target: 1,
    schedule: sched,
    completions: responseDates,
    today,
  }).current
}

// ─── main ───────────────────────────────────────────────────────────────────────

function buildQuestions(curr: CheckinHistoryRow[], prev: CheckinHistoryRow[], dates: string[]) {
  // Distinct questions in display order, from the current-window rows.
  const seen = new Map<string, CheckinHistoryRow>()
  for (const r of curr) if (!seen.has(r.question_id)) seen.set(r.question_id, r)
  const ordered = [...seen.values()].sort((a, b) => a.display_order - b.display_order)

  return ordered.map((q): QuestionInsight => {
    const qc = curr.filter((r) => r.question_id === q.question_id)
    const qp = prev.filter((r) => r.question_id === q.question_id)
    const base = { questionId: q.question_id, prompt: q.prompt }
    if (q.response_type === 'SCALE') return scaleInsight(base, qc, qp, dates)
    if (q.response_type === 'BOOLEAN') {
      return booleanInsight({ ...base, desiredAnswer: q.desired_answer }, qc, qp)
    }
    return textInsight(base, qc)
  })
}

export function computeCheckinInsights(input: CheckinInsightsInput): TemplateInsight[] {
  const { rows, templates, today, windowDays } = input
  const winStart = addDays(today, -(windowDays - 1))
  const prevStart = addDays(today, -(2 * windowDays - 1))
  const prevEnd = addDays(today, -windowDays)
  const dates = windowDates(today, windowDays)

  const out: TemplateInsight[] = []
  for (const t of templates) {
    const tRows = rows.filter((r) => r.template_id === t.id)
    const curr = tRows.filter((r) => r.logged_date >= winStart && r.logged_date <= today)
    if (curr.length === 0) continue // nothing to show for this template in-window
    const prev = tRows.filter((r) => r.logged_date >= prevStart && r.logged_date <= prevEnd)

    out.push({
      templateId: t.id,
      title: t.title,
      consistencyDays: new Set(curr.map((r) => r.logged_date)).size,
      windowDays,
      streak: consistencyStreak(
        t.schedule_type,
        t.days_active,
        new Set(tRows.map((r) => r.logged_date)),
        today,
      ),
      questions: buildQuestions(curr, prev, dates),
    })
  }
  return out
}
