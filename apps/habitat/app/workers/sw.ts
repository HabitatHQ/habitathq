/// <reference lib="webworker" />
import { setCacheNameDetails } from 'workbox-core'
import { cleanupOutdatedCaches, matchPrecache, precache } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

const registrationScope = new URL(self.registration.scope)
setCacheNameDetails({ prefix: 'habitat', suffix: encodeURIComponent(registrationScope.href) })

const RUNTIME_CACHE_PREFIX = 'habitat-runtime-assets'
const RUNTIME_CACHE_VERSION = 'v1'
const scopeCacheKey = encodeURIComponent(registrationScope.href)
const runtimeCacheScopePrefix = `${RUNTIME_CACHE_PREFIX}:${scopeCacheKey}:`
const runtimeCacheName = `${runtimeCacheScopePrefix}${RUNTIME_CACHE_VERSION}`
const navigationShellUrl = new URL('index.html', registrationScope)
const publicAssetNames: Record<string, true> = {
  'favicon.svg': true,
  'manifest.webmanifest': true,
  'licenses.json': true,
}

function isRuntimeAssetRequest(request: Request, url: URL): boolean {
  if (
    request.method !== 'GET' ||
    url.origin !== registrationScope.origin ||
    request.url.includes('?') ||
    request.headers.has('range') ||
    !url.pathname.startsWith(registrationScope.pathname)
  ) {
    return false
  }

  const path = url.pathname.slice(registrationScope.pathname.length)
  return (
    path.startsWith('_nuxt/') ||
    path.startsWith('icons/') ||
    path.startsWith('screenshots/') ||
    publicAssetNames[path] === true
  )
}
async function cacheResponse(
  cache: Promise<Cache>,
  request: Request,
  response: Response,
): Promise<void> {
  if (
    !response.ok ||
    response.type === 'opaque' ||
    response.redirected ||
    response.status === 206
  ) {
    return
  }
  try {
    await (await cache).put(request, response.clone())
  } catch {
    // Cache storage can fail under quota pressure without making the asset unavailable.
  }
}

function staleWhileRevalidate(event: FetchEvent): Promise<Response> {
  const { request } = event
  return matchPrecache(request.url).then((precacheResponse) => {
    if (precacheResponse) return precacheResponse

    const cache = caches.open(runtimeCacheName)
    const cachedResponse = cache
      .then((runtimeCache) => runtimeCache.match(request))
      .catch(() => undefined)
    const networkResponse = fetch(request)

    event.waitUntil(
      cachedResponse.then((cached) => {
        if (!cached) return undefined
        return networkResponse
          .then((response) => cacheResponse(cache, request, response))
          .catch(() => undefined)
      }),
    )

    return cachedResponse.then((cached) => {
      if (cached) return cached
      return networkResponse.then(async (response) => {
        await cacheResponse(cache, request, response)
        return response
      })
    })
  })
}

async function cleanupRuntimeCaches(): Promise<void> {
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith(runtimeCacheScopePrefix) && name !== runtimeCacheName)
      .map((name) => caches.delete(name)),
  )
}

// ─── Background reminder notifications ────────────────────────────────────────
// The main thread posts the day's reminder schedule here so the SW can fire
// notifications even when the page is backgrounded (via Periodic Background Sync).

interface SwReminder {
  id: string
  title: string
  body: string
  at: string
  icon: string
}

const SW_DB_NAME = 'habitat-sw'
const SW_STORE = 'reminders'

function openSwDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SW_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(SW_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function storeReminders(list: SwReminder[]): Promise<void> {
  const db = await openSwDb()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(SW_STORE, 'readwrite')
    tx.objectStore(SW_STORE).put(list, 'list')
    tx.oncomplete = () => {
      db.close()
      res()
    }
    tx.onerror = () => {
      db.close()
      rej(tx.error)
    }
  })
}

async function loadReminders(): Promise<SwReminder[]> {
  const db = await openSwDb()
  return new Promise((resolve) => {
    const tx = db.transaction(SW_STORE, 'readonly')
    const req = tx.objectStore(SW_STORE).get('list')
    req.onsuccess = () => {
      db.close()
      resolve(req.result ?? [])
    }
    req.onerror = () => {
      db.close()
      resolve([])
    }
  })
}

async function checkAndFireReminders(): Promise<void> {
  const reminders = await loadReminders()
  if (reminders.length === 0) return
  const now = Date.now()
  const fired: string[] = []
  for (const r of reminders) {
    const at = new Date(r.at).getTime()
    // Fire if we're past the scheduled time but within a 2-minute window
    if (now >= at && now - at <= 120_000) {
      await self.registration.showNotification(r.title, {
        body: r.body,
        icon: r.icon,
        requireInteraction: true,
      })
      fired.push(r.id)
    }
  }
  if (fired.length > 0) {
    await storeReminders(reminders.filter((r) => !fired.includes(r.id)))
  }
}

self.addEventListener('message', ((event: ExtendableMessageEvent) => {
  if (event.data?.type === 'SCHEDULE_REMINDERS') {
    storeReminders(event.data.reminders as SwReminder[]).catch(console.warn)
  }
}) as EventListener)

// Periodic Background Sync — Chrome on Android, fires ~every minInterval ms.
// Wakes the SW periodically so it can check and fire due reminders.
self.addEventListener('periodicsync', ((event: ExtendableEvent & { tag: string }) => {
  if (event.tag === 'check-reminders') {
    event.waitUntil(checkAndFireReminders())
  }
}) as EventListener)

// Take over immediately on install/update so new assets are served right away.
self.skipWaiting()
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(Promise.all([self.clients.claim(), cleanupRuntimeCaches()]))
})

// Precache all vite-pwa injected assets (JS, CSS, HTML, images, WASM, …).
precache(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Intercept navigation requests (HTML page loads) to inject COOP/COEP headers.
//
// GitHub Pages cannot serve custom HTTP headers, so we add them here.
// crossOriginIsolated = true is required for SharedArrayBuffer, which SQLite
// WASM needs for OPFS persistence.  This replaces the old coi-serviceworker.js
// script — one SW handles both precaching and header injection.
//
// For SPA deep-links (e.g. /habitat/habits), always serve the precached
// index.html shell rather than fetching from the network.
// Navigation requests receive the app shell and COOP/COEP headers. The custom
// runtime handler checks Workbox's precache before its own cache, so each
// request receives exactly one respondWith.
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)

  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const shell = await matchPrecache(navigationShellUrl.href)
        if (shell) return withCOIHeaders(shell)
        // Fallback: network (first load before SW is installed, or unusual env)
        return fetch(event.request).then(withCOIHeaders)
      })(),
    )
    return
  }

  if (isRuntimeAssetRequest(event.request, url)) {
    event.respondWith(staleWhileRevalidate(event))
  }
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
