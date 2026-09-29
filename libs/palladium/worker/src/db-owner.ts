/**
 * Worker-side orchestrator. Runs *inside* each tab's dedicated worker.
 *
 * The bus is **service-generic**: the app supplies a factory that opens its
 * store and returns a service object (any set of async methods). The bus adds
 * ownership, failover, and transport on top:
 *
 * - contend for leadership (Web Locks);
 * - as **leader**: open the store, run the service, expose it to every follower
 *   over a BroadcastChannel-backed Comlink endpoint, and (when the service asks,
 *   via {@link OwnerContext.invalidate}) broadcast invalidations after writes;
 * - as **follower**: forward its tab's calls to the current leader over a
 *   Comlink proxy, reconnecting on failover;
 * - either way: relay invalidations and role changes to its own main thread.
 *
 * Call {@link startDbOwner} at the top of the worker module.
 *
 * @example
 * startDbOwner<{ query: ...; mutate: ... }>({
 *   dbName: "notes",
 *   methods: ["query", "mutate"],
 *   create: (ctx) => ({ async open() {…}, async query() {…}, async mutate() { …; ctx.invalidate(["notes"]) } }),
 * });
 */

import * as Comlink from "comlink";
import { makeBroadcastEndpoint } from "./broadcast-endpoint.js";
import { whileLeader } from "./leadership.js";
import {
  CONTROL,
  type ControlMsg,
  type Epoch,
  isControl,
  type LeaderMsg,
  type PeerId,
} from "./protocol.js";

export type Role = "leader" | "follower";

/** Any async method surface an app can expose over the bus. */
// biome-ignore lint/suspicious/noExplicitAny: methods are heterogeneous; args are the app's own.
export type ServiceMethods = Record<string, (...args: any[]) => Promise<unknown>>;

export interface WorkerDiagnostic {
  /** Lifecycle event name; never includes application data or request arguments. */
  readonly event:
    | "owner_started"
    | "leader_discovered"
    | "promotion_started"
    | "promotion_ready"
    | "promotion_failed"
    | "lock_unavailable"
    | "lock_request_failed"
    | "leader_rpc_timeout"
    | "leader_unavailable";
  /** Ephemeral ID for this worker instance, generated with crypto.randomUUID(). */
  readonly peerId: PeerId;
  /** Milliseconds since this worker's owner bus started. */
  readonly elapsedMs: number;
  readonly epoch?: Epoch;
  readonly leaderId?: PeerId;
  readonly attempt?: number;
  readonly error?: string;
}

/** Capabilities the bus hands to the leader's service. */
export interface OwnerContext {
  /**
   * Announce that `tables` changed. Fires every tab's `onInvalidate` callback
   * (including this one). Call after a successful write to drive live queries.
   */
  invalidate(tables: readonly string[]): void;
}

export interface DbOwnerConfig<S extends object> {
  /** Logical database name; namespaces the lock and the BroadcastChannel. */
  readonly dbName: string;
  /**
   * The service method names to expose to the main thread and forward to the
   * leader. Must list exactly the callable methods of `S` (not `open`).
   */
  readonly methods: readonly (keyof S & string)[];
  /**
   * Build the leader's service. Called only after this worker receives the
   * exclusive lock. Failed promotions must release any partially opened store
   * through the optional `close()` hook before another attempt is queued.
   */
  create(ctx: OwnerContext): S & { open(): Promise<void>; close?(): Promise<void> };
  /** Called with a user-visible message if `open()` fails on promotion. */
  onError?(message: string): void;
  /** Receives privacy-safe lifecycle diagnostics from this worker. */
  onDiagnostic?(diagnostic: WorkerDiagnostic): void;
}

/** The surface the bus adds on top of the app's service. */
export interface BusFacade {
  /** Register a callback fired (in this tab) whenever `tables` change anywhere. */
  onInvalidate(cb: (tables: readonly string[]) => void): void;
  /** Register a callback fired with the current role and again on every change. */
  onRole(cb: (role: Role) => void): void;
  /** Register a callback fired if this tab's promotion fails to open the store. */
  onError(cb: (message: string) => void): void;
  /** Register for privacy-safe leadership and request-recovery diagnostics. */
  onDiagnostic(cb: (diagnostic: WorkerDiagnostic) => void): void;
}

/** What the main thread sees over Comlink: the app's methods plus bus controls. */
export type WorkerFacade<S extends object> = S & BusFacade;

// Timing for follower→leader forwarding (see withLeader).
const CALL_DEADLINE_MS = 15_000; // total time to find a leader (covers slow first open + failover)
const CALL_TIMEOUT_MS = 10_000; // per-attempt timeout before assuming the leader is gone
const RETRY_INTERVAL_MS = 200; // pause between rediscovery attempts

