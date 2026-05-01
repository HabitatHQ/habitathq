/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

self.skipWaiting()
self.addEventListener('activate', (e: ExtendableEvent) => e.waitUntil(self.clients.claim()))

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Inject COOP/COEP headers on navigation requests (required for SQLite WASM SharedArrayBuffer).
// Serves precached index.html shell for all SPA routes (handles 404 on refresh).
self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    (async () => {
      const shell = await matchPrecache('index.html')
      if (shell) return withCOIHeaders(shell)
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
