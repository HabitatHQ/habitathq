/** Returns a YYYY-MM-DD string from a Date (local time, no timezone shift) */
export function localDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parse a YYYY-MM-DD string without timezone shifting */
export function parseDateString(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y!, (m! - 1)!, d!)
}

/** Format a YYYY-MM-DD (or null/undefined) as human-readable "March 15, 2024" */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = parseDateString(dateStr)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Format a YYYY-MM-DD relative to today:
 * - "Today" / "Yesterday" / "Tomorrow"
 * - "in Nd" / "Nd ago" for within 7 days
 * - Short date otherwise
 */
export function formatDateRelative(dateStr: string, today: string): string {
  if (dateStr === today) return 'Today'

  const d = parseDateString(dateStr)
  const t = parseDateString(today)
  const diffMs = d.getTime() - t.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === -1) return 'Yesterday'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays > 0 && diffDays <= 7) return `in ${diffDays}d`
  if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)}d ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Format an ISO timestamp as a relative time string:
 * "just now", "X min ago", "X h ago", "X days ago"
 */
export function formatRelativeTime(isoTimestamp: string): string {
  const diff = Date.now() - new Date(isoTimestamp).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours} h ago`
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Format a duration in minutes as "45 min", "1 h", "1 h 30 min" */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}
