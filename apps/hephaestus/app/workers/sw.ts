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

async function navigationResponse(request: Request): Promise<Response> {
  const response = (await matchPrecache(shellUrl)) ?? (await fetch(request))
  return withCOIHeaders(response)
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
    const response = matchPrecache(request.url).then((cached) => cached ?? fetch(request))
    event.respondWith(
      request.destination === 'worker' || request.destination === 'sharedworker'
        ? response.then((workerResponse) => withCOIHeaders(workerResponse))
        : response,
    )
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
