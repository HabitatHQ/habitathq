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
    const lq = engine.liveQuery<T>(query);

    const unsub = lq.on("change", (rows) => {
      update((prev) => ({ ...prev, rows }));
    });

    lq.exec()
      .then((rows) => {
        set({ rows, loading: false, error: null });
      })
      .catch((err: unknown) => {
        update((prev) => ({ ...prev, loading: false, error: toError(err) }));
      });

    return () => {
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
    return unsub;
  });
}
