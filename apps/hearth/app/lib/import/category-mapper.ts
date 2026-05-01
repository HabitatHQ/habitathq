interface CategoryEntry {
  id: string
  name: string
}

interface MappingResult {
  hearthId: string | null
  confidence: number
  action: 'mapped' | 'create'
}

const SYNONYMS: Record<string, string> = {
  dining: 'dining out',
  restaurants: 'dining out',
  'gas & fuel': 'gas',
  fuel: 'gas',
  'gym & fitness': 'gym',
  fitness: 'gym',
  wifi: 'internet',
  broadband: 'internet',
}

/**
 * Auto-map imported category names to existing Hearth categories.
 * Uses exact match, substring match, and synonym lookup.
 */
export function autoMapCategories(
  importedNames: string[],
  hearthCategories: CategoryEntry[],
): Map<string, MappingResult> {
  const result = new Map<string, MappingResult>()

  for (const imported of importedNames) {
    const normalized = imported.toLowerCase().trim()

    // 1. Exact match (case-insensitive)
    const exact = hearthCategories.find((c) => c.name.toLowerCase() === normalized)
    if (exact) {
      result.set(imported, { hearthId: exact.id, confidence: 1, action: 'mapped' })
      continue
    }

    // 2. Substring match (e.g., "Food: Groceries" → "Groceries")
    const parts = normalized.split(/[:\s>]+/)
    let found = false
    for (const part of parts) {
      const sub = hearthCategories.find((c) => c.name.toLowerCase() === part.trim())
      if (sub) {
        result.set(imported, { hearthId: sub.id, confidence: 0.8, action: 'mapped' })
        found = true
        break
      }
    }
    if (found) continue

    // 3. Synonym lookup
    const synonym = SYNONYMS[normalized]
    if (synonym) {
      const synMatch = hearthCategories.find((c) => c.name.toLowerCase() === synonym)
      if (synMatch) {
        result.set(imported, { hearthId: synMatch.id, confidence: 0.7, action: 'mapped' })
        continue
      }
    }

    // 4. Unmatched — suggest creation
    result.set(imported, { hearthId: null, confidence: 0, action: 'create' })
  }

  return result
}
