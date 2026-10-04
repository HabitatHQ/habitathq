---
scope: libs/habitat-utils
applies_to: "libs/habitat-utils/**"
last_verified: 2026-05-26
---

# @habitathq/utils — Agent Guide

Framework-independent helpers shared across Habitat apps. TS source exports only—no Vue, no Nuxt, no `dist/` build step. Formatting/parsing helpers are pure; the explicit settings-storage helpers perform their documented storage reads/writes.

## Verify

```bash
pnpm --filter @habitathq/utils verify
```

## Modules

| File | Purpose |
|------|---------|
| `src/icons.ts` | `iconRegistry`, `resolveIcon` — canonical icon registry shared across apps. |
| `src/format-date.ts` | Date formatting helpers. |
| `src/json.ts` | `safeJsonParse` and related. |
| `src/error.ts` | `logError(context, err)` — preferred over `console.error`. |
| `src/settings.ts` | `readStoredSettings` / `writeStoredSettings`: record-only JSON hydration over fresh defaults, optional app normalization, tolerant reads and propagated write failures. |

## Conventions

- Keep formatting/parsing pure. Isolate storage effects in `settings.ts`; app preferences, migration rules and reactive state remain in app composables.
- No app-specific logic — promote shared patterns up to here only when ≥ 2 apps need them.
