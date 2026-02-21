import { Capacitor } from '@capacitor/core'

/**
 * Detects whether the app is running inside a Capacitor native shell
 * or as a plain browser PWA.
 */
export function usePlatform() {
  const isNative = computed(() => Capacitor.isNativePlatform())
  const platform = computed(() => Capacitor.getPlatform()) // 'ios' | 'android' | 'web'

  return { isNative, platform }
}
