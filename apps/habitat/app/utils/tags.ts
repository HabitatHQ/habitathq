/** Prefix reserved for system-managed tags (health, transcripts, etc.). */
export const RESERVED_TAG_PREFIX = 'habitat-'

/** Returns true if the tag uses a system-reserved prefix. */
export function isReservedTag(tag: string): boolean {
  return tag.startsWith(RESERVED_TAG_PREFIX)
}

/** Sanitises and filters a raw tag array, stripping reserved prefixes. */
export function filterReservedTags(tags: string[]): string[] {
  return tags.filter((t) => !isReservedTag(t))
}
