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
  /** Subscribe to privacy-safe diagnostics. Returns an unsubscribe function. */
  onDiagnostic(cb: (diagnostic: WorkerDiagnostic) => void): () => void;
}

function reportSubscriptionError(error: unknown): void {
  console.error("palladium/worker: subscription operation failed", error);
}

function subscribe<T>(
  register: (id: string, callback: (value: T) => void) => Promise<void>,
  unregister: (id: string) => Promise<void>,
  cb: (value: T) => void,
): () => void {
  const id = crypto.randomUUID();
  let active = true;
  const registration = register(
    id,
    Comlink.proxy((value: T) => {
      if (active) return cb(value);
    }),
  ).catch((error: unknown) => {
    reportSubscriptionError(error);
  });
  return () => {
    if (!active) return;
    active = false;
    void registration.then(() => unregister(id)).catch(reportSubscriptionError);
  };
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
    service: remote as unknown as Comlink.Remote<S>,
    onInvalidate: (cb) =>
      subscribe(
        (id, callback) => bus.onInvalidate(id, callback),
        (id) => bus.offInvalidate(id),
        cb,
      ),
    onRole: (cb) =>
      subscribe(
        (id, callback) => bus.onRole(id, callback),
        (id) => bus.offRole(id),
        cb,
      ),
    onError: (cb) =>
      subscribe(
        (id, callback) => bus.onError(id, callback),
        (id) => bus.offError(id),
        cb,
      ),
    onDiagnostic: (cb) =>
      subscribe(
        (id, callback) => bus.onDiagnostic(id, callback),
        (id) => bus.offDiagnostic(id),
        cb,
      ),
  };
}

export interface PalladiumClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  mutate(sql: string, params?: readonly unknown[]): Promise<number>;
  /** Subscribe to invalidations from any tab. */
  onInvalidate(cb: (tables: readonly string[]) => void): () => void;
  /** Subscribe to role changes. */
  onRole(cb: (role: Role) => void): () => void;
  /** Re-run `sql` on invalidation; an optional handler receives active query failures. */
  live<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[],
    onRows: (rows: T[]) => void,
    onError?: (error: Error) => void,
  ): () => void;
}
/** Convenience client for the query/mutate {@link DbApi} service shape. */
export function createClient(worker: Worker): PalladiumClient;
/** Build a query/mutate client on an existing typed connection. */
export function createClient(connection: WorkerConnection<DbApi>): PalladiumClient;
export function createClient(
  workerOrConnection: Worker | WorkerConnection<DbApi>,
): PalladiumClient {
  const conn =
    "service" in workerOrConnection ? workerOrConnection : connect<DbApi>(workerOrConnection);
  const client: PalladiumClient = {
    query: (sql, params) => conn.service.query(sql, params) as Promise<never>,
    mutate: (sql, params) => conn.service.mutate(sql, params),
    onInvalidate: conn.onInvalidate,
    onRole: conn.onRole,
    live: (sql, params, onRows, onError) => {
      let active = true;
      let requestId = 0;
      const run = (): void => {
        if (!active) return;
        const currentRequestId = ++requestId;
        void client
          .query(sql, params)
          .then(
            (rows) => {
              if (active && currentRequestId === requestId) return onRows(rows as never);
            },
            (error: unknown) => {
              if (!active || currentRequestId !== requestId) return;
              if (onError)
                return onError(error instanceof Error ? error : new Error(String(error)));
              reportSubscriptionError(error);
            },
          )
          .catch(reportSubscriptionError);
      };
      const unsubscribe = client.onInvalidate(() => run());
      run();
      return () => {
        if (!active) return;
        active = false;
        requestId += 1;
        unsubscribe();
      };
    },
  };
  return client;
}
