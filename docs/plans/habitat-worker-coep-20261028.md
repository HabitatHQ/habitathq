# Habitat worker response isolation

## Scope

Fix service-worker-controlled startup on GitHub Pages without resetting browser data. Worktree: `.worktrees/fix/habitat-worker-coep-20261028`, based on `origin/main` at `ef2f48b`.

## Evidence

The deployed first visit loads the database worker before the document becomes cross-origin isolated. A controlled return visit is isolated and blocks the same worker with `net::ERR_BLOCKED_BY_RESPONSE`. Its cached response lacks `Cross-Origin-Embedder-Policy`. A diagnostic module-worker entry bypass exposed the same failure in SQLite's nested OPFS worker. Serving identical deployed assets with matching worker COEP headers allowed database startup and a controlled reload.

## Change

- In `apps/habitat/app/workers/sw.ts`, apply the existing `withCOIHeaders` helper to dedicated/shared worker responses after `staleWhileRevalidate` resolves. Cover precache, runtime cache, and network responses without changing stored caches, asset bodies, navigation handling, or non-worker responses.
- Apply the same policy to cached and network worker responses in Hearth and Halcyon through Workbox's `handlerWillRespond` hook, and in Hephaestus's custom fetch handler. Initialize the precache plugin only after setting the app-scoped cache name. The response hook retains the original request destination; cache-read hooks instead receive a revisioned cache-key request. Include precached navigations so Workbox's root route cannot bypass navigation isolation.
- Update the Habitat service-worker isolation note in `apps/habitat/README.md` after the production smoke succeeds.
- Preserve existing tests and browser storage. Publish through a PR, merge after successful checks, and verify the resulting Pages deployment.

## Verification

1. The Habitat fetch-handler probe exercised precache, runtime-cache, and network worker responses: COEP was `require-corp`, body/status stayed unchanged, and non-worker responses were returned unchanged.
2. `pnpm --filter <app> build:pwa` succeeded for Habitat, Hearth, Halcyon, and Hephaestus.
3. Habitat's generated PWA was served without origin COOP/COEP headers in Chromium. First load, service-worker-controlled reload, Today rendering, `crossOriginIsolated === true`, no database startup error, and no blocked worker requests passed; cached offline reload passed.
4. `pnpm --filter habitat check:fix`, `pnpm --filter habitat typecheck:all`, `pnpm --filter habitat test:unit`, and targeted Semgrep passed. The unit suite reported 720 passed and 1 skipped.
5. Hearth, Halcyon, and Hephaestus passed `check:fix`, `typecheck`, and `test:unit` (321, 232, and 519 tests passed, respectively). Targeted Biome check passed for all four service-worker files.
6. Final builds used `/habitathq/main/<app>/` and a shared local origin with no origin isolation headers. All four apps rendered their database-backed home screens on controlled online and offline reloads with `crossOriginIsolated === true` and no blocked worker requests. Hearth and Halcyon made offline favicon/icon requests that failed with `ERR_INTERNET_DISCONNECTED`; their app/database startup still succeeded. No personal-profile storage was changed.

## Boundaries

Both the top-level database worker and nested SQLite worker must receive matching policies. Inject at response delivery so an existing cached headerless response is repaired without cache deletion. Non-worker assets should not incur header-wrapper allocation. Keep diagnostics on isolated local origins and preserve the personal profile's SQLite, IndexedDB, preferences, and service-worker caches.
