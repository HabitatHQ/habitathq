import type { Contact, Relationship, RelationshipType } from '~/types/database'

export function getRelationshipLabel(
  rel: Relationship,
  type: RelationshipType,
  viewingAs: string,
): string {
  if (type.is_symmetric) return type.name
  return rel.contact_id === viewingAs ? type.name : type.name_reverse
}

export function relationshipDisplayName(
  rel: Relationship,
  type: RelationshipType,
  viewingAs: string,
  related: Contact,
): string {
  const label = getRelationshipLabel(rel, type, viewingAs)
  const capitalized = label.charAt(0).toUpperCase() + label.slice(1)
  const name = related.first_name + (related.last_name ? ` ${related.last_name}` : '')
  return `${capitalized} ${name.trim()}`
}

export function isSymmetricRelationship(type: RelationshipType): boolean {
  return type.is_symmetric
}

export function groupRelationshipsByType(
  items: Array<{ rel: Relationship; type: RelationshipType; contact: Contact }>,
): Map<string, typeof items> {
  const map = new Map<string, typeof items>()
  for (const item of items) {
    const key = item.type.name
    if (!map.has(key)) map.set(key, [])
    map.get(key)?.push(item)
  }
  return map
}
