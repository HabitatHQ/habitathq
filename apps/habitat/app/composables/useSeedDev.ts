import type {
  CheckinQuestion,
  CheckinResponse,
  CheckinTemplate,
  Completion,
  Habit,
  HabitatExport,
  HabitLog,
  HabitSchedule,
} from '~/types/database'

/**
 * useSeedDev — generates realistic sample data for exercising the Insights page
 * (both the Habits and Check-ins tabs) and writes it via the bulk JSON import.
 *
 * Dev-only: the button that calls this is guarded by `import.meta.dev`.
 *
 * The generated data is deterministic — both the row IDs and the pseudo-random
 * values are seeded — so re-running the seed is idempotent. Habits/completions/
 * logs use stable IDs, and import uses INSERT OR IGNORE, so nothing duplicates.
 */

const HORIZON_DAYS = 180 // ~6 months — covers the heatmap + monthly charts
const CHECKIN_DAYS = 120 // depth of check-in response history

// ─── Deterministic PRNG (mulberry32) ────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable per-key hash so each habit/question gets its own deterministic stream. */
function hashSeed(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ─── Date helpers ────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Descending list of YYYY-MM-DD from today back `days` days (inclusive). */
function recentDates(days: number): string[] {
  const out: string[] = []
  const d = new Date()
  for (let i = 0; i < days; i++) {
    out.push(isoDate(d))
    d.setDate(d.getDate() - 1)
  }
  return out
}

function dowOf(date: string): number {
  return new Date(`${date}T00:00:00`).getDay()
}

// ─── Habit definitions ────────────────────────────────────────────────────────────

interface HabitSpec {
  id: string
  name: string
  icon: string
  color: string
  type: Habit['type']
  target_value: number
  /** Probability the habit is acted on / logged on any given day. */
  rate: number
  tags: string[]
}

const HABIT_SPECS: HabitSpec[] = [
  {
    id: 'seed-h-meditate',
    name: 'Meditate',
    icon: 'flower-lotus',
    color: '#8b5cf6',
    type: 'BOOLEAN',
    target_value: 1,
    rate: 0.82,
    tags: ['wellbeing'],
  },
  {
    id: 'seed-h-workout',
    name: 'Workout',
    icon: 'barbell',
    color: '#ef4444',
    type: 'BOOLEAN',
    target_value: 1,
    rate: 0.58,
    tags: ['health/exercise'],
  },
  {
    id: 'seed-h-read',
    name: 'Read pages',
    icon: 'book-open',
    color: '#3b82f6',
    type: 'NUMERIC',
    target_value: 20,
    rate: 0.75,
    tags: ['learning'],
  },
  {
    id: 'seed-h-water',
    name: 'Drink water',
    icon: 'water-drop',
    color: '#06b6d4',
    type: 'NUMERIC',
    target_value: 8,
    rate: 0.9,
    tags: ['health'],
  },
  {
    id: 'seed-h-screen',
    name: 'Screen time',
    icon: 'clock',
    color: '#f59e0b',
    type: 'LIMIT',
    target_value: 2,
    rate: 0.95,
    tags: ['wellbeing'],
  },
]

function buildHabits(now: string): { habits: Habit[]; schedules: HabitSchedule[] } {
  const createdAt = `${recentDates(HORIZON_DAYS).at(-1)}T08:00:00.000Z`
  const habits: Habit[] = []
  const schedules: HabitSchedule[] = []
  for (const spec of HABIT_SPECS) {
    habits.push({
      id: spec.id,
      name: spec.name,
      description: 'Sample habit seeded for insights testing.',
      why: '',
      color: spec.color,
      icon: spec.icon,
      frequency: 'daily',
      created_at: createdAt,
      archived_at: null,
      tags: spec.tags,
      annotations: {},
      type: spec.type,
      target_value: spec.target_value,
      paused_until: null,
    })
    schedules.push({
      id: `${spec.id}-sched`,
      habit_id: spec.id,
      schedule_type: 'DAILY',
      frequency_count: null,
      days_of_week: null,
      due_time: null,
      start_date: null,
      end_date: null,
    })
  }
  // `now` retained for signature symmetry with check-in builder
  void now
  return { habits, schedules }
}

function buildHabitHistory(): { completions: Completion[]; habit_logs: HabitLog[] } {
  const completions: Completion[] = []
  const habit_logs: HabitLog[] = []
  const dates = recentDates(HORIZON_DAYS)

  for (const spec of HABIT_SPECS) {
    const rng = makeRng(hashSeed(spec.id))
    for (const date of dates) {
      const acted = rng() < spec.rate
      if (!acted) continue
      const completedAt = `${date}T20:00:00.000Z`

      if (spec.type === 'BOOLEAN') {
        completions.push({
          id: `seed-c-${spec.id}-${date}`,
          habit_id: spec.id,
          date,
          completed_at: completedAt,
          notes: '',
          tags: [],
          annotations: {},
        })
        continue
      }

      // NUMERIC: aim around target with spread; LIMIT: usually under, sometimes over.
      let value: number
      if (spec.type === 'NUMERIC') {
        value = Math.max(1, Math.round(spec.target_value * (0.5 + rng() * 0.9)))
      } else {
        // LIMIT — center below the cap, occasional overshoot
        value = Math.round(spec.target_value * (0.4 + rng() * 1.1) * 10) / 10
      }
      habit_logs.push({
        id: `seed-l-${spec.id}-${date}`,
        habit_id: spec.id,
        date,
        logged_at: completedAt,
        value,
        notes: '',
      })
    }
  }
  return { completions, habit_logs }
}

// ─── Check-in definitions (used only when no templates exist yet) ───────────────────

const FALLBACK_TEMPLATE: { template: CheckinTemplate; questions: CheckinQuestion[] } = (() => {
  const tid = 'seed-ct-daily'
  return {
    template: {
      id: tid,
      title: 'Daily Reflection',
      schedule_type: 'DAILY',
      days_active: null,
      archived_at: null,
    },
    questions: [
      {
        id: 'seed-cq-mood',
        template_id: tid,
        prompt: 'Overall mood today (1–10)?',
        response_type: 'SCALE',
        display_order: 0,
        desired_answer: 1,
        archived_at: null,
      },
      {
        id: 'seed-cq-energy',
        template_id: tid,
        prompt: 'How is your energy level?',
        response_type: 'SCALE',
        display_order: 1,
        desired_answer: 1,
        archived_at: null,
      },
      {
        id: 'seed-cq-stress',
        template_id: tid,
        prompt: 'Are you feeling stressed?',
        response_type: 'BOOLEAN',
        display_order: 2,
        desired_answer: 0,
        archived_at: null,
      },
      {
        id: 'seed-cq-win',
        template_id: tid,
        prompt: 'What went well today?',
        response_type: 'TEXT',
        display_order: 3,
        desired_answer: 1,
        archived_at: null,
      },
    ],
  }
})()

const TEXT_SAMPLES = [
  'Got through a focused deep-work block.',
  'Had a good walk and cleared my head.',
  'Reconnected with an old friend.',
  'Shipped something I was proud of.',
  'Cooked a proper meal instead of takeout.',
  'Slept well and woke up rested.',
  'Took a real break without my phone.',
  'Helped a teammate unblock their work.',
]

/** Generate a single response value for a question on a given day, or null to skip. */
function answerFor(
  q: CheckinQuestion,
  rng: () => number,
  progress: number,
): Pick<CheckinResponse, 'value_numeric' | 'value_text'> | null {
  if (q.response_type === 'SCALE') {
    // Gentle upward drift toward today (progress 0→1) so trends look alive.
    const base = 4 + progress * 3
    const value = Math.min(10, Math.max(1, Math.round(base + (rng() - 0.5) * 4)))
    return { value_numeric: value, value_text: null }
  }
  if (q.response_type === 'BOOLEAN') {
    // Bias toward the desired answer most days.
    const desired = q.desired_answer === 0 ? 0 : 1
    return { value_numeric: rng() < 0.7 ? desired : 1 - desired, value_text: null }
  }
  const text = TEXT_SAMPLES[Math.floor(rng() * TEXT_SAMPLES.length)]
  return text ? { value_numeric: null, value_text: text } : null
}

/** True when a template should record a response on the given date. */
function isScheduledDay(scheduleType: string, date: string): boolean {
  if (scheduleType === 'WEEKLY') return dowOf(date) === 0
  if (scheduleType === 'MONTHLY') return date.endsWith('-01')
  return true
}

/** Build check-in responses across recent days for the given templates+questions. */
function buildCheckinResponses(
  templates: Pick<CheckinTemplate, 'id' | 'schedule_type'>[],
  questionsByTemplate: Map<string, CheckinQuestion[]>,
): CheckinResponse[] {
  const responses: CheckinResponse[] = []
  const dates = recentDates(CHECKIN_DAYS)

  for (const tpl of templates) {
    const questions = (questionsByTemplate.get(tpl.id) ?? []).filter((q) => !q.archived_at)
    if (questions.length === 0) continue
    const skipChance = tpl.schedule_type === 'DAILY' ? 0.25 : 0.1

    dates.forEach((date, idx) => {
      if (!isScheduledDay(tpl.schedule_type, date)) return
      const progress = 1 - idx / dates.length

      for (const q of questions) {
        const rng = makeRng(hashSeed(`${q.id}|${date}`))
        if (rng() < skipChance) continue // non-perfect consistency
        const answer = answerFor(q, rng, progress)
        if (!answer) continue
        responses.push({
          id: `seed-r-${q.id}-${date}`,
          question_id: q.id,
          logged_date: date,
          ...answer,
        })
      }
    })
  }
  return responses
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function useSeedDev() {
  const db = useDatabase()

  async function seedInsightsData(): Promise<{
    habits: number
    completions: number
    habit_logs: number
    checkin_responses: number
  }> {
    const now = new Date().toISOString()

    const { habits, schedules } = buildHabits(now)
    const { completions, habit_logs } = buildHabitHistory()

    // Prefer attaching responses to the user's existing check-in templates so the
    // data shows up under the names they already see. Fall back to a seeded
    // template only when none exist (e.g. after a data wipe).
    const existing = await db.getCheckinTemplates()
    const active = existing.filter((t) => !t.archived_at)

    let templates: CheckinTemplate[] = []
    const questionsByTemplate = new Map<string, CheckinQuestion[]>()

    if (active.length > 0) {
      for (const t of active) {
        const qs = await db.getCheckinQuestions(t.id)
        questionsByTemplate.set(t.id, qs)
      }
      // Templates already exist in the DB — don't re-import them.
      templates = []
    } else {
      templates = [FALLBACK_TEMPLATE.template]
      questionsByTemplate.set(FALLBACK_TEMPLATE.template.id, FALLBACK_TEMPLATE.questions)
    }

    const scheduleMeta =
      active.length > 0
        ? active.map((t) => ({ id: t.id, schedule_type: t.schedule_type }))
        : [{ id: FALLBACK_TEMPLATE.template.id, schedule_type: 'DAILY' as const }]

    const checkin_responses = buildCheckinResponses(scheduleMeta, questionsByTemplate)

    const payload: HabitatExport = {
      version: 1,
      exported_at: now,
      habits,
      completions,
      habit_logs,
      habit_schedules: schedules,
      checkin_templates: templates,
      checkin_questions: templates.length > 0 ? FALLBACK_TEMPLATE.questions : [],
      checkin_responses,
      reminders: [],
      checkin_reminders: [],
      scribbles: [],
      checkin_entries: [],
      bored_categories: [],
      bored_activities: [],
      todos: [],
    }

    await db.importJson(payload)

    return {
      habits: habits.length,
      completions: completions.length,
      habit_logs: habit_logs.length,
      checkin_responses: checkin_responses.length,
    }
  }

  return { seedInsightsData }
}
