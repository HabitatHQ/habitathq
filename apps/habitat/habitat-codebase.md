# Habitat — Offline-First Habit Tracker PWA

*2026-03-08T20:38:00Z by Showboat 0.6.1*
<!-- showboat-id: aa1dacb0-da11-48f3-aece-c31182de0f0f -->

Habitat is an offline-first habit tracker PWA built with Nuxt 4 + Capacitor 8. All user data lives on-device: in SQLite WASM (web) or Capacitor SQLite (native iOS/Android). This document walks through the architecture, key files, data layer, pages, and utilities.

```bash
cat package.json | python3 -c "import json,sys; p=json.load(sys.stdin); print('Name:', p['name']); print('Version:', p.get('version','n/a')); print(); print('=== Scripts ==='); [print(f'  {k}: {v}') for k,v in p.get('scripts',{}).items()]; print(); print('=== Key Dependencies ==='); deps={**p.get('dependencies',{}),**p.get('devDependencies',{})}; keys=['nuxt','@nuxt/ui','@capacitor/core','@capacitor-community/sqlite','@vite-pwa/nuxt','typescript','vite']; [print(f'  {k}: {deps[k]}') for k in keys if k in deps]"
```

```output
Name: habitat
Version: 0.1.0

=== Scripts ===
  dev: nuxt dev
  dev:pwa: BUILD_TARGET=pwa nuxt dev
  build:pwa: BUILD_TARGET=pwa nuxt generate
  build:native: BUILD_TARGET=native nuxt generate && cap sync
  preview:pwa: BUILD_TARGET=pwa nuxt generate && pnpm dlx serve .output/public
  clean: rm -rf .output .nuxt
  postinstall: nuxt prepare
  cap:add:android: cap add android
  cap:add:ios: cap add ios
  cap:open:android: cap open android
  cap:open:ios: cap open ios
  cap:run:android: cap run android
  cap:run:ios: cap run ios
  cap:sync: cap sync
  cap:copy: cap copy
  gradle: cd android && ./gradlew
  typecheck: tsgo --noEmit
  typecheck:vue: nuxt typecheck
  typecheck:all: tsgo --noEmit && nuxt typecheck
  lint: biome lint .
  lint:fix: biome lint --write .
  format: biome format --write .
  check: biome check .
  check:fix: biome check --write .
  test:unit: vitest run
  test:unit:watch: vitest
  test:e2e: playwright test
  test:a11y: vitest run --config vitest.config.a11y.ts && playwright test --config playwright.a11y.config.ts
  test:a11y:unit: vitest run --config vitest.config.a11y.ts
  test:a11y:e2e: playwright test --config playwright.a11y.config.ts
  test: vitest run && playwright test
  ci: pnpm check && pnpm typecheck && pnpm test:unit
  screenshot: node scripts/screenshot.mjs

=== Key Dependencies ===
  nuxt: ^4.3.1
  @nuxt/ui: ^4.4.0
  @capacitor/core: ^8.1.0
  @capacitor-community/sqlite: ^8.0.0
  @vite-pwa/nuxt: ^1.1.1
  typescript: ^5.9.3
```

## Architecture

Habitat has two data paths that share the same composable API:

- **Web (PWA)**: Pages → `useDatabase()` → `database.client.ts` plugin (UUID message bus) → `database.worker.ts` (SQLite WASM + OPFS)
- **Native (iOS/Android)**: Pages → `useDatabase()` → `db-native.ts` (Capacitor SQLite, same operations, no worker)

The key insight: both paths expose identical `WorkerRequest` / `WorkerResponse<T>` message types, so the composable is platform-agnostic.

```bash
python3 /tmp/show_structure.py
```

```output
app/
  app.config.ts
  app.vue
  assets/
    css/
      main.css
      themes.css
  components/
    JotsCaptureSheet.vue
    JotsRecordSheet.vue
    JotsRing.vue
    TodoCalendarView.vue
  composables/
    useAppSettings.ts
    useContextFilter.ts
    useDatabase.ts
    useEasterEggs.ts
    useHaptics.ts
    useInstall.ts
    useJotsStore.ts
    useModalQuery.ts
    useNotifications.ts
    usePlatform.ts
    useTabReorder.ts
    useTimer.ts
  layouts/
    default.vue
  lib/
    db-native.ts
  pages/
    archive.vue
    bored.vue
    checkin.vue
    habits.vue
    health.vue
    index.vue
    jots.vue
    journal.vue
    matrix.vue
    settings.vue
    stats.vue
    todos.vue
    bored/
      activities.vue
      index.vue
    checkin/
      [id].vue
      index.vue
    habits/
      [id].vue
      index.vue
    jots/
      edit-[id].vue
      index.vue
      new.vue
    settings/
      data.vue
      display.vue
      features.vue
      index.vue
      more.vue
      notifications.vue
      permissions.vue
  plugins/
    database.client.ts
    install.client.ts
    strict-csp.client.ts
  types/
    checkin.ts
    database.ts
    journal.ts
  utils/
    checkin-helpers.ts
    csp.ts
    format.ts
    habit-helpers.ts
    navigation.ts
    scribble.ts
    todos-helpers.ts
  workers/
    database.worker.ts
    sw.ts
```

