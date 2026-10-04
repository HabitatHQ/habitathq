/// <reference lib="webworker" />
import { setCacheNameDetails } from 'workbox-core'
import { cleanupOutdatedCaches, matchPrecache, precache } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

const scope = new URL(self.registration.scope)
setCacheNameDetails({ prefix: 'hephaestus', suffix: encodeURIComponent(scope.href) })
// Nuxt's precache manifest identifies the index shell by the scope root URL.
const shellUrl = scope.href

// One fetch handler owns routing. Workbox still owns revisioned cache keys.
precache(self.__WB_MANIFEST)
cleanupOutdatedCaches()

async function navigationResponse(request: Request): Promise<Response> {
  const response = (await matchPrecache(shellUrl)) ?? (await fetch(request))
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (
    request.method !== 'GET' ||
    url.origin !== scope.origin ||
    !url.pathname.startsWith(scope.pathname)
  )
    return

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
  } else {
    event.respondWith(matchPrecache(request.url).then((cached) => cached ?? fetch(request)))
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
