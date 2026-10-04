# Habitat dialog accessible names—2026-10-05

## Goal and scope

Fix [#57](https://github.com/HabitatHQ/habitathq/issues/57) and equivalent unnamed dialogs. Every affected dialog must expose a meaningful accessible name matching its existing visible heading; create/edit and import-result state changes must update that name. Preserve layout, focus handling, keyboard closing, and content. Native screen-reader execution is outside the available browser verification.

Baseline: updated main `f5d04e6`, isolated branch/worktree `fix/dialog-accessible-names-20261005`.

## Design

The current shared `AppBottomSheet` already accepts `ariaLabel` and binds `ariaLabel || title` to the dialog. Use that existing API for callers with custom visible headings rather than adding another header or changing the shared component. Existing named sheets and confirmation dialogs remain unchanged. Searches across all four apps found the unnamed-sheet pattern in Habitat only.

## Execution

1. Update main with `git pull --ff-only origin main`; create an isolated worktree and install frozen dependencies with user approval using `scripts/worktree-setup.sh`.
2. Inspect `AppBottomSheet` and all app modal/dialog callers. Read applicable app/shared guidance.
3. Reproduce New TODO, New Category and New Activity unnamed dialogs in a fresh browser profile before changing those callers.
4. Add names in `TodoFormModal.vue`, `bored/activities.vue`, `app.vue`, `JotsRecordSheet.vue`, `layouts/default.vue`, `focus.vue`, `habits/[id].vue`, `habits/index.vue`, `jots/edit-[id].vue`, and `settings/{data,features,more,permissions}.vue`. Derive dynamic names from the same state used by the visible heading, especially TODO/category/activity create/edit, timer completion, habit pause, and import error/success/preview.
5. Exercise actual dialogs in Chromium. Inspect accessibility trees, matching name/heading, single visible heading, focus containment, Escape closing and create/edit transitions. Run existing Habitat accessibility unit/E2E checks, full unit suites, Habitat native/Vue typechecks, app check:fix, and scoped Semgrep. Do not modify verification assets to mask failures.
6. Commit explicit paths with normal hooks, fetch current main, integrate and reverify if needed, then normal fast-forward push to main. Never force-push.

## Verification evidence

- Baseline Chromium reproduction: New TODO showed heading “New TODO” but `aria-label` was absent.
- Fresh PWA build browser smoke: dialog accessibility tree reported “New TODO” and the heading text matched; initial focus was inside the dialog. Bored category and activity create dialogs likewise reported “New Category” and “New Activity” matching their headings. No browser page errors were recorded for the TODO smoke.
- Targeted existing a11y E2E run (add-TODO and Bored create dialogs): the Bored name assertions passed. TODO name assertion passed, then the pre-existing whole-page axe check failed on unlabeled TODO form switches and an icon-only button. The broader a11y E2E suite also encountered the static test server crashing (`ENOE...`) and subsequent `ERR_CONNECTION_REFUSED`; only 3 of 11 passed. The a11y unit subset passed 9/9.
- Habitat unit suite passed: 687 tests in 54 files.
- Habitat `typecheck:all` completed without reported diagnostics.
- PWA production build completed successfully.
- Scoped ERROR-severity Semgrep scan passed.
- `pnpm --filter habitat check:fix` completed with no fixes; Biome reported existing informational single-word component-name notices and unrelated warnings.
- Dynamic edit-state UI was not exercised; names are bound to the same reactive state expressions as the visible headings. Keyboard Escape closed the TODO dialog and cleared its query parameter. Native screen-reader behavior was not tested.
