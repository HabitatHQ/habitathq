# Developer workflow speed and worktree setup

## Scope

Keep pnpm and Just as the shared workflow. Align local/CI tool declarations, refresh compatible workspace dependencies and synchronize common versions, build maintained Palladium TypeScript dependencies once in their CI job, repair affected-unit selection, and provide an isolated, repeatable linked-worktree bootstrap. Git-wt is optional; native Git remains supported. Do not add Turbo, sccache, remote-cache credentials, or automatic cleanup.

## Implementation

1. Align Node 24.21.0, pnpm 11.13.1, and Rust 1.99.0 declarations with the CI-supported compiler baseline. Pin pnpm in the root manifest and retain its 24-hour release-age policy for dependency resolution and frozen installs.
2. Preserve standalone TS verification prerequisites while eliminating its duplicate CI build. Remove core lint/typecheck/unit invocations repeated in the sync job; the maintained-package job still gates the same checks. Select affected application and maintained Palladium unit suites plus dependents through the pnpm graph, conservatively invalidate shared configuration changes, and keep integration/example/model execution separate.
3. Bootstrap dependencies, Palladium exports, and Nuxt configuration in the actual worktree checkout, with an isolated Cargo target directory and no dependency symlinks or secret copying.
4. Document optional worktree navigation and bootstrap, keeping developer-specific configuration local.
5. Update dependencies through pnpm/Cargo within compatible ranges, reconcile shared direct dependency constraints, and deduplicate the lockfile. Preserve intentional framework-major differences and the pinned manual Quint pilot. Retain Rust/Postgres/OIDC, live server faults, browser OPFS/ownership, and Hephaestus PWA release gates.

## Verification

Exercise changed-unit selection for app/library/dependent changes, shared configuration, an invalid base, and uncommitted work. Exercise bootstrap from a nested directory, rerun behavior, dependency-symlink refusal, and failure propagation. Run maintained TypeScript verification and repository-native formatting/architecture checks. Verify the pinned compiler and retained integration gates through main CI after publication.

### Local execution evidence

- Nested-directory `just worktree-setup` completed with pnpm 11.13.1: frozen install, maintained Palladium builds, and Nuxt preparation for all four apps. `just doctor` reported the declared Node, pnpm, and Rust versions.
- The actual `just test-changed` command selected all four app suites and maintained Palladium suites for shared dependency/configuration changes: 1,651 app tests and 641 Palladium tests passed.
- App native typechecks, Hephaestus's full Vue/Nuxt typecheck, maintained Palladium typechecks, and sync/example client typechecks passed. App formatters, maintained-package lint, dependency architecture, shellcheck, and dedupe checks passed.
- Rust 1.99.0 workspace tests with Postgres integration and Docker-backed OIDC enabled passed 203 tests. Formatting and all-feature Clippy checks passed.
- Chromium at 390 × 844 rendered all four app startup surfaces. Habitat's skip-onboarding transition reached its database-backed dashboard.
- Production Hephaestus PWA generation and all 121 Chromium acceptance tests passed with the upgraded dependencies and matching Playwright browser runtime. Live Palladium Rust-server E2E passed all 53 tests.
- Palladium browser OPFS/sync recovery passed all eight React example tests and both multitab ownership tests.
- Deeper Halcyon contact creation failed with `SQLITE_CORRUPT_VTAB` during `DELETE FROM contacts_fts WHERE id = ?`. An isolated reproduction using its unchanged schema and the pre-update lockfile's SQLite WASM 3.49.0-build3 produced the same error. This existing FTS defect is outside the workflow/dependency change; contact creation is not claimed as passing.

## Deferred experiments

Track the [build-only Turbo pilot](https://github.com/HabitatHQ/habitathq/issues/52) and [sccache experiment](https://github.com/HabitatHQ/habitathq/issues/53) separately. The sccache experiment requires a warm Swatinem-cache baseline before any claimed speedup. No integration verification gate may be removed or cached away by either experiment.