## Database Layer

The SQLite schema lives in `database.worker.ts` (web) and is mirrored in `db-native.ts` (native). Currently at `user_version = 11`.

```bash
grep -E 'CREATE TABLE|user_version' app/workers/database.worker.ts | head -40
```

```output
    // CREATE TABLE IF NOT EXISTS is a no-op for existing tables, so we always
  CREATE TABLE IF NOT EXISTS habits (
  CREATE TABLE IF NOT EXISTS completions (
  CREATE TABLE IF NOT EXISTS habit_schedules (
  CREATE TABLE IF NOT EXISTS habit_logs (
  CREATE TABLE IF NOT EXISTS checkin_entries (
  CREATE TABLE IF NOT EXISTS checkin_templates (
  CREATE TABLE IF NOT EXISTS checkin_questions (
  CREATE TABLE IF NOT EXISTS checkin_responses (
  CREATE TABLE IF NOT EXISTS applied_defaults (
  CREATE TABLE IF NOT EXISTS scribbles (
  CREATE TABLE IF NOT EXISTS reminders (
  CREATE TABLE IF NOT EXISTS checkin_reminders (
  CREATE TABLE IF NOT EXISTS bored_categories (
  CREATE TABLE IF NOT EXISTS bored_activities (
  CREATE TABLE IF NOT EXISTS todos (
    // PRAGMA user_version persists in the database file and tracks which migrations
        sql: 'PRAGMA user_version',
      let userVersion = (rows[0]?.user_version as number) ?? 0
      // Schema squashed at v10 (includes all tables via CREATE TABLE IF NOT EXISTS above).
          `CREATE TABLE IF NOT EXISTS bored_categories (
          `CREATE TABLE IF NOT EXISTS bored_activities (
          `CREATE TABLE IF NOT EXISTS todos (
        db.exec(`PRAGMA user_version = ${v}`)
      // Ensure fresh installs (user_version = 0) are stamped at the current baseline.
      if (userVersion === 0) db.exec('PRAGMA user_version = 11')
      const versionRows = queryRaw('PRAGMA user_version')
      const userVersion = (versionRows[0]?.user_version as number) ?? 0
```

### WorkerRequest Types

All DB operations are typed as a discriminated union in `app/types/database.ts`. Here are all the message types:

```bash
cat /tmp/worker_types.txt
```

```output
ARCHIVE_BORED_ACTIVITY
ARCHIVE_HABIT
ARCHIVE_TODO
BOOLEAN
CLEAR_APPLIED_DEFAULTS
CREATE_BORED_ACTIVITY
CREATE_BORED_CATEGORY
CREATE_CHECKIN_QUESTION
CREATE_CHECKIN_REMINDER
CREATE_CHECKIN_TEMPLATE
CREATE_HABIT
CREATE_REMINDER
CREATE_SCRIBBLE
CREATE_TODO
DAILY
DELETE_ALL_BORED_DATA
DELETE_ALL_CHECKIN_DATA
DELETE_ALL_CHECKIN_ENTRIES
DELETE_ALL_HABITS
DELETE_ALL_SCRIBBLES
DELETE_ALL_TODOS
DELETE_BORED_ACTIVITY
DELETE_BORED_CATEGORY
DELETE_CHECKIN_ENTRY
DELETE_CHECKIN_QUESTION
DELETE_CHECKIN_REMINDER
DELETE_CHECKIN_RESPONSE
DELETE_CHECKIN_TEMPLATE
DELETE_HABIT
DELETE_HABIT_LOG
DELETE_REMINDER
DELETE_SCRIBBLE
DELETE_TODO
EXPORT_DB
EXPORT_JSON_DATA
GET_ALL_CHECKIN_REMINDERS
GET_ALL_COMPLETIONS
GET_ALL_REMINDERS
GET_ARCHIVED_HABITS
GET_BORED_ACTIVITIES
GET_BORED_ACTIVITIES_FOR_CATEGORY
GET_BORED_CATEGORIES
GET_BORED_ORACLE
GET_CHECKIN_ENTRIES
GET_CHECKIN_ENTRY
GET_CHECKIN_QUESTIONS
GET_CHECKIN_REMINDERS_FOR_TEMPLATE
GET_CHECKIN_RESPONSE_DATES
GET_CHECKIN_RESPONSES
GET_CHECKIN_SUMMARY_FOR_DATE
GET_CHECKIN_TEMPLATE
GET_CHECKIN_TEMPLATES
GET_COMPLETIONS_FOR_DATE
GET_COMPLETIONS_FOR_DATE_RANGE
GET_COMPLETIONS_FOR_HABIT
GET_CONTEXT_TAGS
GET_DB_INFO
GET_HABIT_LOGS_FOR_DATE
GET_HABIT_LOGS_FOR_DATE_RANGE
GET_HABIT_LOGS_FOR_HABIT
GET_HABITS
GET_REMINDERS_FOR_HABIT
GET_SCHEDULE_FOR_HABIT
GET_SCRIBBLES
GET_SCRIBBLES_FOR_DATE
GET_STREAK
GET_TODOS
IMPORT_JSON
INTEGRITY_CHECK
IS_DEFAULT_APPLIED
LOG_HABIT_VALUE
MARK_BORED_ACTIVITY_DONE
MARK_DEFAULT_APPLIED
NUKE_OPFS
PAUSE_ALL_HABITS
PAUSE_HABIT
SCALE
TOGGLE_COMPLETION
TOGGLE_TODO
UPDATE_BORED_ACTIVITY
UPDATE_BORED_CATEGORY
UPDATE_CHECKIN_QUESTION
UPDATE_CHECKIN_TEMPLATE
UPDATE_HABIT
UPDATE_HABIT_SCHEDULE
UPDATE_SCRIBBLE
UPDATE_TODO
UPSERT_CHECKIN_ENTRY
UPSERT_CHECKIN_RESPONSE
```

## Pages & Routes

Habitat uses Nuxt 4 file-based routing. Pass-through parent files (`habits.vue`, `checkin.vue`, `bored.vue`) contain only `<NuxtPage />` — required for nested routing.

```bash
find app/pages -name '*.vue' | sort | python3 -c "
import sys, os
files = [l.strip() for l in sys.stdin]
print('Route'.ljust(45) + 'File')
print('-' * 75)
for f in files:
    route = f.replace('app/pages', '').replace('.vue', '').replace('/index', '')
    route = route if route else '/'
    print(route.ljust(45) + f)
"
```

```output
Route                                        File
---------------------------------------------------------------------------
/archive                                     app/pages/archive.vue
/bored                                       app/pages/bored.vue
/bored/activities                            app/pages/bored/activities.vue
/bored                                       app/pages/bored/index.vue
/checkin                                     app/pages/checkin.vue
/checkin/[id]                                app/pages/checkin/[id].vue
/checkin                                     app/pages/checkin/index.vue
/habits                                      app/pages/habits.vue
/habits/[id]                                 app/pages/habits/[id].vue
/habits                                      app/pages/habits/index.vue
/health                                      app/pages/health.vue
/                                            app/pages/index.vue
/jots                                        app/pages/jots.vue
/jots/edit-[id]                              app/pages/jots/edit-[id].vue
/jots                                        app/pages/jots/index.vue
/jots/new                                    app/pages/jots/new.vue
/journal                                     app/pages/journal.vue
/matrix                                      app/pages/matrix.vue
/settings                                    app/pages/settings.vue
/settings/data                               app/pages/settings/data.vue
/settings/display                            app/pages/settings/display.vue
/settings/features                           app/pages/settings/features.vue
/settings                                    app/pages/settings/index.vue
/settings/more                               app/pages/settings/more.vue
/settings/notifications                      app/pages/settings/notifications.vue
/settings/permissions                        app/pages/settings/permissions.vue
/stats                                       app/pages/stats.vue
/todos                                       app/pages/todos.vue
```

## Composables

All database operations are exposed through `useDatabase()`. Other composables handle settings, notifications, timer, and platform detection.

```bash
for f in app/composables/*.ts; do
  name=$(basename $f .ts)
  exports=$(grep -oE 'export (const|function|async function) [a-zA-Z]+' $f | sed 's/export (const|function|async function) //' | sed 's/export const //;s/export function //;s/export async function //' | tr '\n' ', ' | sed 's/, $//')
  lines=$(wc -l < $f)
  printf '%-30s %4s lines  exports: %s\n' "$name" "$lines" "$exports"
done
```

```output
useAppSettings                      108 lines  exports: formatTime,useAppSettings,
useContextFilter                     53 lines  exports: useContextFilter,
useDatabase                         225 lines  exports: useDatabase,
useEasterEggs                        19 lines  exports: useEasterEggs,
useHaptics                           26 lines  exports: useHaptics,
useInstall                           78 lines  exports: useInstall,
useJotsStore                        181 lines  exports: idbPut,idbDelete,useJotsStore,
useModalQuery                        67 lines  exports: useModalQuery,useBoolModalQuery,
useNotifications                    791 lines  exports: useNotifications,
usePlatform                          12 lines  exports: usePlatform,
useTabReorder                       240 lines  exports: useDragReorder,
useTimer                            229 lines  exports: formatMmSs,computeElapsed,formatTimerDisplay,nextPomodoroPhase,useTimer,
```

## Feature Flags

Features are gated by `AppSettings` flags stored in localStorage via `useAppSettings()`. Navigation items in `default.vue` are filtered by these flags.

```bash
grep -A 30 'interface AppSettings' app/composables/useAppSettings.ts
```

```output
export interface AppSettings {
  enableToday: boolean
  enableJournalling: boolean
  enableHealth: boolean
  enableWeek: boolean
  enableTodos: boolean
  enableBored: boolean
  autoShowBored: boolean
  enableContextFilter: boolean
  enableTimer: boolean
  pomodoroWorkMinutes: number
  pomodoroShortBreakMinutes: number
  pomodoroLongBreakMinutes: number
  pomodoroCyclesBeforeLong: number
  weekDays: number
  matrixReverseDays: boolean
  todoCalendarView: boolean
  todoCalendarGrain: 'month' | 'week'
  showTagsOnHabits: boolean
  showAnnotationsOnHabits: boolean
  showTagsOnToday: boolean
  showAnnotationsOnToday: boolean
  stickyNav: boolean
  navExtraPadding: boolean
  headerExtraPadding: boolean
  logInputMode: 'absolute' | 'increment'
  saveTranscribedNotes: boolean
  use24HourTime: boolean
  theme: AppTheme
  reduceMotion: boolean
  strictCsp: boolean
```

## Utility Functions

Pure helper functions in `app/utils/` are tested with Vitest and have no Vue dependencies.

```bash
for f in app/utils/*.ts; do
  name=$(basename $f .ts)
  exports=$(grep -oE '^export (const|function|async function|type|interface) [a-zA-Z]+' $f | awk '{print $NF}' | tr '\n' ', ' | sed 's/, $//')
  lines=$(wc -l < $f)
  printf '%-25s %4s lines\n  exports: %s\n\n' "$name" "$lines" "$exports"
done
```

```output
checkin-helpers                 15 lines
  exports: CHECKIN,CHECKIN,checkinScheduleLabel,

csp                             46 lines
  exports: STRICT,STRICT,SETTINGS,parseStrictCspSetting,

format                          79 lines
  exports: fmtDate,fmtLogDate,fmtLogTime,fmtArchived,dayLabel,dayNum,fmtDuration,timeAgo,

habit-helpers                   25 lines
  exports: HABIT,habitScheduleLabel,buildAnnotations,

navigation                      20 lines
  exports: NavItem,ALL,

scribble                        31 lines
  exports: splitTag,previewTitle,previewBody,gridBody,

todos-helpers                   27 lines
  exports: priorityColor,formatDueDate,isOverdue,

```

## Test Suite

Habitat has unit tests (Vitest + happy-dom) and E2E tests (Playwright), plus a separate accessibility suite.

```bash
find tests -name '*.test.ts' -o -name '*.spec.ts' | sort | while read f; do
  count=$(grep -c '^  it\|^  test\|^it(\|^test(' $f 2>/dev/null || echo 0)
  printf '%-55s %3s tests\n' "$f" "$count"
done
```

```output
tests/a11y/e2e/pages.spec.ts                             11 tests
tests/a11y/unit/markup.test.ts                            9 tests
tests/e2e/matrix.spec.ts                                  7 tests
tests/e2e/modal-query.spec.ts                             9 tests
tests/e2e/navigation.spec.ts                              9 tests
tests/e2e/settings.spec.ts                                9 tests
tests/e2e/touch-targets.spec.ts                          17 tests
tests/e2e/ux-audit.spec.ts                                8 tests
tests/unit/checkin-helpers.test.ts                       11 tests
tests/unit/context-filter.test.ts                        15 tests
tests/unit/csp-hashes.test.ts                            24 tests
tests/unit/format.test.ts                                26 tests
tests/unit/formatTime.test.ts                             4 tests
tests/unit/habit-helpers.test.ts                         14 tests
tests/unit/notifications-toast.test.ts                    8 tests
tests/unit/scribble.test.ts                              16 tests
tests/unit/strict-csp.test.ts                            37 tests
tests/unit/timer.test.ts                                 21 tests
tests/unit/todos-helpers.test.ts                         15 tests
tests/unit/useModalQuery.test.ts                         11 tests
```

## Build Configuration

Two build targets controlled by the `BUILD_TARGET` env var: `pwa` (includes `@vite-pwa/nuxt`, uses OPFS + SharedArrayBuffer) and `native` (skips PWA, runs `nuxt generate` + `cap sync`).

```bash
grep -A 5 'BUILD_TARGET\|COOP\|COEP\|modules:' nuxt.config.ts | head -50
```

```output
const buildTarget = process.env.BUILD_TARGET // 'pwa' | 'native' | undefined (defaults to dev/pwa)

// Base path for all pages — set via NUXT_APP_BASE_URL env var (e.g. '/habitat/' for GitHub Pages).
// Nuxt automatically picks this up for routing and assets; we also use it for the PWA manifest.
const appBaseURL = process.env.NUXT_APP_BASE_URL ?? '/'

--
  modules: ['@nuxt/ui', ...(isPWA ? ['@vite-pwa/nuxt'] : [])],

  // Global CSS (custom Tailwind v4 utilities — safe areas, etc.)
  css: ['~/assets/css/main.css'],

  // Nuxt UI module options
--
  // PWA config (only active when BUILD_TARGET=pwa or dev)
  ...(isPWA && {
    pwa: {
      // injectManifest: we supply a custom sw.ts that handles both Workbox
      // precaching and COOP/COEP header injection on navigation responses.
      // This replaces the old generateSW + coi-serviceworker.js combination —
      // one SW avoids the scope-conflict/reload-loop that two SWs caused.
      strategies: 'injectManifest',
      srcDir: 'workers',
      filename: 'sw.ts',
--
        // Keep disabled in dev: Vite already serves COOP/COEP headers directly,
        // so the PWA SW is not needed and would cause HMR reload loops via the
        // autoUpdate controllerchange handler.
        enabled: false,
      },
    },
--
      __BUILD_TARGET__: JSON.stringify(buildTarget ?? 'pwa'),
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm'], // prevents esbuild from breaking WASM dynamic import
    },
    worker: {
```

## Theming

Three themes (Habitat, Forest, Ocean) × two modes (dark/light), applied via `data-theme` attribute on `<html>`. Managed by `app.vue` watchEffect. Theme crossfade uses a `theme-transitioning` class.

```bash
grep -E 'data-theme|forest|ocean|habitat' app/assets/css/themes.css | head -30
```

```output
   Applied by setting data-theme="habitat|forest|ocean" on <html>.
[data-theme='forest'] {
/* Forest dark mode: deep forest night with subtle warm undertone */
html.dark[data-theme='forest'] {
html:not(.dark)[data-theme='forest'] {
[data-theme='ocean'] {
html.dark[data-theme='ocean'] {
html:not(.dark)[data-theme='ocean'] {
```

## Adding a New Feature — Checklist

1. **DB operation**: add type to `WorkerRequest` union → implement in `database.worker.ts` → mirror in `db-native.ts` → expose in `useDatabase.ts`
2. **Schema change**: increment `user_version`, add migration `ALTER TABLE`, mirror in `db-native.ts`
3. **Feature flag**: add to `AppSettings` in `useAppSettings.ts`, gate nav item in `default.vue`
4. **TypeScript**: use bracket notation for index properties, no `as` casts — `exactOptionalPropertyTypes` + `noPropertyAccessFromIndexSignature` are on
5. **Quality**: run `pnpm check:fix` (lint + format) and `pnpm typecheck` before finishing

```bash
echo '=== Line counts for key files ===' && wc -l   app/workers/database.worker.ts   app/lib/db-native.ts   app/composables/useDatabase.ts   app/plugins/database.client.ts   app/composables/useNotifications.ts   app/composables/useTimer.ts   app/layouts/default.vue   app/types/database.ts   nuxt.config.ts   | sort -rn | head -15
```

```output
=== Line counts for key files ===
    7525 total
    2582 app/workers/database.worker.ts
    2365 app/lib/db-native.ts
     791 app/composables/useNotifications.ts
     595 app/layouts/default.vue
     375 app/types/database.ts
     274 nuxt.config.ts
     229 app/composables/useTimer.ts
     225 app/composables/useDatabase.ts
      89 app/plugins/database.client.ts
```
