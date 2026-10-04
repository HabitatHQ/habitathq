---
scope: libs/habitat-shared
applies_to: "libs/habitat-shared/**"
last_verified: 2026-05-26
---

# @habitathq/shared — Agent Guide

Nuxt layer consumed by Habitat, Hearth and Halcyon. Provides app-level Nuxt config, shared CSS, composables, UI primitives and the icon registry (`<AppIcon>` + `resolveIcon`). Hephaestus deliberately retains its standalone Phosphor-based layer boundary.

## Layout

- `app/components/` — shared Vue components (notably `<AppIcon>`).
- `app/composables/` — auto-imported composables.
- `app/assets/` — CSS shared across apps.
- `nuxt.config.ts` — entry point; consuming apps `extends: ['@habitathq/shared']`.

## Conventions

- Icon registry lives in `libs/habitat-utils/src/icons.ts`. Add new entries there; this layer just re-exports.
- No app-specific code — anything specific to one app belongs in that app.
- No verify script (Nuxt layer has no buildable surface of its own). Verification happens transitively when consuming apps run their `verify`.
- Use `AppEmptyState`, `AppSkeleton`, `AppCollapsible`, `AppBottomSheet` and `AppConfirmDialog` directly. Modal callers choose their closeability/variant and retain domain content in slots; app wrappers that only rename these APIs are not needed.
- `usePlatform` caches Capacitor platform detection for the app lifetime. `useHaptics` owns native plugin calls and browser no-op behavior, with an optional reactive `enabled` policy. Habitat intentionally overrides the auto-import with a thin preference-binding wrapper that explicitly imports the shared implementation as `useSharedHaptics`; shared component calls consequently respect Habitat's `enableHaptics`.
- `createAppSettings` delegates storage reads/writes to `@habitathq/utils`. Apps retain their own state model, defaults, storage key and normalization; do not substitute this factory for app-specific migration or import ordering.
- Consumers load `@nuxt/ui` CSS so shared Tailwind classes and semantic UI tokens are generated. Halcyon retains its Heroicons markup and adds offline Heroicons plus Lucide bundling without changing the shared registry.

## Motion design system

`app/assets/css/animations.css` is the **single source of truth** for motion across all Habitat apps (loaded app-wide via this layer's `nuxt.config` `css`). Never hand-roll durations, easings, or transition classes in app code — reference a canonical preset.

**Tokens** (the only place raw values live): easings `--ease-out` (enter), `--ease-in-out`, `--ease-drawer` (sheets); durations `--duration-fast` 160ms, `--duration-normal` 250ms, `--duration-exit` 200ms, `--duration-slow` 300ms, `--duration-slower` 500ms (lingering exits only — e.g. the check-in "Saved" fade-out via `swap-slow`).

**Preset catalog** — one preset per motion role:

| Category | Preset | How to apply |
| --- | --- | --- |
| Route push (up) | `page-slide-up` | `<NuxtPage :transition="{ name: 'page-slide-up', mode: 'out-in' }" />` |
| Bottom sheet / slideover | `sheet-slide` | `<Transition name="sheet-slide">` |
| Centered modal | `sheet-scale` | `<Transition name="sheet-scale">` |
| Backdrop / scrim | `sheet-backdrop` | `.sheet-backdrop` + `.sheet-backdrop-enter` |
| List item entrance | `stagger-list` | `.stagger-list` on the parent |
| Single-panel reveal | `reveal` | `<Transition name="reveal">` |
| Content crossfade | `swap` | `<Transition name="swap">` |
| Crossfade, lingering exit | `swap-slow` | `<Transition name="swap-slow">` (500ms leave — status/"Saved" fades) |
| Collapse / expand | `collapsible-grid` | `.collapsible-grid` + `[data-open]` |
| Press feedback | `btn-press` (`.icon-btn`, `.chip-btn`) | `:active` utility class |
| Loading | `animate-pulse` / `animate-spin` | Tailwind (reduce-motion-aware) |

Reduce-motion is handled centrally (both `@media (prefers-reduced-motion)` and `html.reduce-motion`, wired from `settings.reduceMotion` in `app.vue`): a global `*` safety-net collapses **every** keyframe `animation` to a single instant run (so page-local decorative loops like `moss-sway`/bubbles/tentacles are covered automatically), while curated **transitions** are zeroed per-preset — new transition presets must be added to both blocks. `sprout-draw` / `nav-wiggle` are habitat-brand animations that stay in the app.

**Guard:** `apps/*/tests/unit/motion-tokens.test.ts` fails if the shared layer inlines a raw `cubic-bezier()` outside `:root`, drops a token, or ships a preset missing its enter/leave class. (Extending the raw-easing check into app code is the phase-2 migration.)
