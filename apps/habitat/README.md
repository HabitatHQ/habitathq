# Habitat

A habit tracker that lives entirely on your device. No accounts, no servers, no sync — just your data, stored locally using SQLite in the browser.

## Philosophy

Habit tracking shouldn't require trusting a third party with your personal data. Habitat takes the opposite approach: all data is stored on-device using SQLite WASM with the browser's Origin Private File System (OPFS). There's no backend, no analytics, and nothing leaves your device unless you explicitly export it.

The same codebase ships as a PWA (installable web app) and as native iOS/Android apps via Capacitor, with zero changes to the core logic.

## Features

- **Habits** — daily/custom frequency, streaks, completion history
- **Check-ins** — templated questionnaires for reflection (morning, evening, weekly)
- **Journal** — daily freeform notes (stored in localStorage)
- **Jots** — unified timeline for text notes, voice recordings, and images (stored in IndexedDB)
- **TODOs** — recurring and one-off tasks with priority, due dates, and timer integration
- **Bored oracle** — random activity picker from user-defined categories
- **Timer/Focus** — stopwatch, countdown, and pomodoro timer attached to any task or habit
- **Stats** — completion trends and streaks
- **Themes** — Habitat (cyan), Forest, Ocean; light/dark mode per theme
- **Export/Import** — full JSON backup + ZIP export for jots (text, voice, images)

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Nuxt 4 (SPA mode, no SSR) |
| UI | Nuxt UI 4 (Tailwind v4) |
| Database | SQLite WASM + OPFS (web) / `@capacitor-community/sqlite` (native) |
| Native | Capacitor 8 (iOS + Android) |
| PWA | `@vite-pwa/nuxt` |
| Linter | Biome |

## Architecture

All database work runs in a **Web Worker** to keep the main thread unblocked. Pages communicate through a typed message bus: `useDatabase()` composable → `database.client.ts` plugin (UUID-correlated request/response) → `database.worker.ts` (SQLite WASM).

On native, the same message types are dispatched directly to `@capacitor-community/sqlite` instead of the worker.

```
app/
  pages/          # File-based routes
  layouts/        # default.vue — header + bottom nav
  composables/    # useDatabase, useTimer, useHaptics, usePlatform, useNotifications
  plugins/        # database.client.ts — worker/native bridge
  workers/        # database.worker.ts — SQLite WASM engine
  types/          # Shared types (Habit, Completion, worker messages)
  lib/            # db-native.ts — Capacitor SQLite implementation
  utils/          # Pure helpers: format, scribble, habit/checkin/todos helpers
  assets/css/     # Tailwind + themes + safe-area utilities
```

## Getting Started

**Prerequisites:** Node.js 20+, pnpm

```bash
pnpm install
pnpm dev         # dev server at localhost:3000
```

Build for production:

```bash
pnpm build:pwa        # static PWA output → .output/public/
pnpm build:native     # build + sync to Capacitor native projects
```

Code quality:

```bash
pnpm check        # lint + format check
pnpm check:fix    # auto-fix
pnpm typecheck    # TypeScript
```

## Native Builds (Capacitor)

The same codebase ships to iOS and Android via Capacitor 8. Both platforms share a single build step (`pnpm build:native`) that generates the web assets and syncs them into the native projects.

### Android

**Prerequisites:** Android Studio, Android SDK

```bash
# Build web assets + sync to native project
pnpm build:native

# Run on emulator or connected device
pnpm cap:run:android

# Or open in Android Studio
pnpm cap:open:android
```

**Building an APK:**

```bash
# Debug APK
cd android && ./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### iOS

**Prerequisites:** macOS, Xcode, CocoaPods (`brew install cocoapods`)

#### First-Time Setup (after cloning)

```bash
# 1. Ensure xcode-select points to Xcode (not Command Line Tools)
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

# 2. Install CocoaPods dependencies
cd ios/App && LANG=en_US.UTF-8 pod install && cd ../..
```

> **Note:** The `LANG=en_US.UTF-8` prefix prevents a Ruby encoding issue with CocoaPods on newer Ruby versions.

#### Build & Run

```bash
# Build web assets + sync to native project
pnpm build:native

# Run on iOS Simulator
pnpm cap:run:ios

