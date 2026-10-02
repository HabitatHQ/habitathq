import type { SqlQuery } from "@palladium/core";
import { toError } from "@palladium/core";
import { useEffect, useState } from "react";
import { usePalladium } from "./provider.js";

export interface LiveQueryResult<T> {
  rows: T[];
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribe to a live SQL query.
 *
 * Re-renders whenever any of the query's watched tables are written to.
 *
 * ```tsx
 * const { rows, loading } = useLiveQuery<Task>(sql`SELECT * FROM tasks`);
 * ```
 */
export function useLiveQuery<T = Record<string, unknown>>(query: SqlQuery): LiveQueryResult<T> {
  const engine = usePalladium();
  const queryKey = `${query.text}\u0000${JSON.stringify(query.params)}`;
  const [state, setState] = useState<{
    key: string;
    rows: T[];
    loading: boolean;
    error: Error | null;
  }>({ key: queryKey, rows: [], loading: true, error: null });

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — keyed on text+params, not object identity
  useEffect(() => {
    let cancelled = false;
    setState({ key: queryKey, rows: [], loading: true, error: null });

    const lq = engine.liveQuery<T>(query);

    const unsub = lq.on("change", (newRows) => {
      if (!cancelled) {
        setState((current) => ({ ...current, key: queryKey, rows: newRows }));
      }
    });

    lq.exec()
      .then((initial) => {
        if (!cancelled) {
          setState({ key: queryKey, rows: initial, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ key: queryKey, rows: [], loading: false, error: toError(err) });
        }
      });

    return () => {
      cancelled = true;
      unsub();
      lq.cancel();
    };
  }, [engine, queryKey]);

  if (state.key !== queryKey) {
    return { rows: [], loading: true, error: null };
  }
  return { rows: state.rows, loading: state.loading, error: state.error };
}
