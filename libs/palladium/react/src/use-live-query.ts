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
 * A change notification supersedes the initial execution if the two overlap.
 * Parameter identity supports SQLite scalar values, bigint, and Uint8Array blobs.
 * ```tsx
 * const { rows, loading } = useLiveQuery<Task>(sql`SELECT * FROM tasks`);
 * ```
 */
function parameterIdentity(value: unknown): string {
  if (value === null) return "null:";
  if (value instanceof Uint8Array) {
    let encoded = "bytes:";
    for (const byte of value) encoded += byte.toString(16).padStart(2, "0");
    return encoded;
  }
  switch (typeof value) {
    case "undefined":
      return "undefined:";
    case "string":
      return `string:${value}`;
    case "boolean":
      return `boolean:${value ? 1 : 0}`;
    case "bigint":
      return `bigint:${value}`;
    case "number":
      return `number:${Object.is(value, -0) ? "-0" : value}`;
    default:
      throw new TypeError(`Unsupported live query parameter type: ${typeof value}`);
  }
}

function queryIdentity(params: readonly unknown[]): string {
  let identity = "";
  for (const value of params) {
    const encoded = parameterIdentity(value);
    identity += `${encoded.length}:${encoded}`;
  }
  return identity;
}

export function useLiveQuery<T = Record<string, unknown>>(query: SqlQuery): LiveQueryResult<T> {
  const engine = usePalladium();
  const queryKey = `${query.text}\u0000${queryIdentity(query.params)}`;
  const [state, setState] = useState<{
    key: string;
    rows: T[];
    loading: boolean;
    error: Error | null;
  }>({ key: queryKey, rows: [], loading: true, error: null });

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — keyed on text+params, not object identity
  useEffect(() => {
    let cancelled = false;
    let changed = false;
    setState({ key: queryKey, rows: [], loading: true, error: null });

    const lq = engine.liveQuery<T>(query);

    const unsub = lq.on("change", (newRows) => {
      if (!cancelled) {
        changed = true;
        setState({ key: queryKey, rows: newRows, loading: false, error: null });
      }
    });

    lq.exec()
      .then((initial) => {
        if (!cancelled && !changed) {
          setState({ key: queryKey, rows: initial, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !changed) {
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
