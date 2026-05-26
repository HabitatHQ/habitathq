# Halcyon — Agent Guide

Offline-first Personal Relationship Manager (PRM) PWA (Nuxt 4 SPA + Capacitor 8). All data on-device. No server, no sync (yet).

## Commands

```bash
pnpm dev              # Dev server
pnpm build:pwa        # Build PWA
pnpm build:native     # Build + cap sync
pnpm check:fix        # Lint + format (run before finishing)
pnpm typecheck        # TypeScript check
pnpm test:unit        # Vitest unit tests
pnpm test:e2e         # Playwright e2e tests
pnpm cap:run:ios      # Run on iOS
pnpm cap:run:android  # Run on Android
```

## Architecture

**Web**: Pages → `useDatabase()` composable → `database.client.ts` plugin (UUID message bus) → `database.worker.ts` (SQLite WASM + OPFS)

**Native**: Same composable → `db-native.ts` (Capacitor SQLite, no worker)

Both paths share the same `WorkerRequest` / `WorkerResponse<T>` message types.

## Key Files

| File | Purpose |
|------|---------|
| `app/workers/database.worker.ts` | SQLite WASM engine, schema (user_version), migrations, message handler |
| `app/lib/db-native.ts` | Capacitor SQLite mirror of all worker operations |
| `app/plugins/database.client.ts` | Worker lifecycle, UUID request/response correlation |
| `app/composables/useDatabase.ts` | All DB ops exposed to pages |
| `app/composables/useVault.ts` | Active vault state (selected vault_id) |
| `app/composables/useAppSettings.ts` | Feature flags + UI prefs (localStorage) |
| `app/composables/useNotifications.ts` | Local notifications (reminders + stay-in-touch) |
| `app/types/database.ts` | All entity types, WorkerRequest union, export types |
| `app/layouts/default.vue` | Header + bottom nav (Home, Contacts, Journal, Search) |
| `app/utils/contact-helpers.ts` | Pure contact utilities (display name, initials, etc.) |
| `app/utils/interaction-helpers.ts` | Channel labels, interaction type icons |
| `app/utils/reminder-helpers.ts` | Date math for reminders + stay-in-touch |
| `app/utils/format.ts` | Date/string formatting helpers |

## Schema (user_version = 1)

**Tables**: vaults, contacts, contact_field_types, contact_fields, address_types, addresses, relationship_types, relationships, companies, occupations, pets, tags, contact_tags, groups, group_contacts, interactions, interaction_contacts, notes, life_event_types, life_events, reminders, stay_in_touch, tasks, gift_notes, journal_entries, applied_defaults

All primary keys: TEXT UUID (`crypto.randomUUID()`).
Foreign keys enabled: `PRAGMA foreign_keys = ON`.
Tags/annotations stored as JSON in TEXT columns.

## Adding a DB Operation

1. Add message type to `WorkerRequest` union in `app/types/database.ts`
2. Implement in `database.worker.ts` (SQLite query)
3. Mirror in `db-native.ts` (Capacitor SQLite)
4. Expose in `useDatabase.ts` via `sendToWorker()`

Schema changes: increment `user_version`, add migration, mirror in `db-native.ts`.

## Pages & Routes

| Route | Page |
|-------|------|
| `/` | Dashboard (upcoming dates, recent interactions, overdue cadence) |
| `/contacts` | Pass-through `<NuxtPage />` |
| `/contacts/index` | Contact list (A-Z search) |
| `/contacts/new` | Add contact form |
| `/contacts/[id]` | Contact detail (unified timeline) |
| `/contacts/[id]/edit` | Edit contact |
| `/contacts/[id]/interactions/new` | Log interaction |
| `/companies` | Pass-through `<NuxtPage />` |
| `/companies/index` | Company list |
| `/companies/[id]` | Company detail + employees |
| `/groups/index` | Groups list |
| `/groups/[id]` | Group detail + members |
| `/journal/index` | Journal entry list |
| `/journal/[date]` | Journal entry for date |
| `/search` | Full-text search |
| `/settings/index` | App settings |
| `/settings/vault` | Vault management |
| `/settings/field-types` | Contact field type config |
| `/settings/relationship-types` | Relationship type config |

Pass-through parents (`contacts.vue`, `companies.vue`, `journal.vue`) contain only `<NuxtPage />`.

## Contact Detail (Fixed-but-Smart Layout)

Sections auto-hide when empty. Order:
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

## Conventions

**TypeScript**: `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` — use bracket notation for index properties, no `as` casts to suppress errors.

**Vault isolation**: Every data entity (contacts, interactions, notes, journal, etc.) is scoped to a `vault_id`. The active vault is managed by `useVault()`.

**last_contacted_at**: Auto-updated on any logged interaction. Drives stay-in-touch cadence reset.

**Stay-in-touch reset**: Triggers on (a) any interaction logged, OR (b) user manually dismisses.

**Soft deletes**: `archived_at` TEXT (null = active). Filter with `WHERE archived_at IS NULL`.

**Date format**: `YYYY-MM-DD` for dates. ISO 8601 for timestamps.

**JSON columns**: `tags TEXT DEFAULT '[]'`, `annotations TEXT DEFAULT '{}'`. Parse with `safeJsonParse()`.

**Reactive state update pattern**:
```typescript
const updated = await db.updateContact({ id, ...changes })
const idx = contacts.value.findIndex(c => c.id === id)
if (idx !== -1) contacts.value[idx] = updated
```

**Pass-through parent pages**: Contain only `<NuxtPage />` — required for nested routing.

## Config

- `nuxt.config.ts` — COOP/COEP headers (OPFS/SharedArrayBuffer), conditional PWA via `BUILD_TARGET`
- `capacitor.config.ts` — appId `com.halcyon.app`, webDir `.output/public`
- `app/app.config.ts` — Nuxt UI: primary `violet`, neutral `zinc`

## Testing

Unit tests live in `tests/unit/`. Pattern: pure helper functions tested in isolation.

```typescript
// Factory function for test entities
function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    vault_id: 'v1',
    first_name: 'Alice',
    last_name: 'Smith',
    // ... all fields with defaults
    ...overrides,
  }
}
```

Run tests: `pnpm test:unit`
Watch mode: `pnpm test:unit:watch`

## Guardrails

See root `CLAUDE.md` → Guardrails for the mechanically-enforced rules (semgrep, dependency-cruiser, `pnpm dedupe:check`, lefthook).
