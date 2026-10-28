import type { PalladiumEngine, SqlQuery } from "@palladium/core";
import { toError } from "@palladium/core";
import { onUnmounted, type Ref, ref } from "vue";

export interface LiveQueryResult<T> {
  rows: Ref<T[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
}

/**
 * Vue composable for reactive SQL queries.
 *
 * A change notification supersedes the initial execution if the two overlap.
 * ```ts
 * const { rows, loading } = useLiveQuery<Task>(db, sql`SELECT * FROM tasks`);
 * ```
 */
export function useLiveQuery<T = Record<string, unknown>>(
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  engine: PalladiumEngine<any>,
  query: SqlQuery,
): LiveQueryResult<T> {
  const rows = ref<T[]>([]) as Ref<T[]>;
  const loading = ref(true);
  const error = ref<Error | null>(null);

  let cancelled = false;
  let changed = false;

  const lq = engine.liveQuery<T>(query);

  const unsub = lq.on("change", (newRows) => {
    if (!cancelled) {
      changed = true;
      rows.value = newRows;
      loading.value = false;
      error.value = null;
    }
  });

  lq.exec()
    .then((initial) => {
      if (!cancelled && !changed) {
        rows.value = initial;
        loading.value = false;
      }
    })
    .catch((err: unknown) => {
      if (!cancelled && !changed) {
        error.value = toError(err);
        loading.value = false;
      }
    });

  onUnmounted(() => {
    cancelled = true;
    unsub();
    lq.cancel();
  });

  return { rows, loading, error };
}
