import type { TagCategory, TagRow } from '~/types/database'

export interface PredefinedTagDef {
  name: string
  category: TagCategory
  color: string
}

export const PREDEFINED_TAGS: PredefinedTagDef[] = [
  { name: '#deload', category: 'performance', color: '#60a5fa' },
  { name: '#pr-day', category: 'performance', color: '#f97316' },
  { name: '#heavy', category: 'performance', color: '#ef4444' },
  { name: '#volume', category: 'performance', color: '#a855f7' },
  { name: '#tired', category: 'feel', color: '#94a3b8' },
  { name: '#strong', category: 'feel', color: '#22c55e' },
  { name: '#pumped', category: 'feel', color: '#f97316' },
  { name: '#tight', category: 'feel', color: '#facc15' },
  { name: '#home-gym', category: 'environment', color: '#6366f1' },
  { name: '#commercial', category: 'environment', color: '#0ea5e9' },
  { name: '#travel', category: 'environment', color: '#14b8a6' },
  { name: '#competition', category: 'environment', color: '#f59e0b' },
]

/**
 * Build tag rows for seeding — deterministic IDs based on index.
 */
export function buildTagSeed(createdAt: string = new Date().toISOString()): TagRow[] {
  return PREDEFINED_TAGS.map((t, i) => ({
    id: `tag-predefined-${String(i + 1).padStart(3, '0')}`,
    name: t.name,
    category: t.category,
    is_predefined: 1 as const,
    color: t.color,
    created_at: createdAt,
  }))
}
