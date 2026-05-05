/**
 * Shared row-to-type parser functions used by both database.worker.ts (WASM)
 * and db-native.ts (Capacitor SQLite). Every parser is a pure function that
 * maps a raw DB row to a typed domain object.
 */
import type {
  Address,
  AddressType,
  Company,
  Contact,
  ContactField,
  ContactFieldType,
  GiftNote,
  Group,
  Interaction,
  JournalEntry,
  LifeEvent,
  LifeEventType,
  Note,
  Occupation,
  Pet,
  Relationship,
  RelationshipType,
  Reminder,
  StayInTouch,
  Tag,
  Task,
  Vault,
} from '~/types/database'

// SqlRow: raw SQLite row from exec({ rowMode: 'object' }) or queryAll.
// Typed as `any` because the shape depends on the SQL query at runtime;
// the rowToX() mapping functions perform the actual type narrowing.
// Using Record<string, unknown> would trigger TS4111 at every dot-access
// under noPropertyAccessFromIndexSignature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlRow = any

/**
 * Parse a JSON string from a DB column, returning `fallback` on null, undefined,
 * or a parse error.
 */
export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (str == null) return fallback
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

// ─── Row Parsers ─────────────────────────────────────────────────────────────

export function rowToVault(r: SqlRow): Vault {
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    color: r.color as string,
    icon: r.icon as string,
    created_at: r.created_at as string,
  }
}

export function rowToContact(r: SqlRow): Contact {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    first_name: r.first_name as string,
    last_name: r.last_name as string,
    nickname: r.nickname as string,
    maiden_name: r.maiden_name as string,
    middle_name: r.middle_name as string,
    pronouns: r.pronouns as string,
    gender: r.gender as string,
    how_we_met: r.how_we_met as string,
    is_deceased: Boolean(r.is_deceased),
    deceased_at: (r.deceased_at as string | null) ?? null,
    birthday: (r.birthday as string | null) ?? null,
    is_starred: Boolean(r.is_starred),
    last_contacted_at: (r.last_contacted_at as string | null) ?? null,
    avatar_url: (r.avatar_url as string | null) ?? null,
    tags: safeJsonParse(r.tags as string, []),
    annotations: safeJsonParse(r.annotations as string, {}),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    archived_at: (r.archived_at as string | null) ?? null,
  }
}

export function rowToContactFieldType(r: SqlRow): ContactFieldType {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    name: r.name as string,
    icon: r.icon as string,
    protocol: r.protocol as string,
    is_default: Boolean(r.is_default),
  }
}

export function rowToContactField(r: SqlRow): ContactField {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    type_id: r.type_id as string,
    value: r.value as string,
    label: r.label as string,
    created_at: r.created_at as string,
  }
}

export function rowToAddressType(r: SqlRow): AddressType {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    name: r.name as string,
  }
}

export function rowToAddress(r: SqlRow): Address {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    type_id: (r.type_id as string | null) ?? null,
    street: r.street as string,
    city: r.city as string,
    province: r.province as string,
    postal_code: r.postal_code as string,
    country: r.country as string,
    is_primary: Boolean(r.is_primary),
    created_at: r.created_at as string,
  }
}

export function rowToRelationshipType(r: SqlRow): RelationshipType {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    name: r.name as string,
    name_reverse: r.name_reverse as string,
    is_symmetric: Boolean(r.is_symmetric),
    created_at: r.created_at as string,
  }
}

export function rowToRelationship(r: SqlRow): Relationship {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    related_id: r.related_id as string,
    type_id: r.type_id as string,
    notes: r.notes as string,
    created_at: r.created_at as string,
  }
}

export function rowToCompany(r: SqlRow): Company {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    name: r.name as string,
    website: r.website as string,
    description: r.description as string,
    tags: safeJsonParse(r.tags as string, []),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export function rowToOccupation(r: SqlRow): Occupation {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    company_id: (r.company_id as string | null) ?? null,
    title: r.title as string,
    department: r.department as string,
    is_current: Boolean(r.is_current),
    started_at: (r.started_at as string | null) ?? null,
    ended_at: (r.ended_at as string | null) ?? null,
    created_at: r.created_at as string,
  }
}

export function rowToPet(r: SqlRow): Pet {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    name: r.name as string,
    species: r.species as string,
    breed: r.breed as string,
    created_at: r.created_at as string,
  }
}

export function rowToTag(r: SqlRow): Tag {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    name: r.name as string,
    color: r.color as string,
  }
}

export function rowToGroup(r: SqlRow): Group {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    name: r.name as string,
    description: r.description as string,
    created_at: r.created_at as string,
  }
}

export function rowToInteraction(r: SqlRow): Interaction {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    type: r.type as Interaction['type'],
    channel: (r.channel as Interaction['channel']) ?? null,
    subject: r.subject as string,
    notes: r.notes as string,
    happened_at: r.happened_at as string,
    duration_minutes: (r.duration_minutes as number | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export function rowToNote(r: SqlRow): Note {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    body: r.body as string,
    is_pinned: Boolean(r.is_pinned),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export function rowToLifeEventType(r: SqlRow): LifeEventType {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    name: r.name as string,
    icon: r.icon as string,
    category: r.category as string,
  }
}

export function rowToLifeEvent(r: SqlRow): LifeEvent {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    type_id: (r.type_id as string | null) ?? null,
    label: r.label as string,
    notes: r.notes as string,
    happened_at: (r.happened_at as string | null) ?? null,
    yearly_reminder: Boolean(r.yearly_reminder),
    created_at: r.created_at as string,
  }
}

export function rowToReminder(r: SqlRow): Reminder {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    title: r.title as string,
    body: r.body as string,
    remind_at: r.remind_at as string,
    is_yearly: Boolean(r.is_yearly),
    is_done: Boolean(r.is_done),
    done_at: (r.done_at as string | null) ?? null,
    created_at: r.created_at as string,
  }
}

export function rowToStayInTouch(r: SqlRow): StayInTouch {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    frequency_days: r.frequency_days as number,
    last_contacted_at: (r.last_contacted_at as string | null) ?? null,
    next_remind_at: r.next_remind_at as string,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export function rowToTask(r: SqlRow): Task {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    title: r.title as string,
    notes: r.notes as string,
    due_at: (r.due_at as string | null) ?? null,
    is_done: Boolean(r.is_done),
    done_at: (r.done_at as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export function rowToGiftNote(r: SqlRow): GiftNote {
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    idea: r.idea as string,
    occasion: r.occasion as string,
    is_given: Boolean(r.is_given),
    given_at: (r.given_at as string | null) ?? null,
    created_at: r.created_at as string,
  }
}

export function rowToJournalEntry(r: SqlRow): JournalEntry {
  return {
    id: r.id as string,
    vault_id: r.vault_id as string,
    title: r.title as string,
    body: r.body as string,
    date: r.date as string,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}
