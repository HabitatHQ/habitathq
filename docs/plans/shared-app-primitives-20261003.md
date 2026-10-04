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
- PR contains only extraction/adoption work and its tests/documentation; the primary checkout and existing worktrees remain untouched.

## Verification outcome

- Full affected unit/integration suites pass: Habitat 645 tests/49 files; Hearth 285/15; Halcyon 228/16; Hephaestus 528/47. Shared utilities verify passes, including 13 settings-storage boundary cases. Existing utility date-parser non-null assertions remain lint warnings.
- All four native app typechecks passed. Supplemental Vue checking passes for Habitat and Hephaestus; Hearth has 17 diagnostics and Halcyon 99. A detached unchanged-main checkout at aae0742 produces the same diagnostics after normalizing source-line shifts, generated property-count elisions and equivalent union ordering; no new diagnostics.
- Architecture passes. The broader Semgrep scan finds three existing `as any` violations in Habitat useNotifications and Hearth useSpeechInput; both files are byte-identical to unchanged main. Changed-file scanning is the publication gate; no suppression was added. Dependency dedupe and frozen-lockfile install pass.
- Habitat and Halcyon production PWA generation passes. At 390×844 on isolated local origins, Habitat's shared empty state, habit creation/reload, sheet focus wrap, Escape dismissal, opener restoration, scroll unlock, confirmation cancellation, confirmed archive with the archived record visible after fresh navigation, and both Calendar empty states were exercised. Halcyon's shared homepage action reaches the contact form; the contact-search no-match state renders with generated semantic CSS tokens, no horizontal overflow and locally bundled icons.
- A throwaway probe using the actual shared/Habitat composables and Capacitor JS plugin bridge passed separately for simulated iOS and web: disabled→enabled→disabled preferences gate impact/notification/selection calls correctly. This is bridge-level behavior evidence, not a physical native-device certification; the probe was removed.
- Halcyon's separate contact-save path still raises `SQLITE_CORRUPT_VTAB: sqlite3 result code 267: database disk image is malformed`. The same first-contact failure was observed on an unchanged-main production build on a separate origin. It is not fixed or claimed as passing in this extraction PR.
