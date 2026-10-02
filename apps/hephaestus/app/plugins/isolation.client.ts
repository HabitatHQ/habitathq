import { Capacitor } from '@capacitor/core'

export default defineNuxtPlugin({
  name: 'pwa-isolation',
  enforce: 'pre',
  async setup() {
    if (import.meta.dev || Capacitor.isNativePlatform()) return
    const config = useRuntimeConfig()
    if (config.public.buildTarget === 'native') return
    const base = config.app.baseURL
    const guard = `hephaestus-isolation-reload:${base}`
    if (window.crossOriginIsolated) {
      sessionStorage.removeItem(guard)
      return
    }
    const error = useState<string | null>('db-error', () => null)
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      error.value =
        'This browser needs a secure PWA origin and service-worker support to open local storage.'
      return
    }
    if (sessionStorage.getItem(guard)) {
      error.value =
        'Local storage requires cross-origin isolation. Check the host COOP/COEP headers and PWA service worker.'
      return
    }
    let timeout: number | undefined
    try {
      const ready = (async () => {
        await navigator.serviceWorker.register(`${base}sw.js`, { scope: base })
        await navigator.serviceWorker.ready
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
              once: true,
            })
          })
        }
      })()
      await Promise.race([
        ready,
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error('PWA service worker did not activate.')),
            10_000,
          )
        }),
      ])
      sessionStorage.setItem(guard, '1')
      window.clearTimeout(timeout)
      // The first headerless navigation is replaced before opening SQLite.
      await new Promise<void>(() => window.location.reload())
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : 'PWA offline storage could not initialize.'
    } finally {
      window.clearTimeout(timeout)
    }
  },
})
