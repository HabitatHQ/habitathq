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
  const isInstalled = computed(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(display-mode: standalone)').matches,
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

  return { isInstalled, canInstall, isIosSafari, isUnsupportedBrowser, installing, install }
}
