import { toError } from "@palladium/core";
import type { SqlQuery } from "@palladium/core";
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
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — keyed on text+params, not object identity
  useEffect(() => {
    let cancelled = false;

    const lq = engine.liveQuery<T>(query);

    const unsub = lq.on("change", (newRows) => {
      if (!cancelled) setRows(newRows);
    });

    lq.exec()
      .then((initial) => {
        if (!cancelled) {
          setRows(initial);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(toError(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      unsub();
      lq.cancel();
    };
  }, [engine, query.text, JSON.stringify(query.params)]);

  return { rows, loading, error };
}
