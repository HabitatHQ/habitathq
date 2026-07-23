/**
 * Main-thread handle. One per tab.
 *
 * Wraps the tab's dedicated worker with Comlink so callers get a typed,
 * promise-returning `DbApi` proxy — no message unions, no correlation ids, no
 * `dispatch()` switch. Leadership and failover happen entirely inside the
 * worker; this handle never changes across a leader handoff.
 */

import * as Comlink from "comlink";
import type { WorkerFacade } from "./db-owner.js";

export interface PalladiumClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  mutate(sql: string, params?: readonly unknown[]): Promise<number>;
  /** Fires whenever `tables` change in *any* tab. Return value unsubscribes. */
  onInvalidate(cb: (tables: readonly string[]) => void): void;
  /** Fires with the current role and again on every change. */
  onRole(cb: (role: "leader" | "follower") => void): void;
  /** Convenience: re-run `sql` now and again on every matching invalidation. */
  live<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[],
    onRows: (rows: T[]) => void,
  ): void;
}

/**
 * Connect to a worker running {@link import("./db-owner.js").startDbOwner}.
 * The worker instance is owned by the caller (so it controls bundling of the
 * worker entry, per Vite's `new Worker(new URL(...), { type: 'module' })`).
 */
export function createClient(worker: Worker): PalladiumClient {
  const remote = Comlink.wrap<WorkerFacade>(worker);

  const client: PalladiumClient = {
    query: (sql, params) => remote.query(sql, params) as Promise<never>,
    mutate: (sql, params) => remote.mutate(sql, params),
    onInvalidate: (cb) => {
      void remote.onInvalidate(Comlink.proxy(cb));
    },
    onRole: (cb) => {
      void remote.onRole(Comlink.proxy(cb));
    },
    live: (sql, params, onRows) => {
      const run = (): void => {
        void client.query(sql, params).then((rows) => onRows(rows as never));
      };
      client.onInvalidate(() => run());
      run();
    },
  };
  return client;
}
