# Hearth audit repairs

## Scope and baseline

Fix the eight reported Hearth defects and directly related failure classes. User authorized regression tests, a PR, and merge to main. Work in `.worktrees/fix/hearth-audit-20261105` on `fix/hearth-audit-20261105`, based on freshly fetched/pulled main `fdc327a`. Preserve the dirty primary checkout and existing worktrees. Live PR search found no later Hearth repair implementing these findings.

## Contracts

1. Worker requests contain cloneable plain DTO snapshots, including reactive import arrays. Creating a chore must persist through the real browser worker; failures must be visible.
2. Monetary aggregation receives an explicit home currency. Never add unconverted foreign amounts as home money. Use same-currency amounts, a saved conversion whose target matches, or a known cached rate with explicit base/target/date. Exclude unresolved conversions and visibly identify incomplete totals. Preserve original amounts. Stored conversions must identify their target so changing home currency cannot relabel an old conversion. All dashboard, envelopes, reports, monthly totals, native-currency breakdowns, account totals, and recurring grouping must be checked for the same class.
3. JSON backup/restore covers all durable user-owned state, including chore completions, recurring decisions, merchant mappings, cached rates, and receipt data. Export a versioned complete format; continue accepting legacy v1 backups. Restoring a snapshot is an atomic replacement of user-owned data, not INSERT OR IGNORE. Validate before writes, preserve data on failure, and confirm destructive replacement in Settings. Internal seed/storage bookkeeping is not user data.
4. IOU canonical IDs and metadata have matching orientation independent of insertion order or lexical user IDs. Pairwise netting and settle-up preserve the debt convention: positive net means the to-user owes the from-user.
5. Fresh and previously initialized installs receive safe, idempotent default categories without overwriting custom records. Envelope create/edit lets the user select categories and persists those links. Show failures and do not silently create an unspendable envelope.
6. Enabled splits require a valid partner and positive share no greater than the expense. An empty placeholder is not a committed split. Validate at the database boundary too. Create expense plus IOU within one serialized database transaction, with rollback on a failed second write. Migrate the detailed form to this one operation; remove obsolete split-creation paths if no consumer remains.
7. Signed monetary quantities such as savings and budget remaining retain signs or an explicit deficit/overspent label; color alone is insufficient.

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
