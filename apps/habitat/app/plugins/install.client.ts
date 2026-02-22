// Capture the beforeinstallprompt event as early as possible.
// Storing it in useState makes it available to useInstall() across all components.
export default defineNuxtPlugin(() => {
  const deferredPrompt = useState<BeforeInstallPromptEvent | null>('install-prompt', () => null)

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt.value = e as BeforeInstallPromptEvent
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt.value = null
  })
})