class TimeoutError extends Error {}

type LeaderProxyAttempt =
  | { readonly kind: "absent" }
  | { readonly kind: "result"; readonly value: unknown }
  | { readonly kind: "timeout"; readonly error: TimeoutError };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Decide whether a leader announcement needs a fresh follower RPC endpoint.
 *
 * A request timeout intentionally clears the existing proxy. The current
 * leader then replies to discovery with its existing epoch; reconnecting in
 * that state is required to send a new HELLO and rebuild the endpoint.
 */
export function leaderAnnouncementRequiresConnection(
  currentEpoch: Epoch,
  currentLeaderId: PeerId | null,
  hasLeaderProxy: boolean,
  announcement: LeaderMsg,
): boolean {
  return (
    announcement.epoch !== currentEpoch ||
    announcement.leader !== currentLeaderId ||
    !hasLeaderProxy
  );
}

export function startDbOwner<S extends object>(config: DbOwnerConfig<S>): void {
  const startedAt = Date.now();
  const peerId: PeerId = crypto.randomUUID();
  const channel = new BroadcastChannel(`palladium:${config.dbName}`);

  let role: Role = "follower";
  let epoch: Epoch = "";

  // Leader state: the running service, and followers we've opened an endpoint for.
  let service: (S & { open(): Promise<void>; close?(): Promise<void> }) | null = null;
  const servedFollowers = new Set<PeerId>();

  // Follower state: a Comlink proxy to the current leader, rebuilt on failover.
  let leaderId: PeerId | null = null;
  let leaderProxy: Comlink.Remote<S> | null = null;

  // Callbacks registered by this tab's main thread.
  let diagnosticCb: ((diagnostic: WorkerDiagnostic) => void) | null = null;
  const recentDiagnostics: WorkerDiagnostic[] = [];
  let invalidateCb: ((tables: readonly string[]) => void) | null = null;
  let roleCb: ((role: Role) => void) | null = null;
  let errorCb: ((message: string) => void) | null = null;
  let lastError: string | null = null;
  let promotionAttempt = 0;

  function report(
    event: WorkerDiagnostic["event"],
    detail: Pick<WorkerDiagnostic, "error" | "leaderId"> = {},
  ): void {
    const diagnostic: WorkerDiagnostic = {
      event,
      peerId,
      elapsedMs: Date.now() - startedAt,
      ...(epoch ? { epoch } : {}),
      ...(leaderId ? { leaderId } : {}),
      ...(promotionAttempt > 0 ? { attempt: promotionAttempt } : {}),
      ...detail,
    };
    recentDiagnostics.push(diagnostic);
    if (recentDiagnostics.length > 20) recentDiagnostics.shift();
    diagnosticCb?.(diagnostic);
    config.onDiagnostic?.(diagnostic);
  }

  const post = (msg: ControlMsg): void => channel.postMessage(msg);

  const ctx: OwnerContext = {
    invalidate(tables) {
      // BroadcastChannel does not echo to the sender, so notify this tab too.
      invalidateCb?.(tables);
      post({ type: CONTROL.INVALIDATE, epoch, tables });
    },
  };

  // ── Follower: (re)connect a Comlink proxy to the announced leader ────────
  function connectToLeader(newLeaderId: PeerId, newEpoch: Epoch): void {
    if (role === "leader") return;
    epoch = newEpoch;
    leaderId = newLeaderId;
    leaderProxy = Comlink.wrap<S>(makeBroadcastEndpoint(channel, peerId, newLeaderId));
    report("leader_discovered", { leaderId: newLeaderId });
    // Ask the leader to open an endpoint addressed back to us.
    post({ type: CONTROL.HELLO, from: peerId, epoch: newEpoch });
  }

  // ── Leader: open an RPC endpoint for a follower that said hello ──────────
  function serveFollower(followerId: PeerId): void {
    if (!service || servedFollowers.has(followerId)) return;
    servedFollowers.add(followerId);
    Comlink.expose(service, makeBroadcastEndpoint(channel, peerId, followerId));
  }

  // ── Promotion ────────────────────────────────────────────────────────────
  async function promote(): Promise<"hold" | "release"> {
    promotionAttempt += 1;
    report("promotion_started");
    let svc: (S & { open(): Promise<void>; close?(): Promise<void> }) | null = null;
    try {
      svc = config.create(ctx);
      await svc.open();
    } catch (err) {
      // A failed startup may have opened the OPFS handle before migration
      // failed. Release it before yielding the Web Lock and re-entering queue.
      try {
        await svc?.close?.();
      } catch {
        // The original open error is the actionable failure for this attempt.
      }
      const message = errMsg(err);
      lastError = message;
      report("promotion_failed", { error: message });
      errorCb?.(message);
      config.onError?.(message);
      return "release";
    }
    service = svc;
    role = "leader";
    epoch = crypto.randomUUID();
    leaderId = null;
    leaderProxy = null;
    servedFollowers.clear();
    lastError = null;
    roleCb?.(role);
    report("promotion_ready");
    post({ type: CONTROL.LEADER, epoch, leader: peerId });
    return "hold";
  }

  // ── Control-message handling ──────────────────────────────────────────────
  channel.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data;
    if (!isControl(data)) return; // tunnelled RPC frame — handled by endpoints
    switch (data.type) {
      case CONTROL.LEADER:
        if (role === "leader") return;
        if (leaderAnnouncementRequiresConnection(epoch, leaderId, leaderProxy !== null, data)) {
          connectToLeader(data.leader, data.epoch);
        }
        break;
      case CONTROL.WHO_IS_LEADER:
        if (role === "leader") post({ type: CONTROL.LEADER, epoch, leader: peerId });
        break;
      case CONTROL.HELLO:
        if (role === "leader") serveFollower(data.from);
        break;
      case CONTROL.INVALIDATE:
        // Fan-out to this tab (the leader already notified itself synchronously).
        if (role !== "leader") invalidateCb?.(data.tables);
        break;
    }
  });

  // Discover any incumbent leader, then queue for leadership.
  report("owner_started");
  post({ type: CONTROL.WHO_IS_LEADER });
  if (typeof navigator.locks === "undefined") {
    const message = "palladium/worker: Web Locks API is unavailable";
    lastError = message;
    report("lock_unavailable", { error: message });
    config.onError?.(message);
  } else {
    whileLeader(`palladium-leader:${config.dbName}`, promote, {
      onError(error) {
        const message = `palladium/worker: Web Locks request failed: ${errMsg(error)}`;
        report("lock_request_failed", { error: message });
        if (!lastError) {
          lastError = message;
          errorCb?.(message);
          config.onError?.(message);
        }
      },
    });
  }

  // ── Forward a call to whoever currently owns the DB, with failover ───────
  type AnyMethod = (...args: unknown[]) => Promise<unknown>;
  const invoke = (api: object, method: string, args: unknown[]): Promise<unknown> =>
    ((api as Record<string, AnyMethod>)[method] as AnyMethod)(...args);

  async function invokeLeaderProxy(method: string, args: unknown[]): Promise<LeaderProxyAttempt> {
    const proxy = leaderProxy;
    if (!proxy) return { kind: "absent" };
    try {
      return {
        kind: "result",
        value: await withTimeout(invoke(proxy, method, args), CALL_TIMEOUT_MS),
      };
    } catch (err) {
      // A timeout means the leader is unreachable → rediscover and retry.
      // Any other rejection is an application error → propagate immediately.
      if (!(err instanceof TimeoutError)) throw err;
      report("leader_rpc_timeout", {
        error: err.message,
        ...(leaderId ? { leaderId } : {}),
      });
      leaderId = null;
      leaderProxy = null;
      return { kind: "timeout", error: err };
    }
  }

  async function withLeader(method: string, args: unknown[]): Promise<unknown> {
    const deadline = Date.now() + CALL_DEADLINE_MS;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      if (role === "leader" && service) {
        // Local call: application errors propagate directly (never retried).
        return invoke(service, method, args);
      }
      const attempt = await invokeLeaderProxy(method, args);
      if (attempt.kind === "result") return attempt.value;
      if (attempt.kind === "timeout") lastErr = attempt.error;
      post({ type: CONTROL.WHO_IS_LEADER });
      await delay(RETRY_INTERVAL_MS);
    }
    const error = lastErr ?? new Error(`palladium/worker: no leader for "${config.dbName}"`);
    report("leader_unavailable", { error: errMsg(error) });
    throw error;
  }

  // ── Facade exposed to this tab's main thread ─────────────────────────────
  const facade: Record<string, unknown> = {
    onInvalidate: (cb: (tables: readonly string[]) => void) => {
      invalidateCb = cb;
    },
    onRole: (cb: (role: Role) => void) => {
      roleCb = cb;
      cb(role);
    },
    onError: (cb: (message: string) => void) => {
      errorCb = cb;
      if (lastError) cb(lastError);
    },
    onDiagnostic: (cb: (diagnostic: WorkerDiagnostic) => void) => {
      diagnosticCb = cb;
      for (const diagnostic of recentDiagnostics) cb(diagnostic);
    },
  };
  for (const method of config.methods) {
    facade[method] = (...args: unknown[]) => withLeader(method, args);
  }
  Comlink.expose(facade);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
