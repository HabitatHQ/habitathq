import type { Contact, Tag } from '~/types/database'

const DEFAULT_COLOR = '#7c3aed'

export function sortTagsByName(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name))
}

export function tagDisplayColor(tag: Tag): string {
  return tag.color || DEFAULT_COLOR
}

export function filterContactsByTag(contacts: Contact[], tag: string | null): Contact[] {
  if (tag === null) return contacts
  return contacts.filter((c) => c.tags.includes(tag))
}

export function contactTagObjects(contact: Contact, allTags: Tag[]): Tag[] {
  return contact.tags.map((name) => allTags.find((t) => t.name === name)).filter(Boolean) as Tag[]
}
