import type { Contact, ContactFieldWithType } from '~/types/database'

// JSContact Card (RFC 9553)
// https://www.rfc-editor.org/rfc/rfc9553

export interface JSContactCard {
  '@type': 'Card'
  version: '1.0'
  uid?: string
  name?: {
    full?: string
    components?: Array<{ kind: string; value: string }>
  }
  nicknames?: Record<string, { name: string }>
  anniversaries?: Record<string, { kind: string; date?: { calendarDate?: string } }>
  emails?: Record<string, { address: string; contexts?: Record<string, boolean> }>
  phones?: Record<string, { number: string; contexts?: Record<string, boolean> }>
  online?: Record<string, { uri: string; label?: string }>
  notes?: string
  [key: string]: unknown
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function contactToJSContact(
  contact: Contact,
  fields: ContactFieldWithType[],
): JSContactCard {
  const card: JSContactCard = {
    '@type': 'Card',
    version: '1.0',
    uid: contact.id,
  }

  // Name
  const nameParts: Array<{ kind: string; value: string }> = []
  if (contact.first_name) nameParts.push({ kind: 'given', value: contact.first_name })
  if (contact.middle_name) nameParts.push({ kind: 'middle', value: contact.middle_name })
  if (contact.last_name) nameParts.push({ kind: 'surname', value: contact.last_name })
  if (contact.nickname && !contact.first_name && !contact.last_name) {
    nameParts.push({ kind: 'given', value: contact.nickname })
  }

  const full = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
  card.name = { full: full || contact.nickname || '', components: nameParts }

  // Nickname
  if (contact.nickname) {
    card.nicknames = { n1: { name: contact.nickname } }
  }

  // Birthday
  if (contact.birthday) {
    card.anniversaries = {
      a1: { kind: 'birth', date: { calendarDate: contact.birthday } },
    }
  }

  // Fields → emails / phones / online
  let emailIdx = 0
  let phoneIdx = 0
  let onlineIdx = 0

  for (const field of fields) {
    const proto = field.type?.protocol ?? ''
    if (proto === 'mailto:') {
      if (!card.emails) card.emails = {}
      card.emails[`e${++emailIdx}`] = { address: field.value }
    } else if (proto === 'tel:') {
      if (!card.phones) card.phones = {}
      card.phones[`p${++phoneIdx}`] = { number: field.value }
    } else {
      if (!card.online) card.online = {}
      card.online[`u${++onlineIdx}`] = { uri: field.value, label: field.type?.name }
    }
  }

  return card
}

// ─── Import ───────────────────────────────────────────────────────────────────

interface ParsedJSContact {
  first_name: string
  last_name: string
  nickname: string
  birthday: string | null
  fields: Array<{ value: string; label: string }>
}

export function parseJSContact(card: Record<string, unknown>): ParsedJSContact {
  const result: ParsedJSContact = {
    first_name: '',
    last_name: '',
    nickname: '',
    birthday: null,
    fields: [],
  }

  // Name
  const name = card['name'] as JSContactCard['name'] | undefined
  if (name) {
    const components = name.components ?? []
    const given = components.find((c) => c.kind === 'given')?.value ?? ''
    const surname = components.find((c) => c.kind === 'surname')?.value ?? ''

    if (given || surname) {
      result.first_name = given
      result.last_name = surname
    } else if (name.full) {
      // Fall back to splitting full name
      const parts = name.full.trim().split(/\s+/)
      result.first_name = parts[0] ?? ''
      result.last_name = parts.slice(1).join(' ')
    }
  }

  // Nickname
  const nicknames = card['nicknames'] as Record<string, { name: string }> | undefined
  if (nicknames) {
    const first = Object.values(nicknames)[0]
    if (first) result.nickname = first.name
  }

  // Birthday
  const anniversaries = card['anniversaries'] as JSContactCard['anniversaries'] | undefined
  if (anniversaries) {
    for (const ann of Object.values(anniversaries)) {
      if (ann.kind === 'birth' && ann.date?.calendarDate) {
        result.birthday = ann.date.calendarDate
        break
      }
    }
  }

  // Emails
  const emails = card['emails'] as JSContactCard['emails'] | undefined
  if (emails) {
    for (const e of Object.values(emails)) {
      if (e.address) result.fields.push({ value: e.address, label: 'email' })
    }
  }

  // Phones
  const phones = card['phones'] as JSContactCard['phones'] | undefined
  if (phones) {
    for (const p of Object.values(phones)) {
      if (p.number) result.fields.push({ value: p.number, label: 'phone' })
    }
  }

  return result
}
