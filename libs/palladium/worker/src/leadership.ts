/**
 * Web Locks leader election.
 *
 * Every worker calls {@link becomeLeaderWhenAvailable} with the same lock name.
 * The Web Locks API grants the exclusive lock to exactly one waiter at a time
 * and queues the rest. The grant callback returns a promise we never resolve,
 * so the winner *holds* the lock for its whole lifetime; the lock releases only
 * when that worker is terminated (tab closed / crashed). At that moment the
 * next queued waiter is granted the lock and becomes the new leader.
 *
 * This is the single-owner invariant that makes OPFS SAHPool safe without
 * `steal`: one held lock ⇔ one open database connection.
 */

/**
 * Resolves once *this* worker has been granted leadership. Never rejects; if
 * the lock is currently held elsewhere, the returned promise simply stays
 * pending until that holder goes away.
 *
 * `onLost` fires if the lock is ever released back to the queue (only reachable
 * via external `steal`, which we never issue — included for completeness).
 */
export function becomeLeaderWhenAvailable(lockName: string, onLost?: () => void): Promise<void> {
  return new Promise<void>((resolveLeadership) => {
    void navigator.locks.request(lockName, { mode: "exclusive" }, () => {
      resolveLeadership();
      // Hold forever: the returned promise resolves only if the lock is stolen,
      // which releases leadership back to the queue.
      return new Promise<void>((release) => {
        // no-op: we intentionally never call release() ourselves.
        void release;
      }).then(() => onLost?.());
    });
  });
}
