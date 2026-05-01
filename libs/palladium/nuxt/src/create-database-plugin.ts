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

  // ── RPC ────────────────────────────────────────────────────────────────

  function sendToWorker<T>(req: Record<string, unknown>): Promise<T> {
    if (nativeReady && native) {
      return native.dispatch(req) as Promise<T>;
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
   *   cannot be initialised (lock conflict, timeout, crash).
   */
  async function initialize(
    isNativePlatform: boolean,
    onError: (msg: string) => void,
  ): Promise<void> {
    // ── Native path ────────────────────────────────────────────────────
    if (isNativePlatform && native) {
      try {
        await native.init();
        nativeReady = true;
      } catch (err) {
        onError(`Database failed to start: ${err instanceof Error ? err.message : String(err)}`);
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
        const r = msg as WorkerResponseEnvelope;
        const p = pending.get(r.id);
        if (!p) return;
        pending.delete(r.id);
        r.ok ? p.resolve(r.data) : p.reject(new Error(r.error));
      },
    );

    // Block until the worker signals readiness (or fails).
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        onError("Database took too long to start. Try closing other tabs or refreshing.");
        resolve();
      }, startupTimeoutMs);

      worker?.addEventListener(
        "message",
        function handler(e: MessageEvent<WorkerLifecycleMessage>) {
          const type = (e.data as { type?: string }).type;
          if (type === "READY") {
            clearTimeout(t);
            worker?.removeEventListener("message", handler);
            resolve();
          } else if (type === "LOCK_UNAVAILABLE") {
            clearTimeout(t);
            worker?.removeEventListener("message", handler);
            onError(
              `${appName} is already open in another tab. Close that tab and refresh this one.`,
            );
            resolve();
          } else if (type === "INIT_ERROR") {
            clearTimeout(t);
            worker?.removeEventListener("message", handler);
            onError(
              `Database failed to start: ${(e.data as { message?: string }).message ?? "unknown error"}`,
            );
            resolve();
          }
        },
      );

      if (worker) {
        worker.onerror = () => {
          clearTimeout(t);
          onError("Database failed to initialize. Try refreshing.");
          resolve();
        };
      }
    });
  }

  return { sendToWorker, initialize };
}
