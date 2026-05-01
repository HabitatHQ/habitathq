// ─── Form types + payload builders for Bored feature ────────────────────────

export interface ActivityFormState {
  title: string
  description: string
  estimated_minutes: string | number
  is_recurring: boolean
  recurrence_rule: 'daily' | 'weekly' | 'monthly'
  tags: string[]
}

export interface CategoryFormState {
  name: string
  icon: string
  color: string
}

/** Returns null if valid, error message string if invalid. */
export function validateActivityTitle(title: string): string | null {
  if (!title.trim()) return 'Title is required'
  return null
}

/**
 * Transforms a raw activity form state into the payload shape expected by
 * createBoredActivity / updateBoredActivity.
 */
export function buildActivityPayload(form: ActivityFormState, categoryId: string) {
  const mins = form.estimated_minutes === '' ? null : Number(form.estimated_minutes)
  const tags = form.tags.map((t) => t.trim()).filter(Boolean)
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    category_id: categoryId,
    estimated_minutes: mins,
    is_recurring: form.is_recurring,
    recurrence_rule: form.is_recurring ? form.recurrence_rule : null,
    tags,
    annotations: {} as Record<string, string>,
  }
}

/** Transforms a raw category form state into the payload shape expected by
 * createBoredCategory / updateBoredCategory. */
export function buildCategoryPayload(form: CategoryFormState) {
  return {
    name: form.name.trim(),
    icon: form.icon,
    color: form.color,
  }
}
