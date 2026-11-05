# Hearth audit repairs

## Scope and baseline

Fix the eight reported Hearth defects and directly related failure classes. User authorized regression tests, a PR, and merge to main. Work in `.worktrees/fix/hearth-audit-20261105` on `fix/hearth-audit-20261105`, based on freshly fetched/pulled main `fdc327a`. Preserve the dirty primary checkout and existing worktrees. Live PR search found no later Hearth repair implementing these findings.

## Contracts

1. Worker requests contain cloneable plain DTO snapshots, including reactive import arrays. Creating a chore must persist through the real browser worker; failures must be visible.
2. Monetary aggregation receives an explicit home currency. Never add unconverted foreign amounts as home money. Use same-currency amounts, a saved conversion whose target matches, or a known cached rate with explicit base/target/date. Exclude unresolved conversions and visibly identify incomplete totals. Preserve original amounts. Stored conversions must identify their target so changing home currency cannot relabel an old conversion. All dashboard, envelopes, reports, monthly totals, native-currency breakdowns, account totals, and recurring grouping must be checked for the same class.
3. JSON backup/restore covers all durable user-owned state, including chore completions, recurring decisions, merchant mappings, cached rates, and receipt data. Export a versioned complete format; continue accepting legacy v1 backups. Restoring a snapshot is an atomic replacement of user-owned data, not INSERT OR IGNORE. Validate before writes, preserve data on failure, and confirm destructive replacement in Settings. Internal seed/storage bookkeeping is not user data.
4. IOU canonical IDs and metadata have matching orientation independent of insertion order or lexical user IDs. Pairwise netting and settle-up preserve the debt convention: positive net means the to-user owes the from-user.
5. Fresh and previously initialized installs receive safe, idempotent default categories without overwriting custom records. Envelope create/edit lets the user select categories and persists those links. All category pickers use one flat-row traversal that retains arbitrary valid depth and full ancestry; income/expense filtering applies to the entire relevant root subtree. The Quick Add parser receives every stored category. Remove the obsolete two-level tree RPC. Show failures and do not silently create an unspendable envelope.
6. Enabled splits require a valid partner and positive share no greater than the expense. An empty placeholder is not a committed split. Validate at the database boundary too. Create expense plus IOU within one serialized database transaction, with rollback on a failed second write. Migrate the detailed form to this one operation; remove obsolete split-creation paths if no consumer remains.
7. Signed monetary quantities such as savings and budget remaining retain signs or an explicit deficit/overspent label; color alone is insufficient.
8. Quick Add keeps displayed cards reactive while constructing immutable scalar worker payloads. Edits made during the initial create request are applied to that same transaction without duplicating it or rewriting its saved conversion.

## Implementation ownership and interfaces

- Backend owner: `app/lib/db-shared.ts`, `app/types/database.ts`, `app/lib/hearth-export.ts`, `app/lib/worker-helpers.ts`, backend unit tests. Own all changes in these shared files, including backup and transaction contracts. Coordinate API shapes before frontend edits.
- Monetary owner: `app/lib/reports/amounts.ts`, monetary query helpers/new module if necessary, `app/pages/reports.vue`, `app/pages/index.vue`, `app/lib/recurring/*`, `app/pages/recurring.vue`, associated tests. Coordinate database query contracts with backend owner.
- Transaction/worker UI owner: `app/pages/transactions/*`, `app/pages/import.vue`, `app/pages/chores.vue`, `app/composables/useDatabase.ts`, worker/native dispatch serialization if necessary, `app/pages/settings.vue`, associated integration/E2E tests. Do not edit backend-owned types/database implementation; coordinate.
- Envelope/schema owner: `app/lib/db-schema.ts`, category seed definitions if needed, `app/pages/envelopes/index.vue`, seed/envelope tests. Own schema additions for saved conversion target metadata if required by money policy; coordinate exact names.
- Parent integrates, reviews, verifies, documents, commits, publishes and merges. Agents skip builds/lint/tests/formatting mid-flight; parent runs verification after integration.

