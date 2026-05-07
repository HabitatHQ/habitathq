/**
 * Habitat-specific icon picker constants.
 *
 * The cross-app icon registry (`iconRegistry`, `resolveIcon`, `ICON_SIZES`,
 * `iconsByCategory`) is auto-imported from `@habitathq/utils` via the
 * `habitat-shared` Nuxt layer.
 */

/**
 * Categories shown in the habit icon picker, in display order.
 * Excludes UI-internal categories (navigation, action, system, etc.).
 */
export const HABIT_PICKER_CATEGORIES: { key: string; label: string }[] = [
  { key: 'common', label: 'General' },
  { key: 'fitness', label: 'Fitness & Health' },
  { key: 'food', label: 'Food & Drink' },
  { key: 'learning', label: 'Mind & Learning' },
  { key: 'wellness', label: 'Wellness' },
  { key: 'productivity', label: 'Productivity' },
  { key: 'creative', label: 'Creative' },
  { key: 'social', label: 'Social' },
  { key: 'finance', label: 'Finance' },
  { key: 'outdoors', label: 'Nature & Outdoors' },
  { key: 'travel', label: 'Travel' },
  { key: 'health', label: 'Health & Medical' },
  { key: 'time', label: 'Time' },
]

/** Curated color palette for habit icons. */
export const HABIT_COLORS = [
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#78716c', label: 'Stone' },
] as const
