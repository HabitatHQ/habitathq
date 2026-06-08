import { describe, it, expect } from 'vitest'
import { computeCheckinInsights } from '~/utils/checkin-insights'
import type { CheckinHistoryRow, CheckinTemplate } from '~/types/database'

function row(over: Partial<CheckinHistoryRow>): CheckinHistoryRow {
  return {
    template_id: 't1',
    template_title: 'Morning',
    schedule_type: 'DAILY',
    question_id: 'q1',
    prompt: 'How did you sleep?',
    response_type: 'SCALE',
    display_order: 0,
    desired_answer: 1,
    logged_date: '2024-01-15',
    value_numeric: null,
    value_text: null,
    ...over,
  }
}

const TEMPLATES: Pick<CheckinTemplate, 'id' | 'title' | 'schedule_type' | 'days_active'>[] = [
  { id: 't1', title: 'Morning', schedule_type: 'DAILY', days_active: null },
]

function run(rows: CheckinHistoryRow[], windowDays = 7, today = '2024-01-15') {
  return computeCheckinInsights({ rows, templates: TEMPLATES, today, windowDays })
}

describe('computeCheckinInsights — SCALE', () => {
  it('averages numeric values over the window and builds a per-day series', () => {
    const rows = [
      row({ logged_date: '2024-01-13', value_numeric: 6 }),
      row({ logged_date: '2024-01-14', value_numeric: 8 }),
      row({ logged_date: '2024-01-15', value_numeric: 7 }),
    ]
    const [t] = run(rows)
    const q = t!.questions[0]
    if (q?.kind !== 'scale') throw new Error('expected scale')
    expect(q.avg).toBe(7) // (6+8+7)/3
    expect(q.count).toBe(3)
    expect(q.series).toHaveLength(7) // window days
    expect(q.series.at(-1)).toEqual({ date: '2024-01-15', value: 7 })
    expect(q.series.filter((s) => s.value == null)).toHaveLength(4) // 4 empty days
  })

  it('delta compares current window avg to the previous window', () => {
    // window 2 days: current = 14,15 (avg 8); previous = 12,13 (avg 6) → +2
    const rows = [
      row({ logged_date: '2024-01-12', value_numeric: 6 }),
      row({ logged_date: '2024-01-13', value_numeric: 6 }),
      row({ logged_date: '2024-01-14', value_numeric: 8 }),
      row({ logged_date: '2024-01-15', value_numeric: 8 }),
    ]
    const [t] = run(rows, 2)
    const q = t!.questions[0]
    if (q?.kind !== 'scale') throw new Error('expected scale')
    expect(q.avg).toBe(8)
    expect(q.delta).toBe(2)
  })
})

describe('computeCheckinInsights — BOOLEAN', () => {
  it('computes % in the desired direction', () => {
    const rows = [
      row({ question_id: 'b', prompt: 'Anxious?', response_type: 'BOOLEAN', desired_answer: 0, display_order: 1, logged_date: '2024-01-13', value_numeric: 0 }),
      row({ question_id: 'b', prompt: 'Anxious?', response_type: 'BOOLEAN', desired_answer: 0, display_order: 1, logged_date: '2024-01-14', value_numeric: 0 }),
      row({ question_id: 'b', prompt: 'Anxious?', response_type: 'BOOLEAN', desired_answer: 0, display_order: 1, logged_date: '2024-01-15', value_numeric: 1 }),
    ]
    const [t] = run(rows)
    const q = t!.questions[0]
    if (q?.kind !== 'boolean') throw new Error('expected boolean')
    expect(q.pctDesired).toBe(67) // 2 of 3 answered "no" (desired)
    expect(q.count).toBe(3)
  })
})

describe('computeCheckinInsights — TEXT', () => {
  it('counts non-empty reflections', () => {
    const rows = [
      row({ question_id: 'tx', prompt: 'Wins?', response_type: 'TEXT', display_order: 2, logged_date: '2024-01-14', value_text: 'shipped it' }),
      row({ question_id: 'tx', prompt: 'Wins?', response_type: 'TEXT', display_order: 2, logged_date: '2024-01-15', value_text: '   ' }),
    ]
    const [t] = run(rows)
    const q = t!.questions[0]
    if (q?.kind !== 'text') throw new Error('expected text')
    expect(q.count).toBe(1) // blank one ignored
  })
})

describe('computeCheckinInsights — template-level', () => {
  it('reports consistency days and a streak, ordered questions, and skips empty templates', () => {
    const rows = [
      row({ logged_date: '2024-01-14', value_numeric: 7 }),
      row({ logged_date: '2024-01-15', value_numeric: 7 }),
      row({ question_id: 'b', prompt: 'Anxious?', response_type: 'BOOLEAN', desired_answer: 0, display_order: 1, logged_date: '2024-01-15', value_numeric: 0 }),
    ]
    const result = run(rows)
    expect(result).toHaveLength(1)
    const t = result[0]!
    expect(t.consistencyDays).toBe(2) // Jan 14 + 15
    expect(t.streak).toBe(2) // two consecutive daily check-ins
    expect(t.questions.map((q) => q.kind)).toEqual(['scale', 'boolean'])
  })

  it('returns nothing when there are no in-window responses', () => {
    const rows = [row({ logged_date: '2023-12-01', value_numeric: 5 })]
    expect(run(rows)).toHaveLength(0)
  })
})
