## Summary

<!-- 1–3 bullets. What this PR does and why. -->

## Changes

<!-- Bulleted list of significant changes. Group by app/lib if multi-scoped. -->

## Verify

- [ ] `pnpm --filter <pkg> verify` (or `just verify <pkg>`) passes for affected packages
- [ ] Root `pnpm ci` passes (or noted reason if skipped)
- [ ] `AGENTS.md` updated if conventions, commands, or architecture changed
- [ ] `GLOSSARY.md` updated if a new domain term was introduced
- [ ] Schema migrations are idempotent (re-running `applySchema` is a no-op)
- [ ] No new `as any`, `@ts-ignore`, or `// nosemgrep` without an inline reason
- [ ] No hand-edits to `pnpm-lock.yaml` or `Cargo.lock` (used `pnpm add` / `cargo add`)

## Test plan

<!--
Bulleted checklist of manual / e2e steps reviewers should run.
Example:
- [ ] `pnpm --filter habitat dev` → open `/habits/[id]`, confirm new field renders
- [ ] Toggle reduced-motion → confirm animation is gated
-->
