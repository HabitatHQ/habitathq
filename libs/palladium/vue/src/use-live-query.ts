import type { PalladiumEngine, SqlQuery } from "@palladium/core";
import { type Ref, onUnmounted, ref } from "vue";

export interface LiveQueryResult<T> {
  rows: Ref<T[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
}

/**
 * Vue composable for reactive SQL queries.
 *
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

  const lq = engine.liveQuery<T>(query);

  const unsub = lq.on("change", (newRows) => {
    if (!cancelled) rows.value = newRows;
  });

  lq.exec()
    .then((initial) => {
      if (!cancelled) {
        rows.value = initial;
        loading.value = false;
      }
    })
    .catch((err: unknown) => {
      if (!cancelled) {
        error.value = err instanceof Error ? err : new Error(String(err));
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
