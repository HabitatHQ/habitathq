/** Prefix reserved for system-managed tags (health, transcripts, etc.). */
export const RESERVED_TAG_PREFIX = 'habitat-'

/**
 * Canonical form of a user tag: trimmed and lower-cased. Tags are created,
 * stored and compared in this form so "Work", "work" and " WORK " are one tag.
 * Apply this at every point a tag is created from user input.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase()
}

/** Returns true if the tag uses a system-reserved prefix. */
export function isReservedTag(tag: string): boolean {
  return tag.startsWith(RESERVED_TAG_PREFIX)
}

/** Sanitises and filters a raw tag array, stripping reserved prefixes. */
export function filterReservedTags(tags: string[]): string[] {
  return tags.filter((t) => !isReservedTag(t))
}
