---
scope: libs/habitat-shared
applies_to: "libs/habitat-shared/**"
last_verified: 2026-05-26
---

# @habitathq/shared — Agent Guide

Nuxt layer shared by all Habitat apps. Provides: app-level Nuxt config, shared CSS, composables, and the icon registry (`<AppIcon>` + `resolveIcon`).

## Layout

- `app/components/` — shared Vue components (notably `<AppIcon>`).
- `app/composables/` — auto-imported composables.
- `app/assets/` — CSS shared across apps.
- `nuxt.config.ts` — entry point; consuming apps `extends: ['@habitathq/shared']`.

## Conventions

- Icon registry lives in `libs/habitat-utils/src/icons.ts`. Add new entries there; this layer just re-exports.
- No app-specific code — anything specific to one app belongs in that app.
- No verify script (Nuxt layer has no buildable surface of its own). Verification happens transitively when consuming apps run their `verify`.
