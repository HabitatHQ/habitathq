/**
 * Detect whether we're running inside a Capacitor native shell or as a PWA.
 *
 * Returns reactive `isNative` and `platform` ('ios' | 'android' | 'web').
 * Resolves at module load — values never change at runtime.
 */

let _isNative = false
let _platform: 'ios' | 'android' | 'web' = 'web'

try {
  // @capacitor/core is a peer dependency — may not be installed
  const { Capacitor } = await import('@capacitor/core')
  _isNative = Capacitor.isNativePlatform()
  _platform = (Capacitor.getPlatform() as 'ios' | 'android' | 'web') ?? 'web'
} catch {
  // not in a Capacitor shell
}

export function usePlatform() {
  const isNative = computed(() => _isNative)
  const platform = computed(() => _platform)

  return { isNative, platform }
}
