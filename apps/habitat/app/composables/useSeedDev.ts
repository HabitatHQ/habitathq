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

/**
 * Performance profile for a habit's generated history. The "slipping" and
 * "struggling" profiles deliberately keep the recent ~2-week window mostly
 * missed (and never done today) so the habit trips the Today page's
 * "Needs attention" detector (isStruggling: rate < 0.3 over ≥7 scheduled days).
 * "slipping" pairs that recent slump with a strong older history, so it also
 * exercises plant regression in the garden.
 */
type Profile = 'thriving' | 'steady' | 'building' | 'slipping' | 'struggling'
type Sched = 'DAILY' | 'SPECIFIC_DAYS' | 'WEEKLY_FLEX'

interface HabitSpec {
  id: string
  name: string
  icon: string
  color: string
  type: Habit['type']
  target_value: number
  tags: string[]
  profile: Profile
  schedule: Sched
  /** SPECIFIC_DAYS: scheduled days. WEEKLY_FLEX: the days activity tends to land. */
  daysOfWeek?: number[]
  /** WEEKLY_FLEX target days per week. */
  frequencyCount?: number
}

const HABIT_SPECS: HabitSpec[] = [
  // ── Healthy: variety of types + schedules ──────────────────────────────────
  {
    id: 'seed-h-meditate',
    name: 'Meditate',
    icon: 'flower-lotus',
    color: '#8b5cf6',
    type: 'BOOLEAN',
    target_value: 1,
    tags: ['wellbeing'],
    profile: 'thriving',
    schedule: 'DAILY',
  },
  {
    id: 'seed-h-water',
    name: 'Drink water',
    icon: 'water-drop',
    color: '#06b6d4',
    type: 'NUMERIC',
    target_value: 8,
    tags: ['health'],
    profile: 'thriving',
    schedule: 'DAILY',
  },
  {
    id: 'seed-h-read',
    name: 'Read pages',
    icon: 'book-open',
    color: '#3b82f6',
    type: 'NUMERIC',
    target_value: 20,
    tags: ['learning'],
    profile: 'steady',
    schedule: 'DAILY',
  },
  {
    id: 'seed-h-steps',
    name: 'Walk 8k steps',
    icon: 'sneaker',
    color: '#22c55e',
    type: 'NUMERIC',
    target_value: 8000,
    tags: ['health'],
    profile: 'steady',
    schedule: 'DAILY',
  },
  {
    id: 'seed-h-screen',
    name: 'Screen time',
    icon: 'clock',
    color: '#f59e0b',
    type: 'LIMIT',
    target_value: 2,
    tags: ['wellbeing'],
    profile: 'steady',
    schedule: 'DAILY',
  },
  {
    id: 'seed-h-workout',
    name: 'Workout',
    icon: 'barbell',
    color: '#ef4444',
    type: 'BOOLEAN',
    target_value: 1,
    tags: ['health/exercise'],
    profile: 'steady',
    schedule: 'SPECIFIC_DAYS',
    daysOfWeek: [1, 3, 5], // Mon/Wed/Fri
  },
  {
    id: 'seed-h-run',
    name: 'Go for a run',
    icon: 'running',
    color: '#10b981',
    type: 'BOOLEAN',
    target_value: 1,
    tags: ['health/exercise'],
    profile: 'steady',
    schedule: 'WEEKLY_FLEX',
    frequencyCount: 3,
    daysOfWeek: [2, 4, 6], // tends to run Tue/Thu/Sat
  },
  {
    id: 'seed-h-journal',
    name: 'Journal',
    icon: 'notebook',
    color: '#14b8a6',
    type: 'BOOLEAN',
    target_value: 1,
    tags: ['wellbeing'],
    profile: 'building', // ramps up over time
    schedule: 'DAILY',
  },
  // ── Needs attention: recent slump, not done today ─────────────────────────
  {
    id: 'seed-h-stretch',
    name: 'Stretch',
    icon: 'stretching',
    color: '#f43f5e',
    type: 'BOOLEAN',
    target_value: 1,
    tags: ['health/exercise'],
    profile: 'struggling',
    schedule: 'DAILY',
  },
  {
    id: 'seed-h-floss',
    name: 'Floss',
    icon: 'tooth',
    color: '#38bdf8',
    type: 'BOOLEAN',
    target_value: 1,
    tags: ['health'],
    profile: 'slipping',
    schedule: 'DAILY',
  },
  {
    id: 'seed-h-guitar',
    name: 'Practice guitar',
    icon: 'guitar',
    color: '#a855f7',
    type: 'NUMERIC',
    target_value: 30,
    tags: ['hobbies'],
    profile: 'struggling',
    schedule: 'DAILY',
  },
  {
    id: 'seed-h-junk',
    name: 'No junk food',
    icon: 'apple',
    color: '#84cc16',
    type: 'LIMIT',
    target_value: 1,
    tags: ['health'],
    profile: 'slipping',
    schedule: 'DAILY',
  },
]

