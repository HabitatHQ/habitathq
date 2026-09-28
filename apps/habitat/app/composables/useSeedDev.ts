import type {
  CheckinQuestion,
  CheckinResponse,
  CheckinTemplate,
  Completion,
  FocusSession,
  Habit,
  HabitatExport,
  HabitLog,
  HabitSchedule,
  Scribble,
  Todo,
} from '~/types/database'

/**
 * Development-only demo data. Stable ids make this safe to load repeatedly:
 * importJson uses INSERT OR IGNORE, so a developer never gets duplicate rows.
 */
function dateAt(offset: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

function timestamp(date: string, time = '09:00:00'): string {
  return `${date}T${time}.000Z`
}

function demoHabits(createdAt: string): { habits: Habit[]; schedules: HabitSchedule[] } {
  const habits: Habit[] = [
    {
      id: 'demo-habit-meditate',
      name: 'Meditate',
      description: 'A short daily reset.',
      why: 'Start the day calmly.',
      color: '#8b5cf6',
      icon: 'flower-lotus',
      frequency: 'daily',
      created_at: createdAt,
      archived_at: null,
      tags: ['wellbeing'],
      annotations: {},
      type: 'BOOLEAN',
      target_value: 1,
      paused_until: null,
    },
    {
      id: 'demo-habit-read',
      name: 'Read',
      description: 'Read for at least 20 minutes.',
      why: 'Make space for learning.',
      color: '#3b82f6',
      icon: 'book-open',
      frequency: 'daily',
      created_at: createdAt,
      archived_at: null,
      tags: ['learning'],
      annotations: {},
      type: 'NUMERIC',
      target_value: 20,
      paused_until: null,
    },
    {
      id: 'demo-habit-workout',
      name: 'Workout',
      description: 'Move on Monday, Wednesday, and Friday.',
      why: 'Keep energy high.',
      color: '#ef4444',
      icon: 'barbell',
      frequency: 'three times weekly',
      created_at: createdAt,
      archived_at: null,
      tags: ['health/exercise'],
      annotations: {},
      type: 'BOOLEAN',
      target_value: 1,
      paused_until: null,
    },
    {
      id: 'demo-habit-water',
      name: 'Drink water',
      description: 'Eight glasses across the day.',
      why: 'Feel more alert.',
      color: '#06b6d4',
      icon: 'water-drop',
      frequency: 'daily',
      created_at: createdAt,
      archived_at: null,
      tags: ['health'],
      annotations: {},
      type: 'NUMERIC',
      target_value: 8,
      paused_until: null,
    },
  ]
  const schedules: HabitSchedule[] = [
    {
      id: 'demo-schedule-meditate',
      habit_id: 'demo-habit-meditate',
      schedule_type: 'DAILY',
      frequency_count: null,
      days_of_week: null,
      due_time: '07:30',
      start_date: null,
      end_date: null,
    },
    {
      id: 'demo-schedule-read',
      habit_id: 'demo-habit-read',
      schedule_type: 'DAILY',
      frequency_count: null,
      days_of_week: null,
      due_time: '21:00',
      start_date: null,
      end_date: null,
    },
    {
      id: 'demo-schedule-workout',
      habit_id: 'demo-habit-workout',
      schedule_type: 'SPECIFIC_DAYS',
      frequency_count: null,
      days_of_week: [1, 3, 5],
      due_time: '18:00',
      start_date: null,
      end_date: null,
    },
    {
      id: 'demo-schedule-water',
      habit_id: 'demo-habit-water',
      schedule_type: 'DAILY',
      frequency_count: null,
      days_of_week: null,
      due_time: null,
      start_date: null,
      end_date: null,
    },
  ]
  return { habits, schedules }
}

function demoHistory(): { completions: Completion[]; habit_logs: HabitLog[] } {
  const completions: Completion[] = []
  const habit_logs: HabitLog[] = []
  for (let offset = -45; offset <= 0; offset++) {
    const date = dateAt(offset)
    if (offset % 5 !== 0) {
      completions.push({
        id: `demo-completion-meditate-${date}`,
        habit_id: 'demo-habit-meditate',
        date,
        completed_at: timestamp(date, '07:45:00'),
        notes: '',
        tags: ['wellbeing'],
        annotations: {},
      })
    }
    if (offset % 4 !== 0) {
      habit_logs.push({
        id: `demo-log-read-${date}`,
        habit_id: 'demo-habit-read',
        date,
        logged_at: timestamp(date, '21:20:00'),
        value: 20 + ((offset + 45) % 4) * 5,
        notes: '',
      })
    }
    if (offset % 3 !== 0) {
      habit_logs.push({
        id: `demo-log-water-${date}`,
        habit_id: 'demo-habit-water',
        date,
        logged_at: timestamp(date, '17:00:00'),
        value: 7 + ((offset + 45) % 3),
        notes: '',
      })
    }
  }
  return { completions, habit_logs }
}

function demoTodos(createdAt: string): Todo[] {
  const make = (
    id: string,
    title: string,
    dueDate: string | null,
    scheduledTime: string | null,
    minutes: number | null,
    priority: Todo['priority'],
    extra: Partial<Todo> = {},
  ): Todo => ({
    id,
    title,
    description: '',
    due_date: dueDate,
    scheduled_time: scheduledTime,
    priority,
    estimated_minutes: minutes,
    is_done: false,
    done_at: null,
    done_count: 0,
    last_done_at: null,
    tags: ['work'],
    annotations: {},
    is_recurring: false,
    recurrence_rule: null,
    show_in_bored: false,
    bored_category_id: null,
    archived_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...extra,
  })
  const yesterday = dateAt(-1)
  return [
    make('demo-todo-standup', 'Prepare project stand-up', dateAt(0), '09:30', 30, 'high'),
    make('demo-todo-deep-work', 'Write product brief', dateAt(0), '10:30', 90, 'high'),
    make('demo-todo-review', 'Review design feedback', dateAt(0), '14:30', 45, 'medium'),
    make('demo-todo-groceries', 'Pick up groceries', dateAt(1), '18:30', 30, 'low', {
      tags: ['personal'],
    }),
    make('demo-todo-recur', 'Plan tomorrow', dateAt(0), '17:30', 20, 'medium', {
      is_recurring: true,
      recurrence_rule: 'daily',
    }),
    make('demo-todo-backlog', 'Research a new habit idea', null, null, null, 'low', {
      tags: ['learning'],
    }),
    make('demo-todo-finished', 'Clear inbox', yesterday, '16:00', 25, 'medium', {
      is_done: true,
      done_at: timestamp(yesterday, '16:25:00'),
      done_count: 1,
      last_done_at: timestamp(yesterday, '16:25:00'),
    }),
  ]
}

function demoNotes(createdAt: string): Scribble[] {
  return [
    {
      id: 'demo-note-today',
      title: 'Today’s intention',
      content: 'Protect the deep-work block and leave enough room for a walk.',
      tags: ['wellbeing'],
      annotations: {},
      entry_date: dateAt(0),
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: 'demo-note-tomorrow',
      title: 'Dinner idea',
      content: 'Try the new lentil bowl recipe after groceries.',
      tags: ['personal'],
      annotations: {},
      entry_date: dateAt(1),
      created_at: createdAt,
      updated_at: createdAt,
    },
  ]
}

function demoCheckins(): {
  templates: CheckinTemplate[]
  questions: CheckinQuestion[]
  responses: CheckinResponse[]
} {
  const templates: CheckinTemplate[] = [
    {
      id: 'demo-checkin-evening',
      title: 'Evening reflection',
      schedule_type: 'DAILY',
      days_active: null,
      icon: 'moon',
      color: '#8b5cf6',
      archived_at: null,
    },
  ]
  const questions: CheckinQuestion[] = [
    {
      id: 'demo-question-mood',
      template_id: 'demo-checkin-evening',
      prompt: 'How was your mood?',
      response_type: 'SCALE',
      display_order: 0,
      desired_answer: 8,
      archived_at: null,
    },
    {
      id: 'demo-question-win',
      template_id: 'demo-checkin-evening',
      prompt: 'What went well?',
      response_type: 'TEXT',
      display_order: 1,
      desired_answer: 1,
      archived_at: null,
    },
  ]
  const responses: CheckinResponse[] = []
  for (let offset = -14; offset <= 0; offset++) {
    const date = dateAt(offset)
    if (offset % 4 === 0) continue
    responses.push({
      id: `demo-response-mood-${date}`,
      question_id: 'demo-question-mood',
      logged_date: date,
      value_numeric: 6 + ((offset + 14) % 4),
      value_text: null,
    })
    responses.push({
      id: `demo-response-win-${date}`,
      question_id: 'demo-question-win',
      logged_date: date,
      value_numeric: null,
      value_text: 'Made steady progress on the work that matters.',
    })
  }
  return { templates, questions, responses }
}

export function useSeedDev() {
  const db = useDatabase()

  async function seedDemoData(): Promise<{ habits: number; todos: number; notes: number }> {
    const createdAt = new Date().toISOString()
    const { habits, schedules } = demoHabits(createdAt)
    const { completions, habit_logs } = demoHistory()
    const todos = demoTodos(createdAt)
    const { templates, questions, responses } = demoCheckins()
    const focus_sessions: FocusSession[] = [
      {
        id: 'demo-focus-finished',
        todo_id: 'demo-todo-finished',
        started_at: timestamp(dateAt(-1), '16:00:00'),
        completed_at: timestamp(dateAt(-1), '16:25:00'),
        duration_seconds: 1500,
      },
    ]
    const payload: HabitatExport = {
      version: 1,
      exported_at: createdAt,
      habits,
      completions,
      habit_logs,
      habit_schedules: schedules,
      checkin_templates: templates,
      checkin_questions: questions,
      checkin_responses: responses,
      reminders: [],
      checkin_reminders: [],
      scribbles: demoNotes(createdAt),
      checkin_entries: [],
      bored_categories: [],
      bored_activities: [],
      todos,
      focus_sessions,
    }
    await db.importJson(payload)
    return { habits: habits.length, todos: todos.length, notes: payload.scribbles.length }
  }

  return { seedDemoData }
}
