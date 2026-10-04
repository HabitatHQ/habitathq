# Shared app primitive cutover

## Goal and boundaries

Consolidate audited cross-app behavior in the existing `@habitathq/utils` and `@habitathq/shared` packages. Preserve app data, storage keys, supported platform surfaces, domain models, user-facing copy and product-specific policies. No new generic package, no database ownership migration, no finance/workout/CRM rule sharing. Work starts from default-branch commit aae0742.

## Contracts

- Shared Vue primitives remain in the Nuxt layer. Habitat callers move directly to AppEmptyState, AppBottomSheet and AppConfirmDialog; remove obsolete wrappers, including the unused CollapsibleSection wrapper. AppCollapsible itself remains unchanged. Preserve modal variant/closeability/slots and event behavior. Confirmation haptics should have one owner rather than duplicate effects.
- Matching local date-key and date-only formatting helpers and tolerant DB JSON parsing are imported directly from `@habitathq/utils`. JSON-null columns use the fallback; parsing is not schema validation. Keep domain row mapping, recurrence, relative-label policies and workout/finance conversions local.
- Settings persistence is shared without imposing a state-management model: app schemas, storage keys, normalization, onboarding migration, readonly state, reset/patch/profile/replace semantics remain app-local. Preserve storage-write error propagation, including persist-before-replace behavior used by data import. Shared reads accept only object records; no arbitrary parsed value is trusted as an object. The mechanism accepts app normalization hooks and fresh-default factories where necessary.
- Habitat platform detection and haptics reuse the shared mechanism; app enableHaptics binding stays local through an explicit import alias to the canonical shared useHaptics implementation. Intentional Nuxt auto-import overriding is limited to this meaningful preference policy; no provider/injection framework or renamed parallel API. Preserve browser no-op and native plugin behavior. Do not add native certification to Hephaestus.
- Halcyon adopts the shared Nuxt layer for empty/loading primitives, retaining domain copy/actions and app configuration. Hephaestus imports pure utilities only and keeps its Phosphor/offline layer boundary.
- Halcyon's remaining `@habitathq/db` source import moves to `@palladium/core`; remove unused shim dependencies via pnpm. The shim package itself is not deleted as unrelated external consumers are unknown.

## Execution

1. Establish isolated worktree, dependencies, baseline boundary probes and symbol-reference evidence.
2. Parallel subagents: Habitat UI wrapper cutover; pure utility adoption; settings mechanism and app migrations; platform/haptics plus Halcyon layer/primitives. Separate file ownership and parent-owned manifests/lockfile/docs.
3. Integrate all consumers and semantic tests; no mid-flight formatting/build/test runs by agents.
4. Run app-native formatting, full affected app unit/integration suites, typechecks, shared utility verification, architecture and dependency dedupe checks. Exercise actual browser surfaces on isolated local origins and run runtime boundary probes.
5. Update canonical repository documentation after smoke proof; commit with normal hooks, push branch, open PR with exercised evidence and any genuine limitations.

## Acceptance

- No obsolete UI aliases or duplicate matching pure/platform implementations remain in active app callers.
- Existing settings keys/state semantics, Habitat onboarding migration and Hephaestus import replacement ordering remain intact; malformed reads safely default.
- JSON-null and valid/malformed column data behave consistently across migrated apps.
- Halcyon empty actions and Habitat modal/confirmation flows render and work through shared components; the unused disclosure wrapper is removed without changing AppCollapsible.
- All affected test files run in full; no verification assets are weakened to obtain a pass.
- PR includes the extraction/adoption work and the authorized remediation of documented blockers; the primary checkout and existing worktrees remain untouched.

## Verification outcome

- The original extraction exposed inherited blockers: Hearth's report helper was omitted by the broad `reports/` ignore rule; supplemental Vue checking reported 22 Hearth and 99 Halcyon diagnostics; Halcyon contact creation failed with `SQLITE_CORRUPT_VTAB` on unchanged main. Those findings were independently reproduced before remediation.
- The authorized fixes restore the report helper without changing its behavior, restrict the ignore rule to root `/reports/`, correct the Vue contracts, and make `verify` invoke `pnpm run ci` rather than pnpm's frozen installer. App verification and the GitHub app matrix now include native TypeScript and Vue template checking.
- Halcyon schema version 2 installs SQLite-owned FTS5 triggers over source integer rowids and transactionally rebuilds the indexes. Manual UUID-keyed FTS writes are removed. Real SQLite regressions cover new-database contact/note changes and version-1 upgrade preservation; a production WASM upgrade retained the previously failing contact, allowed new contact/note creation, and found both legacy contact and new note after reload.
- Full affected suites pass: Habitat 646 tests/50 files, Hearth 334/20, Halcyon 230/17, Hephaestus 528/47; shared utilities pass 13 settings-storage cases. All four app native TypeScript and Vue template gates pass.
- Repository architecture, dependency dedupe, frozen-lockfile install and the full Semgrep scan pass. Native notification/speech typing no longer uses `as any`. The native battery-exemption regression fails with structural method probing of Capacitor's lazy proxy and passes with typed plugin registration.
- Production Habitat, Halcyon and Hearth builds pass. Mobile-width Habitat shared empty states, habit creation/reload, sheet keyboard focus/dismissal/restoration, confirmation cancellation and durable archive were exercised. Halcyon shared homepage/search empty states and bundled pin/unpin icons were exercised.
- Hearth's production CSV preview explains rejection of an unknown-account row. Import batches use shallow reactive ownership so plain records cross the worker structured-clone boundary: the prior clone failure was observed, then exactly the valid $12.50 expense was imported and persisted across reload; the rejected row was absent. Reports render that $12.50 expense total.
- Actual shared/Habitat haptic composables were exercised through simulated iOS and web Capacitor bridges, including disabled→enabled→disabled preferences. A throwaway actual Hearth speech-composable probe verifies interim/final transcripts, zero/default confidence, result-index handling, permission/no-speech/network errors, stop, prefixed fallback and unsupported browsers. These are JavaScript-boundary checks, not physical-device certification.
- CodeRabbit's settings-factory finding is addressed by restoring the settings-record generic constraint; LSP references show no direct app callers requiring migration.
- Final PR #62 CI for head `2694d9e` passed all four app jobs, the Pages build, Palladium TypeScript packages and sync/resilience checks. Halcyon's 230 unit tests and all four app unit suites passed locally; the full Semgrep run reports repository-wide findings and was not cleared. The Android Capacitor SQLite splitter was source-reviewed and the two-statement update triggers were put on one line to keep each trigger intact; Android-device execution was not performed.

