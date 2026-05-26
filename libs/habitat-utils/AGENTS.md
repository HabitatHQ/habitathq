---
scope: libs/habitat-utils
applies_to: "libs/habitat-utils/**"
last_verified: 2026-05-26
---

# @habitathq/utils — Agent Guide

Pure helper functions shared across Habitat apps. TS source exports only — no Vue, no Nuxt, no `dist/` build step.

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

## Conventions

- Pure functions, no side effects.
- No app-specific logic — promote shared patterns up to here only when ≥ 2 apps need them.
