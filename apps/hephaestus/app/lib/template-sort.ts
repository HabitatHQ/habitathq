import type { TemplateRow, TemplateSortOrder } from '~/types/database'

/**
 * Sort a list of templates by the given order.
 * Returns a new array; does not mutate input.
 */
export function sortTemplates(templates: TemplateRow[], order: TemplateSortOrder): TemplateRow[] {
  const copy = [...templates]

  switch (order) {
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name))

    case 'most_used':
      return copy.sort((a, b) => (b.use_count ?? 0) - (a.use_count ?? 0))

    case 'last_used':
      return copy.sort((a, b) => {
        if (!a.last_used_at && !b.last_used_at) return 0
        if (!a.last_used_at) return 1
        if (!b.last_used_at) return -1
        return b.last_used_at.localeCompare(a.last_used_at)
      })

    case 'recent':
      return copy.sort((a, b) => b.created_at.localeCompare(a.created_at))

    case 'pinned_first':
      return copy.sort((a, b) => {
        const aPinned = a.pinned_at != null ? 0 : 1
        const bPinned = b.pinned_at != null ? 0 : 1
        if (aPinned !== bPinned) return aPinned - bPinned
        return (a.sort_order ?? 0) - (b.sort_order ?? 0)
      })
  }
}

/**
 * Filter templates by name or description (case-insensitive substring match).
 */
export function filterTemplates(templates: TemplateRow[], query: string): TemplateRow[] {
  if (!query) return templates
  const q = query.toLowerCase()
  return templates.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.description?.toLowerCase().includes(q) ?? false),
  )
}
