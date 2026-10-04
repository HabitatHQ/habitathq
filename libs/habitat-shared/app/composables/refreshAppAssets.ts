export interface AppAssetScope {
  /** Absolute service-worker scope for this application deployment. */
  scope: string
  /** Application-owned cache prefix, including its trailing separator. */
  cachePrefix: string
}

/** Refresh only this deployment's offline assets; durable stores are untouched. */
export async function refreshAppAssets(options: AppAssetScope): Promise<void> {
  const scope = new URL(options.scope, window.location.origin)
  if (scope.origin !== window.location.origin || !scope.pathname.endsWith('/')) {
    throw new TypeError('Asset refresh requires a same-origin directory scope')
  }
  if (!options.cachePrefix || options.cachePrefix === 'workbox-') {
    throw new TypeError('Asset refresh requires an application-specific cache prefix')
  }
  if ('serviceWorker' in navigator) {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      if (registration.scope === scope.href && !(await registration.unregister())) {
        throw new Error('The application service worker could not be unregistered')
      }
    }
  }
  if ('caches' in window) {
    const encodedScope = encodeURIComponent(scope.href)
    for (const name of await caches.keys()) {
      const owned =
        name.startsWith(options.cachePrefix) &&
        (name.endsWith(`-${encodedScope}`) || name.includes(`:${encodedScope}:`))
      // Workbox's previous default cache names already include the full scope.
      const legacy = name.startsWith('workbox-precache-') && name.endsWith(`-${scope.href}`)
      if ((owned || legacy) && !(await caches.delete(name))) {
        throw new Error(`The application asset cache could not be deleted: ${name}`)
      }
    }
  }
  window.location.reload()
}
