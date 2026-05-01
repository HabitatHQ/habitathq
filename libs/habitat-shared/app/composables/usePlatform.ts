/**
 * Detect whether we're running inside a Capacitor native shell or as a PWA.
 *
 * Returns reactive `isNative` and `platform` ('ios' | 'android' | 'web').
 */
export function usePlatform() {
  const isNative = computed(() => {
    try {
      const { Capacitor } = require('@capacitor/core')
      return Capacitor.isNativePlatform() as boolean
    } catch {
      return false
    }
  })

  const platform = computed(() => {
    try {
      const { Capacitor } = require('@capacitor/core')
      return (Capacitor.getPlatform() as 'ios' | 'android' | 'web') ?? 'web'
    } catch {
      return 'web' as const
    }
  })

  return { isNative, platform }
}
