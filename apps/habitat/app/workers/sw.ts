/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// Take over immediately on install/update so new assets are served right away.
self.skipWaiting()
self.addEventListener('activate', (e: ExtendableEvent) => e.waitUntil(self.clients.claim()))

// Precache all vite-pwa injected assets (JS, CSS, HTML, images, WASM, …).
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Intercept navigation requests (HTML page loads) to inject COOP/COEP headers.
//
// GitHub Pages cannot serve custom HTTP headers, so we add them here.
// crossOriginIsolated = true is required for SharedArrayBuffer, which SQLite
// WASM needs for OPFS persistence.  This replaces the old coi-serviceworker.js
// script — one SW handles both precaching and header injection.
//
// For SPA deep-links (e.g. /habitat/habits): GitHub Pages returns 404 for paths
// that have no matching file, so we always serve the precached index.html shell
// rather than fetching from the network.
self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    (async () => {
      const shell = await matchPrecache('index.html')
      if (shell) return withCOIHeaders(shell)
      // Fallback: network (first load before SW is installed, or unusual env)
      return fetch(event.request).then(withCOIHeaders)
    })(),
  )
})

function withCOIHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
