import { Capacitor } from '@capacitor/core'

// BeforeInstallPromptEvent is not in standard TypeScript lib types
declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>
    readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
}

export function useInstall() {
  const deferredPrompt = useState<BeforeInstallPromptEvent | null>('install-prompt', () => null)

  // Running as an installed PWA (standalone/fullscreen/minimal-ui display mode)
  // or as a native Capacitor app — both count as "installed".
  const isInstalled = computed(() =>
    Capacitor.isNativePlatform() ||
    (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches),
  )

  // Install prompt is available and app is not yet installed
  const canInstall = computed(() => !isInstalled.value && deferredPrompt.value !== null)

  // iOS Safari without the app installed — needs manual "Add to Home Screen"
  const isIosSafari = computed(() => {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    const isIos = /iphone|ipad|ipod/i.test(ua)
    const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios|edgios|edg\//i.test(ua)
    return isIos && isSafari && !isInstalled.value
  })

  // Desktop/Android non-Chromium browser (Firefox, old Safari on macOS, etc.)
  const isUnsupportedBrowser = computed(() => {
    if (typeof navigator === 'undefined' || isInstalled.value || isIosSafari.value) return false
    const ua = navigator.userAgent
    const isIos = /iphone|ipad|ipod/i.test(ua)
    if (isIos) return false
    const isChromium = /chrome|chromium|crios/i.test(ua) && !/edge\/[0-9]/i.test(ua) || /edg\//i.test(ua) || /opr\//i.test(ua)
    return !isChromium
  })

  // Chromium-based browser that supports install but hasn't offered the prompt yet
  // (e.g. Chrome on Android before engagement criteria are met, or after prompt was dismissed).
  // User can still install via the browser menu (⋮ → "Install app" / "Add to Home Screen").
  const isChromiumNoPrompt = computed(() =>
    !isInstalled.value && !canInstall.value && !isIosSafari.value && !isUnsupportedBrowser.value,
  )

  const installing = ref(false)

  async function install() {
    if (!deferredPrompt.value) return
    installing.value = true
    try {
      await deferredPrompt.value.prompt()
      const { outcome } = await deferredPrompt.value.userChoice
      if (outcome === 'accepted') deferredPrompt.value = null
    } finally {
      installing.value = false
    }
  }

  return { isInstalled, canInstall, isIosSafari, isUnsupportedBrowser, isChromiumNoPrompt, installing, install }
}
