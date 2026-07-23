/**
 * Worker-side orchestrator. Runs *inside* each tab's dedicated worker.
 *
 * Responsibilities:
 * - contend for leadership (Web Locks);
 * - as **leader**: open the OPFS database, serve queries/mutations, expose a
 *   Comlink `DbApi` to every follower, and broadcast invalidations after writes;
 * - as **follower**: forward its tab's queries/mutations to the current leader
 *   over a BroadcastChannel-backed Comlink proxy, reconnecting on failover;
 * - either way: relay invalidations to its own main thread so live queries re-run.
 *
 * Call {@link startDbOwner} at the top of the worker module.
 */

import * as Comlink from "comlink";
import { makeBroadcastEndpoint } from "./broadcast-endpoint.js";
import { becomeLeaderWhenAvailable } from "./leadership.js";
import {
  CONTROL,
  type ControlMsg,
  type DbApi,
  type Epoch,
  isControl,
  type PeerId,
} from "./protocol.js";

/**
 * The persistent store the leader opens. Implemented by the app (e.g. around
 * `@palladium/sqlite-browser`'s OPFS SAHPool adapter). Only ever touched by the
 * worker that currently holds leadership.
 */
export interface OpfsBackend {
  /** Open + migrate. Called once, when this worker becomes leader. */
  open(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** Execute a write; resolve with the number of affected rows. */
  run(sql: string, params?: readonly unknown[]): Promise<number>;
}

export interface DbOwnerConfig {
  /** Logical database name; namespaces the lock and the BroadcastChannel. */
  readonly dbName: string;
  /** Factory for the backend the leader will open. */
  readonly backend: OpfsBackend;
}

/** The surface this worker exposes to its own main thread via Comlink. */
export interface WorkerFacade extends DbApi {
  /** Register a callback fired (in this tab) whenever `tables` change anywhere. */
  onInvalidate(cb: (tables: readonly string[]) => void): void;
  /** Register a callback fired when this tab's role flips. */
  onRole(cb: (role: "leader" | "follower") => void): void;
}

/** Extract the tables a write statement touches. Naive — spike-grade. */
function tablesFromSql(sql: string): string[] {
  const found = new Set<string>();
  const re =
    /(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from)\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi;
  for (const m of sql.matchAll(re)) if (m[1]) found.add(m[1]);
  return [...found];
}

export function startDbOwner(config: DbOwnerConfig): void {
  const peerId: PeerId = crypto.randomUUID();
  const channel = new BroadcastChannel(`palladium:${config.dbName}`);

  let role: "leader" | "follower" = "follower";
  let epoch: Epoch = "";

  // Follower state: a Comlink proxy to the current leader, rebuilt on failover.
  let leaderProxy: Comlink.Remote<DbApi> | null = null;
  // Leader state: followers we have already opened an RPC endpoint for.
  const servedFollowers = new Set<PeerId>();

  // Callbacks registered by this tab's main thread.
  let invalidateCb: ((tables: readonly string[]) => void) | null = null;
  let roleCb: ((role: "leader" | "follower") => void) | null = null;

  const post = (msg: ControlMsg): void => channel.postMessage(msg);

  // ── Follower: (re)connect a Comlink proxy to the announced leader ────────
  function connectToLeader(newLeaderId: PeerId, newEpoch: Epoch): void {
    if (role === "leader") return;
    epoch = newEpoch;
    leaderProxy = Comlink.wrap<DbApi>(makeBroadcastEndpoint(channel, peerId, newLeaderId));
    // Ask the leader to open an endpoint addressed back to us.
    post({ type: CONTROL.HELLO, from: peerId, epoch: newEpoch });
  }

  // ── Leader: open an RPC endpoint for a follower that said hello ──────────
  function serveFollower(followerId: PeerId, leaderApi: DbApi): void {
    if (servedFollowers.has(followerId)) return;
    servedFollowers.add(followerId);
    Comlink.expose(leaderApi, makeBroadcastEndpoint(channel, peerId, followerId));
  }

  // ── Local DB surface used by the leader (serves from the real backend) ───
  function makeLeaderApi(): DbApi {
    return {
      query: (sql, params) => config.backend.query(sql, params),
      mutate: async (sql, params) => {
        const affected = await config.backend.run(sql, params);
        const tables = tablesFromSql(sql);
        // BroadcastChannel does not echo to the sender, so notify locally too.
        invalidateCb?.(tables);
        post({ type: CONTROL.INVALIDATE, epoch, tables });
        return affected;
      },
    };
  }
  let leaderApi: DbApi | null = null;

  // ── Promotion ────────────────────────────────────────────────────────────
  async function promote(): Promise<void> {
    await config.backend.open();
    role = "leader";
    epoch = crypto.randomUUID();
    leaderProxy = null;
    leaderApi = makeLeaderApi();
    roleCb?.("leader");
    post({ type: CONTROL.LEADER, epoch, leader: peerId });
  }

  // ── Control-message handling ──────────────────────────────────────────────
  channel.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data;
    if (!isControl(data)) return; // tunnelled RPC frame — handled by endpoints
    switch (data.type) {
      case CONTROL.LEADER:
        if (role === "leader") return;
        if (data.epoch !== epoch) connectToLeader(data.leader, data.epoch);
        break;
      case CONTROL.WHO_IS_LEADER:
        if (role === "leader") post({ type: CONTROL.LEADER, epoch, leader: peerId });
        break;
      case CONTROL.HELLO:
        if (role === "leader" && leaderApi) serveFollower(data.from, leaderApi);
        break;
      case CONTROL.INVALIDATE:
        // Fan-out to this tab (leader already notified itself synchronously).
        if (role !== "leader") invalidateCb?.(data.tables);
        break;
    }
  });

  // Discover any incumbent leader, then queue for leadership.
  post({ type: CONTROL.WHO_IS_LEADER });
  void becomeLeaderWhenAvailable(`palladium-leader:${config.dbName}`).then(promote);

  // ── Forward with reconnect-on-failover (spike-grade retry) ───────────────
  async function withLeader<T>(call: (api: DbApi) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (role === "leader" && leaderApi) return call(leaderApi);
      if (leaderProxy) {
        // Comlink's Remote<DbApi> is structurally identical at runtime but drops
        // the query<T> generic; the cast re-asserts the DbApi surface.
        const proxyApi = leaderProxy as unknown as DbApi;
        try {
          return await withTimeout(call(proxyApi), 2_000);
        } catch {
          // Leader likely died; fall through to rediscover and retry.
        }
      }
      post({ type: CONTROL.WHO_IS_LEADER });
      await delay(250 * (attempt + 1));
    }
    throw new Error("palladium/worker: no leader available");
  }

  // ── Facade exposed to this tab's main thread ─────────────────────────────
  const facade: WorkerFacade = {
    query: (sql, params) => withLeader((api) => api.query(sql, params)),
    mutate: (sql, params) => withLeader((api) => api.mutate(sql, params)),
    onInvalidate: (cb) => {
      invalidateCb = cb;
    },
    onRole: (cb) => {
      roleCb = cb;
      cb(role);
    },
  };
  Comlink.expose(facade);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
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