Initial API proposal (backend owner may refine and notify all consumers before implementation): extend CREATE_TRANSACTION payload with optional `iou_split: { to_user_id: string; amount: number }`, consumed atomically, not stored as a transactions column. Split from-user comes from the transaction payer. Add an explicit home currency argument to financial queries. Persist `home_currency` alongside new home_amount values, nullable for legacy conversions. Summaries expose unresolved conversion counts. Preserve native per-currency breakdown arithmetic.

## Verification

- Full affected unit/integration files, then Hearth's complete unit suite, lint and both TypeScript checks.
- Real SQLite failure/rollback and restore-conflict/round-trip probes. Cover order permutations, mixed directions, malformed/legacy backups, category seed idempotence, unknown rates, changed home currency, and invalid split boundaries.
- Generated PWA real-worker browser smoke at mobile and desktop widths: fresh categories, linked envelope spending, chore create/edit/complete/reload, split create/direction/validation, known/unknown conversion totals, signed deficits, export/restore including completions and conflict replacement.
- Repository architecture, Semgrep and dedupe checks; identify baseline-only failures without suppressing them.
- Review exact PR head; request Copilot review, address real findings, obey branch protections, merge with exact reviewed SHA, and verify GitHub MERGED plus main revision.

## Evidence

- `pnpm --filter hearth verify` passed: Biome, TypeScript, Vue typecheck, and 343 unit/integration tests. Biome retains warnings; no errors were suppressed.
- Root `pnpm test:unit` passed all four apps: 1,814 passing tests and one skipped test.
- Generated production PWA: 178 desktop/mobile Chromium E2E tests passed without retries. Coverage uses the actual database worker and SQLite/OPFS, including split creation/direction/validation, serialized concurrent export, rejected-write recovery, complete restore/cancellation, CSV worker DTOs and pending-preview invalidation, stale/pending FX responses, saved conversion preservation, incomplete totals, and category-linked spending.
- Real SQLite regressions proved failed split inserts and failed replacement restores roll back, foreign account reconciliation uses the same conversion policy as displayed balances, and a backup remains restorable after a recurring transaction is deleted. The reconciliation and deleted-history cases were observed failing before the correction and passing afterward.
- Receipt round-trip covers a 131,073-byte image and native-shaped `number[]` BLOB reads through the real SQLite adapter test. Native devices were not exercised.
- Manual generated-PWA smoke used an isolated synthetic origin at 390px and 1440px. Created and completed a chore, reloaded to see `1 of 1 done`; linked a Food envelope to descendant Groceries spending; saved $125.50 against a $100 budget and observed −$25.50 overspent after reload; desktop reports showed $125.50 spent and −$125.50 saved without horizontal overflow. Exported v2 JSON, edited the expense, confirmed replacement of the original snapshot, and verified the original $125.50 amount, account balance, and chore completion returned. No page errors were recorded in the completed smoke.
- Independent source reviews found and corrected missing imports, inconsistent reconciliation arithmetic, overly strict recurring-history restore validation, and a stale CSV preview window. Detailed form errors are announced as alerts. Chart tooltips render stored names as canvas rich text, not executable HTML.
- Hearth Semgrep error rules passed. Root architecture checking exposed generated Playwright trace-viewer assets as false source dependencies after the first browser run; the source exclusion now also covers the already-gitignored `playwright-report/` and `test-results/` directories.
- Root `pnpm dedupe:check` remains non-green: it proposes dependency resolutions on the unchanged base lockfile. Worktree and base lockfile SHA-256 values matched exactly; dependency updates are outside this repair. The full Semgrep scan also reported findings outside Hearth.
- Initial browser attempts exposed test-selector/confirmation timing mistakes, which were corrected rather than weakening persisted-state checks. A timed-out first suite left its owned preview server behind; it was identified and stopped before the clean final run. The completed manual smoke tab/server were closed.

## CI follow-up

The first published head `21a97ce` passed local verification but GitHub's Chromium run exposed an edit-initialization race: typing a merchant before the saved transaction finished loading could combine the original and edited values. The editor now gates its fields until initialization completes, disables Save during loading/failure/not-found states, and exposes loading failures.

