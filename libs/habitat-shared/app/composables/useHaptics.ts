/**
 * Shared haptic feedback composable — no-ops on web, respects caller's enabled flag.
 *
 * Usage (basic — defaults to enabled on native):
 *   const { impact, selectionChanged } = useHaptics()
 *
 * Usage (with app-specific setting):
 *   const { settings } = useAppSettings()
 *   const enabled = computed(() => settings.value.enableHaptics)
 *   const { impact } = useHaptics({ enabled })
 */
export function useHaptics(options?: { enabled?: Ref<boolean> | ComputedRef<boolean> }) {
  const { isNative } = usePlatform()

  function isDisabled(): boolean {
    if (!isNative.value) return true
    if (options?.enabled && !options.enabled.value) return true
    return false
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

  async function selectionChanged() {
    if (isDisabled()) return
    const { Haptics } = await import('@capacitor/haptics')
    await Haptics.selectionChanged()
  }

  return { impact, notification, selectionChanged }
}