# Or open in Xcode (for physical device, signing, debugging)
pnpm cap:open:ios
```

#### Deploy to a Physical iPhone (No Paid Developer Account Needed)

You can test on your own iPhone using Xcode's **free Personal Team provisioning** — no $99/year Apple Developer Program enrollment required.

**Setup:**

1. **Add your Apple ID to Xcode:**
   - Open Xcode → menu bar: **Xcode → Settings** (or press ⌘,)
   - Go to the **Accounts** tab
   - Click the **+** button at the bottom-left → choose **Apple ID** → sign in with your personal Apple ID (the same one you use for iCloud/App Store is fine)

2. **Configure signing in the project:**
   - Run `pnpm cap:open:ios` — this opens the Habitat Xcode project
   - In the **left sidebar** (Project Navigator), click the blue **App** project icon at the very top of the file tree
   - In the middle pane, make sure the **App** target is selected under **TARGETS** (not the project)
   - Click the **Signing & Capabilities** tab
   - Check **Automatically manage signing**
   - In the **Team** dropdown, select your name — it will show as `Your Name (Personal Team)`
   - Change the **Bundle Identifier** to something unique to you, e.g. `com.jeelbhavsar.habitat`
     - This must be globally unique — Xcode will show a red error if it conflicts with an existing app
     - This only affects the local build; it doesn't change the Capacitor config

3. **Connect your iPhone and run:**
   - Plug your iPhone into your Mac with a USB/Lightning cable
   - On your iPhone, tap **Trust** if prompted to trust this computer
   - In Xcode, look at the **top toolbar** — there's a device/simulator dropdown that probably says something like "iPhone 16 Pro" (a simulator). Click it and select your **physical iPhone** from the list under "Devices"
   - If your phone doesn't appear, ensure it's unlocked and you've trusted the computer
   - Click the **▶️ Play button** (top-left of the toolbar) to build and install the app
   - The first build takes a minute or two — subsequent builds are faster

4. **Trust the developer on your iPhone (first install only):**
   - The app will install but **won't open** — you'll see an "Untrusted Developer" alert
   - On your iPhone, go to: **Settings → General → VPN & Device Management**
   - Under **Developer App**, you'll see your Apple ID email — tap it
   - Tap **Trust "[your email]"** → confirm
   - Now go back to the home screen and open the Habitat app — it should launch

**Limitations of free provisioning:**

| Constraint | Detail |
|---|---|
| Profile expiry | **7 days** — the app stops launching; re-deploy from Xcode to renew |
| Max devices | 3 registered test devices |
| Capabilities | No App Store / TestFlight distribution, limited entitlements |
| App Store | Requires paid Apple Developer Program ($99/year) |

### Common Scripts

| Script | Description |
|---|---|
| `pnpm build:native` | Build web assets + sync to both iOS & Android |
| `pnpm cap:sync` | Sync web assets without rebuilding |
| `pnpm cap:run:ios` | Build + run on iOS simulator/device |
| `pnpm cap:run:android` | Build + run on Android emulator/device |
| `pnpm cap:open:ios` | Open Xcode project |
| `pnpm cap:open:android` | Open Android Studio project |

## Testing

```bash
pnpm test           # unit tests (Vitest + happy-dom)
pnpm test:e2e       # E2E tests (Playwright)
pnpm test:a11y      # accessibility tests (axe-core)
```

Unit tests live in `tests/unit/`, E2E in `tests/e2e/`, a11y in `tests/a11y/`.

## Notes

- OPFS requires `Cross-Origin-Isolation` headers (`COOP`/`COEP`), handled by `coi-serviceworker` in dev and the PWA service worker in production.
- The `BUILD_TARGET` env var (`pwa` | `native`) controls whether the PWA manifest/service worker are bundled.
- Feature flags in `useAppSettings.ts` gate optional pages (Todos, Bored, Timer, Jots) to keep the nav uncluttered by default.
- Both `android/` and `ios/` native project directories are tracked in git. They contain customisations (app icons, splash screens, build configs) that would be lost if regenerated with `cap add`. After cloning, run `pod install` in `ios/App/` to restore CocoaPods dependencies.
- **App icons:** Android icons live in `android/app/src/main/res/mipmap-*/`. The iOS icon is a single 1024×1024 PNG at `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`. The source icon is `public/icons/icon-512.png`.
