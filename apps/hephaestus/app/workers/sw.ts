import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Inject the precache manifest from vite-pwa
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ── COOP/COEP headers on navigation responses ─────────────────────────────────
// Required for SharedArrayBuffer (SQLite WASM). Mirrors Habitat's SW pattern.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        const headers = new Headers(response.headers)
        headers.set('Cross-Origin-Opener-Policy', 'same-origin')
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }),
    )
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
