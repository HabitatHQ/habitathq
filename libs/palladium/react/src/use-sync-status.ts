import type { SyncStatus } from "@palladium/core";
import { useEffect, useState } from "react";
import { usePalladium } from "./provider.js";

/**
 * Returns the current sync status and re-renders on status changes.
 *
 * ```tsx
 * const status = useSyncStatus(); // 'idle' | 'syncing' | 'error' | 'offline'
 * ```
 */
export function useSyncStatus(): SyncStatus {
  const engine = usePalladium();
  const [status, setStatus] = useState<SyncStatus>(() => engine.getSyncStatus());

  useEffect(() => {
    const unsub = engine.on("sync:status", setStatus);
    // Sync with any status change that happened between render and effect.
    setStatus(engine.getSyncStatus());
    return unsub;
  }, [engine]);

  return status;
}
