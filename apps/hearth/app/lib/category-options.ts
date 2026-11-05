import type { Category, TransactionType } from '~/types/database'

export function getCategoryOptions(
  categories: readonly Category[],
  type?: TransactionType,
): Array<{ id: string; label: string; icon: string; depth: number }> {
  const childrenByParent = new Map<string | null, Category[]>()
  for (const category of categories) {
    const siblings = childrenByParent.get(category.parent_id)
    if (siblings) siblings.push(category)
    else childrenByParent.set(category.parent_id, [category])
  }

  const options: Array<{ id: string; label: string; icon: string; depth: number }> = []
  const pending: Array<{ category: Category; parentLabel: string; depth: number }> = []
  const roots = childrenByParent.get(null) ?? []
  for (let index = roots.length - 1; index >= 0; index--) {
    const root = roots[index]
    if (!root) continue
    if (type === 'income' && root.id !== 'c7') continue
    if (type === 'expense' && root.id === 'c7') continue
    pending.push({ category: root, parentLabel: '', depth: 0 })
  }

  const visited = new Set<string>()
  while (pending.length > 0) {
    const entry = pending.pop()
    if (!entry || visited.has(entry.category.id)) continue
    const { category, parentLabel, depth } = entry
    visited.add(category.id)
    const label = depth === 0 ? category.name : `${parentLabel} › ${category.name}`
    options.push({ id: category.id, label, icon: category.icon, depth })
    const children = childrenByParent.get(category.id)
    if (!children) continue
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]
      if (child) pending.push({ category: child, parentLabel: label, depth: depth + 1 })
    }
  }
  return options
}
