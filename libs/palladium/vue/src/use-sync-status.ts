import type { PalladiumEngine, SyncStatus } from "@palladium/core";
import { onUnmounted, type Ref, ref } from "vue";

/**
 * Vue composable for reactive sync status.
 *
 * ```ts
 * const status = useSyncStatus(db); // Ref<'idle' | 'syncing' | 'error' | 'offline'>
 * ```
 */
export function useSyncStatus(
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  engine: PalladiumEngine<any>,
): Ref<SyncStatus> {
  const status = ref<SyncStatus>(engine.getSyncStatus());

  const unsub = engine.on("sync:status", (s) => {
    status.value = s;
  });

  onUnmounted(unsub);

  return status;
}
