import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import type { ComputedRef, Ref } from 'vue'

/**
 * Shared native haptics. Each app can wrap this implementation with its own
 * enabled policy.
 */
export function useHaptics(options?: { enabled?: Ref<boolean> | ComputedRef<boolean> }) {
  const { isNative } = usePlatform()
  const enabled = options?.enabled

  function isDisabled(): boolean {
    return !isNative.value || (enabled !== undefined && !enabled.value)
  }

  async function impact(style: 'light' | 'medium' | 'heavy' = 'medium') {
    if (isDisabled()) return
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }
    await Haptics.impact({ style: map[style] })
  }

  async function notification(type: 'success' | 'warning' | 'error' = 'success') {
    if (isDisabled()) return
    const map = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    }
    await Haptics.notification({ type: map[type] })
  }

  async function selectionChanged() {
    if (isDisabled()) return
    await Haptics.selectionChanged()
  }

  return { impact, notification, selectionChanged }
}
