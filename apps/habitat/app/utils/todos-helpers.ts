import type { Todo } from '~/types/database'

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
