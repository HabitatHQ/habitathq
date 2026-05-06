/**
 * Migration v8: Heroicons → Lucide.
 *
 * Hearth previously stored heroicon class strings (e.g. `i-heroicons-tag`)
 * in `accounts.icon` and `categories.icon`. The shared icon registry now
 * uses Lucide via Iconify; the heroicon collection is no longer bundled
 * for offline rendering, so legacy values would render blank in airplane
 * mode. Update the two known DEFAULT values to their Lucide equivalents.
 *
 * Custom icons (set by future picker UIs) are not affected.
 */
export const MIGRATION_V8_SQL = [
  "UPDATE accounts SET icon = 'i-lucide-landmark' WHERE icon = 'i-heroicons-building-library'",
  "UPDATE categories SET icon = 'i-lucide-tag' WHERE icon = 'i-heroicons-tag'",
]
