import { Capacitor } from '@capacitor/core'

/**
 * Provides haptic feedback on native platforms; no-ops on web.
 */
export function useHaptics() {
  async function impact(style: 'light' | 'medium' | 'heavy' = 'medium') {
    if (!Capacitor.isNativePlatform()) return
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }
    await Haptics.impact({ style: map[style] })
  }

  async function notification(type: 'success' | 'warning' | 'error' = 'success') {
    if (!Capacitor.isNativePlatform()) return
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    const map = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    }
    await Haptics.notification({ type: map[type] })
  }

  return { impact, notification }
}
