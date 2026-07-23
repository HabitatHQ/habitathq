/**
 * Web Locks leader election.
 *
 * Every worker calls {@link whileLeader} with the same lock name. The Web Locks
 * API grants the exclusive lock to exactly one waiter at a time and queues the
 * rest. When this worker is granted the lock it runs `onAcquired`:
 *
 * - resolve `"hold"` to KEEP leadership — the lock is held for this worker's
 *   whole lifetime and only releases when the worker is terminated (tab closed
 *   / crashed), at which point the next queued waiter becomes leader;
 * - resolve `"release"` to STEP ASIDE — the lock is released immediately so the
 *   next waiter can try. Use this when promotion failed (e.g. the database
 *   could not be opened): this worker gives up its turn and does not re-queue.
 *
 * This is the single-owner invariant that makes OPFS SAHPool safe without
 * `steal`: one held lock ⇔ one open database connection.
 */

export type LeadershipDecision = "hold" | "release";

/**
 * Contend for the named lock. `onAcquired` runs once this worker is granted it;
 * its resolution decides whether leadership is held or released (see above).
 *
 * Fire-and-forget: the returned request lives for the worker's lifetime.
 */
export function whileLeader(lockName: string, onAcquired: () => Promise<LeadershipDecision>): void {
  void navigator.locks.request(lockName, { mode: "exclusive" }, async () => {
    const decision = await onAcquired();
    if (decision === "hold") {
      // Never resolve: hold the lock until this worker is terminated.
      await new Promise<void>(() => {});
    }
    // "release" → returning resolves the grant, freeing the lock for the next
    // waiter. This worker's request is now complete and will not re-queue.
  });
}
