/**
 * Wire protocol for the multi-tab bus.
 *
 * All coordination flows over a single BroadcastChannel per database name.
 * Two message families share the channel:
 *
 * - **Control** messages (`type` field): leader announcements, follower hello,
 *   and invalidation fan-out. Plain structured-clone payloads.
 * - **RPC** messages (`__rpc` field): Comlink's own protocol, tunnelled through
 *   {@link makeBroadcastEndpoint} with explicit `{from,to}` addressing so a
 *   broadcast medium can carry point-to-point calls.
 *
 * The two are disjoint (`type` vs `__rpc`) so a single `message` listener can
 * demultiplex them.
 */

/** Stable id for a participant on the bus (one per worker). */
export type PeerId = string;

/** Identifies a leadership term; changes every time a new leader is elected. */
export type Epoch = string;

export const CONTROL = {
  /** Broadcast by a worker the instant it wins the leader lock. */
  LEADER: "leader",
  /** Broadcast by a follower asking the current leader to announce itself. */
  WHO_IS_LEADER: "who-is-leader",
  /** Broadcast by a follower so the leader opens an RPC endpoint for it. */
  HELLO: "hello",
  /** Broadcast by the leader after a write; drives live-query re-runs. */
  INVALIDATE: "invalidate",
} as const;

export interface LeaderMsg {
  readonly type: typeof CONTROL.LEADER;
  readonly epoch: Epoch;
  readonly leader: PeerId;
}

export interface WhoIsLeaderMsg {
  readonly type: typeof CONTROL.WHO_IS_LEADER;
}

export interface HelloMsg {
  readonly type: typeof CONTROL.HELLO;
  readonly from: PeerId;
  readonly epoch: Epoch;
}

export interface InvalidateMsg {
  readonly type: typeof CONTROL.INVALIDATE;
  readonly epoch: Epoch;
  readonly tables: readonly string[];
}

export type ControlMsg = LeaderMsg | WhoIsLeaderMsg | HelloMsg | InvalidateMsg;

/** True when `data` is one of our control messages (not a tunnelled RPC frame). */
export function isControl(data: unknown): data is ControlMsg {
  return typeof data === "object" && data !== null && "type" in data;
}

/**
 * The database surface exposed over Comlink — identical whether the caller is a
 * tab's own main thread (local worker) or a follower worker reaching the leader.
 */
export interface DbApi {
  /** Read query. Returns result rows. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /**
   * Write. Runs on the leader, then broadcasts an invalidation for the tables
   * the SQL touched. Returns the number of affected rows.
   */
  mutate(sql: string, params?: readonly unknown[]): Promise<number>;
}
