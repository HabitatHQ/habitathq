import type { Scribble } from '~/types/database'

/**
 * Split a hierarchical tag string ("parent/leaf") into its parts.
 * Tags without a slash return `parent: null`.
 */
export function splitTag(tag: string): { parent: string | null; leaf: string } {
  const idx = tag.lastIndexOf('/')
  return idx === -1
    ? { parent: null, leaf: tag }
    : { parent: tag.slice(0, idx), leaf: tag.slice(idx + 1) }
}

/** Primary display title for a scribble list item. */
export function previewTitle(s: Scribble): string {
  if (s.title) return s.title
  const first = s.content.split('\n')[0]?.trim() ?? ''
  return first.slice(0, 72) || 'Untitled'
}

/** Secondary body preview for a scribble list item (empty when title is absent). */
export function previewBody(s: Scribble): string {
  if (!s.title) return ''
  return s.content.split('\n').slice(0, 2).join(' ').trim().slice(0, 120)
}

/** Body text shown inside a grid tile. */
export function gridBody(s: Scribble): string {
  if (s.title) return s.content.split('\n').slice(0, 4).join(' ').trim().slice(0, 200)
  return s.content.split('\n').slice(1).join(' ').trim().slice(0, 180)
}