function scheduleRow(spec: HabitSpec): HabitSchedule {
  return {
    id: `${spec.id}-sched`,
    habit_id: spec.id,
    schedule_type: spec.schedule,
    frequency_count: spec.frequencyCount ?? null,
    days_of_week: spec.schedule === 'SPECIFIC_DAYS' ? (spec.daysOfWeek ?? null) : null,
    due_time: null,
    start_date: null,
    end_date: null,
  }
}

function buildHabits(): { habits: Habit[]; schedules: HabitSchedule[] } {
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
    schedules.push(scheduleRow(spec))
  }
  return { habits, schedules }
}

// ─── Per-day history generation ─────────────────────────────────────────────────

const ATTENTION: ReadonlySet<Profile> = new Set<Profile>(['slipping', 'struggling'])

/** Whether the habit's schedule means activity can land on this weekday. */
function isGenDay(spec: HabitSpec, dow: number): boolean {
  if (spec.schedule === 'DAILY') return true
  return (spec.daysOfWeek ?? []).includes(dow)
}

/** Decide if a scheduled day was a "hit" for the given profile. `daysAgo` 0 = today. */
function profileHit(profile: Profile, daysAgo: number, rng: () => number): boolean {
  if (ATTENTION.has(profile)) {
    if (daysAgo === 0) return false // never done today → surfaces in Needs attention
    if (daysAgo <= 18) return daysAgo % 9 === 0 // sparse recent hits → rate well under 0.3
    return rng() < (profile === 'slipping' ? 0.85 : 0.45)
  }
  if (profile === 'thriving') return rng() < 0.92
  if (profile === 'steady') return rng() < 0.72
  const recency = 1 - daysAgo / HORIZON_DAYS // building: ramps up toward today
  return rng() < 0.2 + recency * 0.7
}

function numericMet(target: number, rng: () => number): number {
  return Math.max(1, Math.round(target * (1 + rng() * 0.4)))
}
function numericPartial(target: number, rng: () => number): number {
  return Math.max(1, Math.round(target * (0.3 + rng() * 0.45)))
}
function limitUnder(target: number, rng: () => number): number {
  return Math.round(target * (0.3 + rng() * 0.65) * 10) / 10
}
function limitOver(target: number, rng: () => number): number {
  return Math.round(target * (1.3 + rng() * 0.9) * 10) / 10
}

interface History {
  completions: Completion[]
  habit_logs: HabitLog[]
}

function emitDay(
  spec: HabitSpec,
  date: string,
  daysAgo: number,
  hit: boolean,
  rng: () => number,
  out: History,
): void {
  // Attention habits stay completely inactive today so they aren't filtered out.
  if (daysAgo === 0 && ATTENTION.has(spec.profile)) return
  const at = `${date}T20:00:00.000Z`
  const log = (value: number) =>
    out.habit_logs.push({
      id: `seed-l-${spec.id}-${date}`,
      habit_id: spec.id,
      date,
      logged_at: at,
      value,
      notes: '',
    })

  if (spec.type === 'BOOLEAN') {
    if (hit)
      out.completions.push({
        id: `seed-c-${spec.id}-${date}`,
        habit_id: spec.id,
        date,
        completed_at: at,
        notes: '',
        tags: [],
        annotations: {},
      })
    return
  }
  if (spec.type === 'NUMERIC') {
    if (hit) log(numericMet(spec.target_value, rng))
    // Occasional below-target days (only for healthy habits, away from the recent
    // window) add "partial" variety without disturbing struggle detection.
    else if (!ATTENTION.has(spec.profile) && daysAgo > 20 && rng() < 0.25)
      log(numericPartial(spec.target_value, rng))
    return
  }
  // LIMIT — "stay under". Hit = logged under the cap; a slump logs over the cap.
  if (hit) log(limitUnder(spec.target_value, rng))
  else if (spec.profile === 'slipping' || rng() < 0.4) log(limitOver(spec.target_value, rng))
}

