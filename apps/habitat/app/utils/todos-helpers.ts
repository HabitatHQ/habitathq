import type { Todo } from '~/types/database'

// ─── Priority ordering ──────────────────────────────────────────────────────

export const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** Sort todos by priority (high > medium > low), then by created_at ASC as tiebreaker. */
export function sortByPriority(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 1
    const pb = PRIORITY_ORDER[b.priority] ?? 1
    if (pa !== pb) return pa - pb
    return a.created_at.localeCompare(b.created_at)
  })
}

// ─── Form types + payload builders ───────────────────────────────────────────

export interface TodoFormState {
  title: string
  description: string
  due_date: string
  priority: 'high' | 'medium' | 'low'
  estimated_minutes: string | number
  is_recurring: boolean
  recurrence_rule: 'daily' | 'weekly' | 'monthly'
  show_in_bored: boolean
  bored_category_id: string
  tags: string[]
}

/** Returns null if valid, error message string if invalid. */
export function validateTodoForm(form: Pick<TodoFormState, 'title'>): string | null {
  if (!form.title.trim()) return 'Title is required'
  return null
}

/**
 * Transforms a raw form state into the payload shape expected by createTodo/updateTodo.
 * Pass `existingAnnotations` when editing (preserves annotations); pass null when creating.
 */
export function buildTodoPayload(
  form: TodoFormState,
  existingAnnotations: Record<string, string> | null,
) {
  const mins = form.estimated_minutes === '' ? null : Number(form.estimated_minutes)
  const tags = form.tags.map((t) => t.trim()).filter(Boolean)
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    due_date: form.due_date || null,
    priority: form.priority,
    estimated_minutes: mins,
    is_recurring: form.is_recurring,
    recurrence_rule: form.is_recurring ? form.recurrence_rule : null,
    show_in_bored: form.show_in_bored,
    bored_category_id: form.show_in_bored && form.bored_category_id ? form.bored_category_id : null,
    tags,
    annotations: existingAnnotations ? { ...existingAnnotations } : ({} as Record<string, string>),
  }
}

/** Tailwind background-color class for a todo priority level. */
export function priorityColor(p: string): string {
  if (p === 'high') return 'bg-red-500'
  if (p === 'low') return 'bg-slate-600'
  return 'bg-amber-500'
}

/**
 * Human-readable due-date label relative to `today` (YYYY-MM-DD).
 * Examples: "Today", "Tomorrow", "in 3d", "2d ago", "Mar 2".
 */
export function formatDueDate(d: string, today: string): string {
  if (d === today) return 'Today'
  const diff = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86400000)
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d ago`
  if (diff < 7) return `in ${diff}d`
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** True when a todo is not done and its due date is before `today` (YYYY-MM-DD). */
export function isOverdue(t: Todo, today: string): boolean {
  return !t.is_done && t.due_date !== null && t.due_date < today
}
