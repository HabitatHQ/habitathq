# Known Issues

## OPFS fails on first visit (static hosts only)

SQLite WASM needs `crossOriginIsolated` (COOP/COEP headers) for OPFS persistence. On GitHub Pages, headers are injected by the service worker (`sw.ts`), but the SW must install first. The very first visit has no SW → no headers → OPFS fails with "Missing SharedArrayBuffer." A single reload fixes it.

**Fix if this becomes a UX problem**: Add [`coi-serviceworker`](https://github.com/nicegoodthings/coi-serviceworker) as a `<script>` in `app.head` to auto-bootstrap and reload on first visit.

**Not affected**: dev (`vite.server.headers`) and self-hosted (Nitro `routeRules`).