function buildHabitHistory(): History {
  const out: History = { completions: [], habit_logs: [] }
  const dates = recentDates(HORIZON_DAYS)
  for (const spec of HABIT_SPECS) {
    const rng = makeRng(hashSeed(spec.id))
    dates.forEach((date, daysAgo) => {
      if (!isGenDay(spec, dowOf(date))) return
      emitDay(spec, date, daysAgo, profileHit(spec.profile, daysAgo, rng), rng, out)
    })
  }
  return out
}

// ─── Check-in definitions (used only when no templates exist yet) ───────────────────

interface SeedTemplate {
  template: CheckinTemplate
  questions: CheckinQuestion[]
}

/** Compact spec → fully-formed template + questions with stable IDs. */
function makeTemplate(
  id: string,
  title: string,
  schedule_type: CheckinTemplate['schedule_type'],
  days_active: number[] | null,
  qs: [slug: string, prompt: string, type: CheckinQuestion['response_type'], desired?: number][],
): SeedTemplate {
  return {
    template: { id, title, schedule_type, days_active, archived_at: null },
    questions: qs.map(([slug, prompt, response_type, desired], i) => ({
      id: `${id}-${slug}`,
      template_id: id,
      prompt,
      response_type,
      display_order: i,
      desired_answer: desired ?? 1,
      archived_at: null,
    })),
  }
}

/**
 * Templates seeded only when the DB has none (e.g. after a wipe). On a normal
 * install the app's default templates already exist and we attach to those.
 * Covers a daily reflection, a morning check-in, and a weekly review so every
 * response type (SCALE / BOOLEAN / TEXT) and cadence is represented.
 */
const FALLBACK_TEMPLATES: SeedTemplate[] = [
  makeTemplate('seed-ct-morning', 'Morning Check-in', 'DAILY', null, [
    ['sleep', 'How did you sleep?', 'SCALE'],
    ['energy', 'How is your energy level?', 'SCALE'],
    ['anxious', 'Are you feeling anxious?', 'BOOLEAN', 0],
    ['intention', "What's your intention for today?", 'TEXT'],
  ]),
  makeTemplate('seed-ct-evening', 'Evening Reflection', 'DAILY', null, [
    ['mood', 'Overall mood today (1–10)?', 'SCALE'],
    ['productive', 'Did you have a productive day?', 'BOOLEAN'],
    ['win', 'What went well today?', 'TEXT'],
    ['better', 'What could have gone better?', 'TEXT'],
  ]),
  makeTemplate(
    'seed-ct-weekly',
    'Weekly Review',
    'WEEKLY',
    [0],
    [
      ['rating', 'How would you rate this week (1–10)?', 'SCALE'],
      ['wins', 'What were your biggest wins?', 'TEXT'],
      ['focus', 'What will you focus on next week?', 'TEXT'],
    ],
  ),
]

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

    const { habits, schedules } = buildHabits()
    const { completions, habit_logs } = buildHabitHistory()

    // Prefer attaching responses to the user's existing check-in templates so the
    // data shows up under the names they already see. Fall back to seeded
    // templates only when none exist (e.g. after a data wipe).
    const existing = await db.getCheckinTemplates()
    const active = existing.filter((t) => !t.archived_at)

    // Templates/questions to import (empty when reusing the DB's own templates).
    let newTemplates: CheckinTemplate[] = []
    let newQuestions: CheckinQuestion[] = []
    const questionsByTemplate = new Map<string, CheckinQuestion[]>()
    let scheduleMeta: { id: string; schedule_type: CheckinTemplate['schedule_type'] }[]

    if (active.length > 0) {
      for (const t of active) {
        questionsByTemplate.set(t.id, await db.getCheckinQuestions(t.id))
      }
      scheduleMeta = active.map((t) => ({ id: t.id, schedule_type: t.schedule_type }))
    } else {
      newTemplates = FALLBACK_TEMPLATES.map((t) => t.template)
      newQuestions = FALLBACK_TEMPLATES.flatMap((t) => t.questions)
      for (const t of FALLBACK_TEMPLATES) questionsByTemplate.set(t.template.id, t.questions)
      scheduleMeta = FALLBACK_TEMPLATES.map((t) => ({
        id: t.template.id,
        schedule_type: t.template.schedule_type,
      }))
    }

    const checkin_responses = buildCheckinResponses(scheduleMeta, questionsByTemplate)

    const payload: HabitatExport = {
      version: 1,
      exported_at: now,
      habits,
      completions,
      habit_logs,
      habit_schedules: schedules,
      checkin_templates: newTemplates,
      checkin_questions: newQuestions,
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
