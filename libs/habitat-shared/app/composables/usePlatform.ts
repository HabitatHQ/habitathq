import { Capacitor } from '@capacitor/core'
import { computed } from 'vue'

/**
 * Detect whether we're running inside a Capacitor native shell or as a PWA.
 * Capacitor platform detection is stable for the lifetime of the app.
 */
const isNative = computed(() => Capacitor.isNativePlatform())
const platform = computed(() => Capacitor.getPlatform())

export function usePlatform() {
  return { isNative, platform }
}