The offline conversion regression now holds the actual worker's `GET_TRANSACTION` request, verifies the editor cannot be edited or saved, releases the request, then edits and verifies the exact persisted merchant and original conversion. This removes timing dependence rather than retrying the failing test. After the correction, Hearth verification again passed all 343 tests and both typechecks, and all 178 generated-PWA browser cases passed without retries. An additional manual mobile smoke loaded the persisted $125.50 expense, changed its merchant to `Verified editor load`, reopened it, and observed that exact merchant with the amount unchanged and no page errors.

## Review follow-up

- Blocked reconciliation in both Settings and shared SQL operations while account-currency conversions are unresolved. Added SQLite coverage for missing source and destination transfer conversions, no mutation on rejection, and reconciliation after the missing rate arrives.
- Coalesced unresolved-only monthly expense and income sums to zero while retaining missing-conversion counts. Validated optional extension tables in legacy v1 backups before any mutation, and restored categories in parent-first order even when the snapshot lists children first.
- Added a scalar unresolved-IOU count instead of loading every historical split on Household. Detached and empty-currency splits remain visible as unresolved rather than producing a false settled state.
- Made CSV preview totals use the selected currency, exclude duplicates and unresolved conversions, and retain original imported amounts. Chore read failures now show an error instead of an empty household, and the preview server survives a failed file read.
- Kept Quick Add cards reactive while reconciling merchant, account, category, and transfer-destination corrections made during the actual create request. The real-worker regression delays that request and checks one persisted transaction, exact corrected fields, the visible Saved state, and unchanged original FX metadata.
- Extended category selection across envelopes, detailed entry, transaction editing, and Quick Add. Removed the obsolete two-level category-tree RPC and reused one flat-category traversal. Browser regressions cover four-level expense and income hierarchies and persistence through reload.
- Replaced incidental help-content/visibility tests with retained interaction and persistence coverage. Envelope fixtures use local calendar dates, and assertions still verify persisted category links and spending.
- Manual final generated-PWA checks used synthetic data at 390px and 1440px. A child-before-parent backup restored a fourth-level expense category, the editor displayed its full path, and a newly entered €15 expense consumed the linked envelope: €25 spent against €20 budget, −€5 overspent. Desktop reports showed €25 spent, −€25 saved, and an explicit notice excluding four unresolved conversions, with no horizontal overflow or page errors.
- Final follow-up verification passed: Hearth formatting/error checks and both typechecks; 351 Hearth tests; all four app suites with 1,822 passing tests and one skip; generated PWA build and all 164 desktop/mobile Chromium cases without retries; architecture and Hearth Semgrep error checks. The reduced browser count reflects removal of incidental help-content tests, not removal of financial-flow regressions. The final manual tab and preview server were closed.

## Final review edge cases

- Dashboard and Household now count both detached IOUs and empty-currency transaction splits as unresolved. The real-SQLite regression demonstrated Dashboard returning one while Household returned two before the correction.
- Editing a transaction with no saved conversion now persists a newly available conversion instead of preserving null metadata. The generated-PWA regression demonstrated a renamed €10 expense retaining null conversion fields despite a newly cached EUR→USD rate of 1.25 before the correction; the required saved result is −$12.50 with the exact rate and target currency.
- After both corrections: Hearth checks/typechecks, all four app unit suites (1,822 passed; one skipped), the generated PWA build, all 166 desktop/mobile Chromium cases without retries, architecture checks, and Hearth Semgrep error checks passed.
- Manual mobile smoke restored an unconverted £20 expense with a newly available exact-date GBP→EUR rate of 2, changed only its merchant, and verified the real Settings JSON export contained the original −£20 plus `home_amount: -40`, `home_currency: EUR`, and `exchange_rate: 2`, with no page errors. The managed browser's attempted external-response interception did not deliver a quote, so this manual scenario used a rate restored through the UI; Playwright independently exercised the successful external-response path. The smoke tab and server were closed.
