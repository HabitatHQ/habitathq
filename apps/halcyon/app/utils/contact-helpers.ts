import type { Contact, StayInTouch } from '~/types/database'

/** Full display name: "First "Nick" Last" */
export function contactDisplayName(contact: Contact): string {
  const { first_name, last_name, nickname } = contact
  const hasName = first_name || last_name
  if (!hasName) return nickname || ''

  const nick = nickname ? ` "${nickname}"` : ''
  const parts = [first_name, last_name].filter(Boolean)
  return parts.join(nick ? `${nick} ` : ' ').replace(/ +/g, ' ').trim()
}

// Simpler rebuild: first + nick + last
export function contactDisplayNameFull(contact: Contact): string {
  const { first_name, last_name, nickname } = contact
  const hasName = first_name || last_name
  if (!hasName && nickname) return nickname
  if (!hasName && !nickname) return ''

  const parts: string[] = []
  if (first_name) parts.push(first_name)
  if (nickname) parts.push(`"${nickname}"`)
  if (last_name) parts.push(last_name)
  return parts.join(' ')
}

/** Two-letter initials for avatar placeholder */
export function contactInitials(contact: Contact): string {
  const { first_name, last_name, nickname } = contact
  if (!first_name && !last_name) {
    return nickname ? nickname[0]!.toUpperCase() : '?'
  }
  const a = first_name ? first_name[0]!.toUpperCase() : ''
  const b = last_name ? last_name[0]!.toUpperCase() : ''
  return a + b
}

/** Sort key: "last first" lowercased */
export function contactSortKey(contact: Contact): string {
  const { first_name, last_name } = contact
  if (!last_name) return first_name.toLowerCase()
  return `${last_name} ${first_name}`.toLowerCase().trim()
}

/** True when stay-in-touch is due today or past */
export function isContactOverdue(sit: StayInTouch, today: string): boolean {
  return sit.next_remind_at <= today
}

/** Days until next contact is due (negative = overdue) */
export function stayInTouchDaysUntilDue(sit: StayInTouch, today: string): number {
  const due = new Date(sit.next_remind_at)
  const now = new Date(today)
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}
