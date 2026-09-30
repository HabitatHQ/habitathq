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
import type { BusFacade, Role, WorkerDiagnostic, WorkerFacade } from "./db-owner.js";
import type { DbApi } from "./protocol.js";

/** A live connection to a worker running {@link import("./db-owner.js").startDbOwner}. */
export interface WorkerConnection<S extends object> {
  /** Typed proxy to the app's service methods; calls are routed to the leader. */
  readonly service: Comlink.Remote<S>;
  /** Subscribe to invalidations from any tab. Returns an unsubscribe function. */
  onInvalidate(cb: (tables: readonly string[]) => void): () => void;
  /** Subscribe to role changes. Returns an unsubscribe function. */
  onRole(cb: (role: Role) => void): () => void;
  /** Subscribe to promotion errors. Returns an unsubscribe function. */
  onError(cb: (message: string) => void): () => void;
  /** Fires privacy-safe leadership and request-recovery diagnostics. */
  onDiagnostic(cb: (diagnostic: WorkerDiagnostic) => void): void;
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
    onInvalidate: (cb) => {
      const subscriptionId = crypto.randomUUID();
      void bus.onInvalidate(subscriptionId, Comlink.proxy(cb));
      return () => void bus.offInvalidate(subscriptionId);
    },
    onRole: (cb) => {
      const subscriptionId = crypto.randomUUID();
      void bus.onRole(subscriptionId, Comlink.proxy(cb));
      return () => void bus.offRole(subscriptionId);
    },
    onError: (cb) => {
      const subscriptionId = crypto.randomUUID();
      void bus.onError(subscriptionId, Comlink.proxy(cb));
      return () => void bus.offError(subscriptionId);
    },
    onDiagnostic: (cb) => void bus.onDiagnostic(Comlink.proxy(cb)),
  };
}

export interface PalladiumClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  mutate(sql: string, params?: readonly unknown[]): Promise<number>;
  /** Subscribe to invalidations from any tab. */
  onInvalidate(cb: (tables: readonly string[]) => void): () => void;
  /** Subscribe to role changes. */
  onRole(cb: (role: Role) => void): () => void;
  /** Convenience: re-run `sql` now and again on every invalidation. */
  live<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[],
    onRows: (rows: T[]) => void,
  ): () => void;
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
      const unsubscribe = client.onInvalidate(() => run());
      run();
      return unsubscribe;
    },
  };
  return client;
}
