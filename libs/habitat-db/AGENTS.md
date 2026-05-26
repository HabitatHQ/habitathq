---
scope: libs/habitat-db
applies_to: "libs/habitat-db/**"
last_verified: 2026-05-26
---

# @habitathq/db — Agent Guide

Thin re-export shim for backward compatibility. The canonical implementations now live in `@palladium/core`.

## Verify

```bash
pnpm --filter @habitathq/db typecheck
```

> **Deprecated.** New code should import `DbAdapter`, `toDbAdapter`, and `toCapacitorDbAdapter` directly from `@palladium/core`. This package remains only for Halcyon and Hephaestus, which still use `SahPoolAdapter`. Once those apps migrate to `BrowserSqliteAdapter` from `@palladium/sqlite-browser`, this package can be deleted entirely.

## Exports

| Export | Source |
|--------|--------|
| `DbAdapter` (type) | Re-exported from `@palladium/core` |
| `toDbAdapter` | Re-exported from `@palladium/core` |
| `toCapacitorDbAdapter` | Re-exported from `@palladium/core` |
| `SahPoolAdapter` | Local — superseded by `BrowserSqliteAdapter` with `opfs-sah-pool` VFS |

## Conventions

- TS source exports only — no `dist/` build step.
- Pure infrastructure — no Vue, no Nuxt-specific imports.
- Don't add new code here. Migrate callers to `@palladium/core` instead.
