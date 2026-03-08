import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import type { AppTheme } from '~/composables/useAppSettings'

const THEME_STATUS_BAR: Record<AppTheme, { backgroundColor: string; style: Style }> = {
  habitat: { backgroundColor: '#000000', style: Style.Dark },
  forest: { backgroundColor: '#0d1710', style: Style.Dark },
  ocean: { backgroundColor: '#081318', style: Style.Dark },
}

export function useStatusBar() {
  const { settings } = useAppSettings()

  async function syncStatusBar() {
    if (!Capacitor.isNativePlatform()) return
    const config = THEME_STATUS_BAR[settings.value.theme] ?? THEME_STATUS_BAR.habitat
    try {
      await StatusBar.setStyle({ style: config.style })
      await StatusBar.setBackgroundColor({ color: config.backgroundColor })
    } catch (e) {
      console.warn('StatusBar sync failed:', e)
    }
  }

  watch(() => settings.value.theme, syncStatusBar)

  return { syncStatusBar }
}
