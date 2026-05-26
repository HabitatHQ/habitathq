---
scope: apps/hephaestus
applies_to: "apps/hephaestus/**"
last_verified: 2026-05-26
---

# Hephaestus — Agent Guide

Workout tracker PWA (Nuxt 4 SPA + Capacitor 8). Local-first, on-device.

> Read root `AGENTS.md` first — shared Nuxt+Capacitor architecture, DB-op pattern, schema migrations, and TypeScript conventions live there. This guide is a stub; expand as the app stabilises.

## Verify

```bash
pnpm --filter hephaestus verify
```

## Config

- `capacitor.config.ts` — appId TBD, webDir `.output/public`.
- `app/app.config.ts` — Nuxt UI primary / neutral (set in code).

## Status

Schema, routes, and conventions not yet documented. See `design.md` / `issues.md` in this app for in-flight planning.
