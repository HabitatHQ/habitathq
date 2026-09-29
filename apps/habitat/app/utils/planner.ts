import type { Todo } from '~/types/database'

export function plannerDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateForKey(key: string): Date {
  return new Date(`${key}T12:00:00`)
}

export function calendarDateFromQuery(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback
  return plannerDateKey(dateForKey(value)) === value ? value : fallback
}

export function startOfWeek(date: Date): Date {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  return start
}

export function daysFrom(start: Date, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start)
    date.setDate(date.getDate() + index)
    return plannerDateKey(date)
  })
}

export function calendarNotePrompt(date: string, now = new Date()): string {
  const today = plannerDateKey(now)
  if (date < today) return 'Add a note to remember what mattered'
  if (date > today) return 'Add a note to set an objective'
  return 'Add a note for this day'
}

export function expandTodoOccurrences(todo: Todo, from: string, to: string): string[] {
  if (!todo.due_date) return []
  if (!todo.is_recurring) return todo.due_date >= from && todo.due_date <= to ? [todo.due_date] : []

  const date = dateForKey(todo.due_date)
  const start = dateForKey(from)
  const end = dateForKey(to)
  const rule = todo.recurrence_rule ?? 'daily'
  const anchorDay = date.getDate()
  while (date < start) advanceOccurrence(date, rule, anchorDay)

  const occurrences: string[] = []
  while (date <= end) {
    occurrences.push(plannerDateKey(date))
    advanceOccurrence(date, rule, anchorDay)
  }
  return occurrences
}

function advanceOccurrence(
  date: Date,
  rule: NonNullable<Todo['recurrence_rule']>,
  anchorDay: number,
) {
  if (rule === 'weekly') date.setDate(date.getDate() + 7)
  else if (rule === 'monthly') {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const lastDay = new Date(year, month + 1, 0).getDate()
    date.setFullYear(year, month, Math.min(anchorDay, lastDay))
  } else date.setDate(date.getDate() + 1)
}
