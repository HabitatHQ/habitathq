import type { Contact, ContactFieldWithType } from '~/types/database'

// ─── vCard type detection ─────────────────────────────────────────────────────

export function vCardEmailType(prop: string): string {
  return 'Email'
}

export function vCardPhoneType(prop: string): string {
  return 'Phone'
}

// ─── contactToVCard ───────────────────────────────────────────────────────────

export function contactToVCard(contact: Contact, fields: ContactFieldWithType[]): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0']

  const fn = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
  lines.push(`FN:${fn}`)
  lines.push(`N:${contact.last_name ?? ''};${contact.first_name ?? ''};;;`)

  if (contact.nickname) lines.push(`NICKNAME:${contact.nickname}`)
  if (contact.birthday) lines.push(`BDAY:${contact.birthday}`)

  for (const field of fields) {
    const proto = field.type?.protocol ?? ''
    if (proto === 'mailto:') {
      lines.push(`EMAIL;TYPE=internet:${field.value}`)
    } else if (proto === 'tel:') {
      lines.push(`TEL;TYPE=cell:${field.value}`)
    } else {
      lines.push(`X-CUSTOM;TYPE=${field.type?.name ?? 'other'}:${field.value}`)
    }
  }

  lines.push('END:VCARD')
  return lines.join('\n')
}

// ─── parseVCardBlock ──────────────────────────────────────────────────────────

interface ParsedVCard {
  first_name: string
  last_name: string
  nickname: string
  birthday: string | null
  fields: Array<{ value: string; typeName: string; label: string }>
}

export function parseVCardBlock(block: string): ParsedVCard {
  const result: ParsedVCard = {
    first_name: '',
    last_name: '',
    nickname: '',
    birthday: null,
    fields: [],
  }

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (!line || line === 'BEGIN:VCARD' || line === 'END:VCARD') continue

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const prop = line.slice(0, colonIdx)
    const value = line.slice(colonIdx + 1)

    const propBase = prop.split(';')[0].toUpperCase()

    if (propBase === 'N') {
      const parts = value.split(';')
      result.last_name = parts[0]?.trim() ?? ''
      result.first_name = parts[1]?.trim() ?? ''
      // If FN already set first_name but N has it too, N wins
    } else if (propBase === 'FN') {
      // Use as fallback for first_name if N not parsed yet
      if (!result.first_name && !result.last_name) {
        const nameParts = value.trim().split(' ')
        result.first_name = nameParts[0] ?? ''
        result.last_name = nameParts.slice(1).join(' ')
      }
    } else if (propBase === 'NICKNAME') {
      result.nickname = value.trim()
    } else if (propBase === 'BDAY') {
      result.birthday = value.trim() || null
    } else if (propBase === 'EMAIL') {
      result.fields.push({ value: value.trim(), typeName: vCardEmailType(prop), label: 'email' })
    } else if (propBase === 'TEL') {
      result.fields.push({ value: value.trim(), typeName: vCardPhoneType(prop), label: 'phone' })
    }
  }

  // Ensure first_name is populated from FN if N gave empty first_name
  return result
}
