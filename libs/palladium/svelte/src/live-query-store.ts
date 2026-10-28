import type { PalladiumEngine, SqlQuery, SyncStatus } from "@palladium/core";
import { toError } from "@palladium/core";
import { readable } from "svelte/store";

export interface LiveQueryValue<T> {
  rows: T[];
  loading: boolean;
  error: Error | null;
}

/**
 * Svelte readable store for reactive SQL queries.
 *
 * Each active subscription owns its pending initial result; teardown prevents
 * stale completions, and a change notification takes precedence over that result.
 * ```svelte
 * <script>
 *   import { liveQueryStore } from '@palladium/svelte';
 *   const tasks = liveQueryStore(db, sql`SELECT * FROM tasks`);
 * </script>
 * {#each $tasks.rows as task}
 *   <li>{task.name}</li>
 * {/each}
 * ```
 */
export function liveQueryStore<T = Record<string, unknown>>(
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  engine: PalladiumEngine<any>,
  query: SqlQuery,
) {
  return readable<LiveQueryValue<T>>({ rows: [], loading: true, error: null }, (set, update) => {
    let active = true;
    let changed = false;
    const lq = engine.liveQuery<T>(query);

    const unsub = lq.on("change", (rows) => {
      if (!active) return;
      changed = true;
      update((prev) => ({ ...prev, rows, loading: false, error: null }));
    });

    lq.exec()
      .then((rows) => {
        if (active && !changed) {
          set({ rows, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (active && !changed) {
          update((prev) => ({ ...prev, loading: false, error: toError(err) }));
        }
      });

    return () => {
      active = false;
      unsub();
      lq.cancel();
    };
  });
}

/**
 * Svelte readable store for sync status.
 *
 * ```svelte
 * <script>
 *   import { syncStatusStore } from '@palladium/svelte';
 *   const status = syncStatusStore(db);
 * </script>
 * <p>Sync: {$status}</p>
 * ```
 */
export function syncStatusStore(
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  engine: PalladiumEngine<any>,
) {
  return readable<SyncStatus>(engine.getSyncStatus(), (set) => {
    const unsub = engine.on("sync:status", set);
    set(engine.getSyncStatus());
    return unsub;
  });
}
