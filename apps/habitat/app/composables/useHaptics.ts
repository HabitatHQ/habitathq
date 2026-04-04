import { Capacitor } from '@capacitor/core'
import type { AppSettings } from '~/composables/useAppSettings'

/**
 * Provides haptic feedback on native platforms; no-ops on web.
 * All methods respect the `enableHaptics` user setting.
 */
export function useHaptics() {
  function isDisabled(): boolean {
    if (!Capacitor.isNativePlatform()) return true
    try {
      const settings = useState<AppSettings>('app-settings')
      return settings.value?.enableHaptics === false
    } catch {
      return false
    }
  }

  async function impact(style: 'light' | 'medium' | 'heavy' = 'medium') {
    if (isDisabled()) return
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }
    await Haptics.impact({ style: map[style] })
  }

  async function notification(type: 'success' | 'warning' | 'error' = 'success') {
    if (isDisabled()) return
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    const map = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    }
    await Haptics.notification({ type: map[type] })
  }

  /**
   * Subtle tick for continuous selection changes — scroll pickers,
   * filter chips, day pills, stepper buttons, etc.
   * iOS: UISelectionFeedbackGenerator (very light 10ms tick)
   * Android: light click vibration
   */
  async function selectionChanged() {
    if (isDisabled()) return
    const { Haptics } = await import('@capacitor/haptics')
    await Haptics.selectionChanged()
  }

  return { impact, notification, selectionChanged }
}
