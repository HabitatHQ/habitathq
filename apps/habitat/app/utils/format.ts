import { formatTime } from '~/composables/useAppSettings'

/**
 * Format an ISO timestamp as a human-readable date+time string.
 * Shows "Today" / "Yesterday" relative labels; time respects 12h/24h preference.
 */
export function fmtDate(iso: string, use24h: boolean): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  const time = formatTime(d, use24h)
  if (sameDay(d, today)) return `Today, ${time}`
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`
  return `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d)}, ${time}`
}

/** Format an ISO timestamp as "Mon, Mar 2" (for habit log entries). */
export function fmtLogDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** Format an ISO timestamp as a locale time string (for habit log entries). */
export function fmtLogTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Format an ISO timestamp as "Mar 2, 2024" (archive/history display). */
export function fmtArchived(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** "Today" for the current date, otherwise abbreviated weekday (e.g. "Mon"). */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
}

/** Short date string, e.g. "Mar 2". */
export function dayNum(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/** Format a duration in whole seconds as `m:ss`. */
export function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Human-readable relative time (e.g. "3m ago", "2d ago"). */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
