/**
 * Web Locks leader election.
 *
 * Every worker contends for the same exclusive lock. A successful promotion
 * holds it for the worker lifetime; a failed promotion releases the lock and
 * re-enters the queue after a bounded pause. The caller must close partially
 * opened resources before returning `"release"`. Retrying is essential because
 * OPFS/WASM startup can fail transiently after an iOS worker resumes, while
 * `steal` would violate the single-writer invariant.
 */

export type LeadershipDecision = "hold" | "release";

/** Minimal Web Locks surface, kept injectable for deterministic regression tests. */
export interface LockRequester {
  request(name: string, options: LockOptions, callback: () => Promise<void>): Promise<void>;
}

export interface LeadershipOptions {
  readonly locks?: LockRequester;
  readonly retryDelayMs?: number;
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_RETRY_DELAY_MS = 1_000;

/**
 * Contend for the named lock until this worker holds it or is terminated.
 *
 * A `"release"` decision deliberately yields to queued peers before retrying.
 * This is not a lock steal: every retry re-enters the browser's normal
 * exclusive-lock queue, so at most one worker can open the OPFS database.
 */
export function whileLeader(
  lockName: string,
  onAcquired: () => Promise<LeadershipDecision>,
  options: LeadershipOptions = {},
): void {
  const locks = options.locks ?? navigator.locks;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  void (async () => {
    for (;;) {
      try {
        await locks.request(lockName, { mode: "exclusive" }, async () => {
          const decision = await onAcquired();
          if (decision === "hold") {
            // Never resolve: hold the lock until this worker is terminated.
            await new Promise<void>(() => {});
          }
        });
      } catch (error) {
        options.onError?.(error);
      }
      await delay(retryDelayMs);
    }
  })();
}

function delay(ms: number): Promise<void> {
  // ES2022 is this package's public runtime baseline; Promise.withResolvers is
  // unavailable there, so the executor form is required for compatibility.
  return new Promise((resolve) => setTimeout(resolve, ms));
}
