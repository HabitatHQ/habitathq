import type {
  DatabasePluginConfig,
  WorkerLifecycleMessage,
  WorkerResponseEnvelope,
} from "./types.js";

type PendingEntry = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

/**
 * Create a database plugin that manages the SQLite worker lifecycle.
 *
 * Returns `sendToWorker` (the RPC function) and `initialize` (an async
 * function that blocks until the worker is ready or an error is detected).
 *
 * The Nuxt app wraps `initialize` inside `defineNuxtPlugin` and feeds
 * errors into `useState('db-error')` — keeping Vue/Nuxt imports out of
 * this package.
 *
 * ## Worker protocol
 *
 * **Lifecycle** (no `id`): `{ type: 'READY' | 'LOCK_UNAVAILABLE' | 'INIT_ERROR' }`
 *
 * **Response** (has `id`):  `{ id, ok, data?, error? }`
 *
 * **Request** (posted):     `{ ...body, id }` — the `id` is appended by `sendToWorker`.
 */
export function createDatabasePlugin(config: DatabasePluginConfig) {
  const { appName, createWorker, native, startupTimeoutMs = 10_000 } = config;

  let worker: Worker | null = null;
  const pending = new Map<string, PendingEntry>();
  let nativeReady = false;
  let workerDead = false;
  let unavailableReason: string | null = null;

  function drainPending(reason: string): void {
    if (pending.size === 0) return;
    const err = new Error(reason);
    for (const [id, entry] of pending) {
      entry.reject(err);
      pending.delete(id);
    }
  }

  function markUnavailable(reason: string): boolean {
    if (unavailableReason !== null) return false;
    unavailableReason = reason;
    workerDead = true;
    drainPending(reason);
    return true;
  }

  // ── RPC ────────────────────────────────────────────────────────────────

  function sendToWorker<T>(req: Record<string, unknown>): Promise<T> {
    if (unavailableReason !== null) {
      return Promise.reject(new Error(unavailableReason));
    }
    if (nativeReady && native) {
      return native.dispatch(req) as Promise<T>;
    }
    if (workerDead) {
      return Promise.reject(new Error("Database worker is not available."));
    }
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker?.postMessage({ ...req, id });
    });
  }

  // ── Initialisation ─────────────────────────────────────────────────────

  /**
   * Call once during plugin setup.
   *
   * @param isNativePlatform — true when running inside a Capacitor native
   *   shell. The caller checks this (e.g. via `Capacitor.isNativePlatform()`)
   *   so this package has no dependency on `@capacitor/core`.
   * @param onError — called with a user-visible message when the database
   *   cannot be initialised (lock conflict, timeout, crash). Invoked at
   *   most once per plugin instance; late worker signals cannot revive a
   *   failed initialization.
   */
  async function initialize(
    isNativePlatform: boolean,
    onError: (msg: string) => void,
  ): Promise<void> {
    let failureNotified = false;
    const reportFailure = (message: string): void => {
      if (failureNotified) return;
      failureNotified = true;
      try {
        onError(message);
      } catch {
        // Reporting is advisory and must not prevent startup from settling.
      }
    };

    // ── Native path ────────────────────────────────────────────────────
    if (isNativePlatform && native) {
      try {
        await native.init();
        nativeReady = true;
      } catch (err) {
        const message = `Database failed to start: ${err instanceof Error ? err.message : String(err)}`;
        if (markUnavailable(message)) reportFailure(message);
      }
      return;
    }

    // ── Worker path ────────────────────────────────────────────────────
    worker = createWorker();

    // Response dispatcher — routes resolved/rejected promises by UUID.
    worker.addEventListener(
      "message",
      (e: MessageEvent<WorkerResponseEnvelope | WorkerLifecycleMessage>) => {
        const msg = e.data;
        if ("type" in msg) return; // lifecycle signals handled below
        if (unavailableReason !== null) return; // drop late responses after terminal failure
        const r = msg as WorkerResponseEnvelope;
        const p = pending.get(r.id);
        if (!p) return;
        pending.delete(r.id);
        r.ok ? p.resolve(r.data) : p.reject(new Error(r.error));
      },
    );

    // Block until the worker signals readiness (or fails).
    await new Promise<void>((resolve) => {
      let settled = false;
      let t: number | NodeJS.Timeout | undefined;
      let lifecycleHandler: ((e: MessageEvent<WorkerLifecycleMessage>) => void) | undefined;

      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        if (lifecycleHandler) {
          worker?.removeEventListener("message", lifecycleHandler);
        }
        resolve();
      };

      t = setTimeout(() => {
        const message = "Database took too long to start. Try closing other tabs or refreshing.";
        if (markUnavailable(message)) reportFailure(message);
        settle();
      }, startupTimeoutMs);

      lifecycleHandler = (e: MessageEvent<WorkerLifecycleMessage>) => {
        if (unavailableReason !== null) return; // ignore late signals after a terminal failure
        const type = (e.data as { type?: string }).type;
        if (type === "READY") {
          settle();
          return;
        }
        if (type === "LOCK_UNAVAILABLE") {
          const message = `${appName} is already open in another tab. Close that tab and refresh this one.`;
          if (markUnavailable(message)) reportFailure(message);
          settle();
          return;
        }
        if (type === "INIT_ERROR") {
          const message = `Database failed to start: ${(e.data as { message?: string }).message ?? "unknown error"}`;
          if (markUnavailable(message)) reportFailure(message);
          settle();
        }
      };

      worker?.addEventListener("message", lifecycleHandler);

      if (worker) {
        worker.onerror = () => {
          const userMessage = "Database failed to initialize. Try refreshing.";
          const drainReason = "Database worker crashed.";
          if (markUnavailable(drainReason)) reportFailure(userMessage);
          settle();
        };
      }
    });
  }

  return { sendToWorker, initialize };
}
