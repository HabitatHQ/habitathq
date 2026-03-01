/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// ─── Background reminder notifications ────────────────────────────────────────
// The main thread posts the day's reminder schedule here so the SW can fire
// notifications even when the page is backgrounded (via Periodic Background Sync).

interface SwReminder { id: string; title: string; body: string; at: string; icon: string }

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
    tx.oncomplete = () => { db.close(); res() }
    tx.onerror = () => { db.close(); rej(tx.error) }
  })
}

async function loadReminders(): Promise<SwReminder[]> {
  const db = await openSwDb()
  return new Promise((resolve) => {
    const tx = db.transaction(SW_STORE, 'readonly')
    const req = tx.objectStore(SW_STORE).get('list')
    req.onsuccess = () => { db.close(); resolve(req.result ?? []) }
    req.onerror = () => { db.close(); resolve([]) }
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
      await self.registration.showNotification(r.title, { body: r.body, icon: r.icon, requireInteraction: true })
      fired.push(r.id)
    }
  }
  if (fired.length > 0) {
    await storeReminders(reminders.filter(r => !fired.includes(r.id)))
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
