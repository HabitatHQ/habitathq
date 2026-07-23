/**
 * Main-thread handles. One per tab.
 *
 * {@link connect} is the generic primitive: it wraps the tab's dedicated worker
 * with Comlink and returns a typed proxy to the app's service plus the bus
 * control callbacks. Leadership and failover happen entirely inside the worker;
 * these handles never change across a leader handoff.
 *
 * {@link createClient} is a convenience for the query/mutate {@link DbApi}
 * shape (used by the example app), adding a `live()` helper on top of `connect`.
 */

import * as Comlink from "comlink";
import type { BusFacade, Role, WorkerFacade } from "./db-owner.js";
import type { DbApi } from "./protocol.js";

/** A live connection to a worker running {@link import("./db-owner.js").startDbOwner}. */
export interface WorkerConnection<S extends object> {
  /** Typed proxy to the app's service methods; calls are routed to the leader. */
  readonly service: Comlink.Remote<S>;
  /** Fires whenever `tables` change in *any* tab. */
  onInvalidate(cb: (tables: readonly string[]) => void): void;
  /** Fires with the current role and again on every change. */
  onRole(cb: (role: Role) => void): void;
  /** Fires if this tab's promotion fails to open the store. */
  onError(cb: (message: string) => void): void;
}

/**
 * Connect to a worker running {@link import("./db-owner.js").startDbOwner}.
 * The worker instance is owned by the caller (so it controls bundling of the
 * worker entry, per Vite's `new Worker(new URL(...), { type: 'module' })`).
 *
 * `S` must match the service exposed by the worker (its `config.methods`).
 */
export function connect<S extends object>(worker: Worker): WorkerConnection<S> {
  const remote = Comlink.wrap<WorkerFacade<S>>(worker);
  const bus = remote as unknown as Comlink.Remote<BusFacade>;
  return {
    // The bus methods live on the same proxy; expose only the app surface here.
    service: remote as unknown as Comlink.Remote<S>,
    onInvalidate: (cb) => void bus.onInvalidate(Comlink.proxy(cb)),
    onRole: (cb) => void bus.onRole(Comlink.proxy(cb)),
    onError: (cb) => void bus.onError(Comlink.proxy(cb)),
  };
}

export interface PalladiumClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  mutate(sql: string, params?: readonly unknown[]): Promise<number>;
  /** Fires whenever `tables` change in *any* tab. */
  onInvalidate(cb: (tables: readonly string[]) => void): void;
  /** Fires with the current role and again on every change. */
  onRole(cb: (role: Role) => void): void;
  /** Convenience: re-run `sql` now and again on every invalidation. */
  live<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[],
    onRows: (rows: T[]) => void,
  ): void;
}

/** Convenience client for the query/mutate {@link DbApi} service shape. */
export function createClient(worker: Worker): PalladiumClient {
  const conn = connect<DbApi>(worker);

  const client: PalladiumClient = {
    query: (sql, params) => conn.service.query(sql, params) as Promise<never>,
    mutate: (sql, params) => conn.service.mutate(sql, params),
    onInvalidate: conn.onInvalidate,
    onRole: conn.onRole,
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
