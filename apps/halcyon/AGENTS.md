---
scope: apps/halcyon
applies_to: "apps/halcyon/**"
last_verified: 2026-05-26
---

# Halcyon — Agent Guide

Offline-first Personal Relationship Manager (PRM) PWA (Nuxt 4 SPA + Capacitor 8). All data on-device. No server, no sync (yet).

> Read root `AGENTS.md` first — shared Nuxt+Capacitor architecture, DB-op pattern, schema migrations, and TypeScript conventions live there.

## Verify

```bash
pnpm --filter halcyon verify
```

## Key files (halcyon-specific)

| File | Purpose |
|------|---------|
| `app/composables/useVault.ts` | Active vault state (selected `vault_id`). |
| `app/utils/contact-helpers.ts` | Display name, initials, pure contact utilities. |
| `app/utils/interaction-helpers.ts` | Channel labels, interaction-type icons. |
| `app/utils/reminder-helpers.ts` | Date math for reminders + stay-in-touch. |

## Schema (`user_version = 1`)

vaults, contacts, contact_field_types, contact_fields, address_types, addresses, relationship_types, relationships, companies, occupations, pets, tags, contact_tags, groups, group_contacts, interactions, interaction_contacts, notes, life_event_types, life_events, reminders, stay_in_touch, tasks, gift_notes, journal_entries, applied_defaults.

- All PKs: TEXT UUID (`crypto.randomUUID()`).
- `PRAGMA foreign_keys = ON`.
- Tags/annotations stored as JSON in TEXT columns.

## Routes

| Route | Page |
|-------|------|
| `/` | Dashboard (upcoming dates, recent interactions, overdue cadence) |
| `/contacts/index` | Contact list (A–Z search) |
| `/contacts/new` | Add contact form |
| `/contacts/[id]` · `/contacts/[id]/edit` · `/contacts/[id]/interactions/new` | Detail · edit · log interaction |
| `/companies/index` · `/companies/[id]` | List · detail + employees |
| `/groups/index` · `/groups/[id]` | List · detail + members |
| `/journal/index` · `/journal/[date]` | List · entry for date |
| `/search` | Full-text search |
| `/settings/{index,vault,field-types,relationship-types}` | App settings |

Pass-through parents: `contacts.vue`, `companies.vue`, `journal.vue`.

## Contact-detail layout (sections auto-hide when empty)

1. Header (avatar, name, pronouns, tags, star, deceased)
2. Contact methods (custom fields)
3. Addresses
4. Relationships
5. Occupation / company
6. Stay-in-touch status
7. Unified timeline (interactions + notes + life events, chronological)
8. Pinned standalone notes
9. Reminders + tasks
10. Life events
11. Pets
12. Gift notes

## Halcyon-specific conventions

- **Vault isolation**: every entity carries `vault_id`. Active vault from `useVault()`.
- **`last_contacted_at`**: auto-updated on any logged interaction; drives stay-in-touch cadence reset.
- **Stay-in-touch reset**: triggers on (a) any logged interaction OR (b) manual dismiss.
- **Soft deletes**: `archived_at TEXT` (null = active). Filter with `WHERE archived_at IS NULL`.
- **Dates**: `YYYY-MM-DD` for dates; ISO 8601 for timestamps.
- **JSON columns**: `tags TEXT DEFAULT '[]'`, `annotations TEXT DEFAULT '{}'`. Parse with `safeJsonParse()`.
- **Reactive update pattern**:

  ```typescript
  const updated = await db.updateContact({ id, ...changes })
  const idx = contacts.value.findIndex(c => c.id === id)
  if (idx !== -1) contacts.value[idx] = updated
  ```

## Testing

Unit tests in `tests/unit/`; pattern is pure helpers tested with factory functions:

```typescript
function makeContact(overrides: Partial<Contact> = {}): Contact {
  return { id: 'c1', vault_id: 'v1', first_name: 'Alice', last_name: 'Smith', /* … */ ...overrides }
}
```

## Config

- `capacitor.config.ts` — appId `com.halcyon.app`, webDir `.output/public`.
- `app/app.config.ts` — Nuxt UI: primary `violet`, neutral `zinc`.
