import { useHaptics as useSharedHaptics } from '@habitathq/shared/app/composables/useHaptics'
import { computed } from 'vue'

/**
 * Habitat binds the shared haptic implementation to its enableHaptics setting.
 */
export function useHaptics() {
  const { settings } = useAppSettings()
  return useSharedHaptics({
    enabled: computed(() => settings.value.enableHaptics !== false),
  })
}
