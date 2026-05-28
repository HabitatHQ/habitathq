import type { JotItem } from '~/composables/useJotsStore'

export interface JotSection {
  label: string
  items: JotItem[]
}

export function getJotDate(item: JotItem): string {
  return item.kind === 'text' ? item.data.updated_at : item.data.created_at
}

/**
 * Groups jots into date-based sections:
 * Today, Last 7 Days, Last 30 Days, then by month name.
 * Months in a different year than `now` include the year suffix.
 * Empty sections are excluded.
 */
export function groupJotsByDate(items: JotItem[], now: Date = new Date()): JotSection[] {
  const today = startOfDay(now)
  const sevenDaysAgo = addDays(today, -7)
  const thirtyDaysAgo = addDays(today, -30)
  const currentYear = now.getFullYear()

  const todayItems: JotItem[] = []
  const last7Items: JotItem[] = []
  const last30Items: JotItem[] = []
  const monthMap = new Map<string, { label: string; items: JotItem[] }>()

  for (const item of items) {
    const d = new Date(getJotDate(item))
    const itemDay = startOfDay(d)

    if (itemDay.getTime() >= today.getTime()) {
      todayItems.push(item)
    } else if (itemDay.getTime() >= sevenDaysAgo.getTime()) {
      last7Items.push(item)
    } else if (itemDay.getTime() >= thirtyDaysAgo.getTime()) {
      last30Items.push(item)
    } else {
      const year = d.getFullYear()
      const monthName = d.toLocaleString('default', { month: 'long' })
      const label = year === currentYear ? monthName : `${monthName} ${year}`
      const key = `${year}-${String(d.getMonth()).padStart(2, '0')}`
      let bucket = monthMap.get(key)
      if (!bucket) {
        bucket = { label, items: [] }
        monthMap.set(key, bucket)
      }
      bucket.items.push(item)
    }
  }

  const sections: JotSection[] = []
  if (todayItems.length > 0) sections.push({ label: 'Today', items: todayItems })
  if (last7Items.length > 0) sections.push({ label: 'Last 7 Days', items: last7Items })
  if (last30Items.length > 0) sections.push({ label: 'Last 30 Days', items: last30Items })

  const sortedKeys = [...monthMap.keys()].sort((a, b) => b.localeCompare(a))
  for (const key of sortedKeys) {
    const bucket = monthMap.get(key)
    if (bucket) sections.push({ label: bucket.label, items: bucket.items })
  }

  return sections
}

/**
 * Groups jots by their tags. Text jots appear under each tag.
 * Voice/image jots and untagged text jots appear in "Untagged" at the bottom.
 */
export function groupJotsByTags(items: JotItem[]): JotSection[] {
  const tagBuckets = new Map<string, JotItem[]>()
  const untagged: JotItem[] = []

  for (const item of items) {
    if (item.kind === 'text' && item.data.tags.length > 0) {
      for (const tag of item.data.tags) {
        let arr = tagBuckets.get(tag)
        if (!arr) {
          arr = []
          tagBuckets.set(tag, arr)
        }
        arr.push(item)
      }
    } else {
      untagged.push(item)
    }
  }

  const sections: JotSection[] = []
  const sortedTags = [...tagBuckets.keys()].sort((a, b) => a.localeCompare(b))
  for (const tag of sortedTags) {
    const items = tagBuckets.get(tag)
    if (items) sections.push({ label: tag, items })
  }
  if (untagged.length > 0) sections.push({ label: 'Untagged', items: untagged })

  return sections
}

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
