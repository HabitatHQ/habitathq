/**
 * Configuration for the database plugin factory.
 *
 * Each Nuxt app provides its own worker constructor, native bridge, and
 * branding — the factory handles the shared lifecycle logic.
 */
export interface DatabasePluginConfig {
  /** App display name (used in user-facing error messages). */
  readonly appName: string;

  /** Creates the Web Worker running the SQLite WASM engine. */
  readonly createWorker: () => Worker;

  /**
   * Capacitor native bridge. When provided and running on a native platform,
   * `sendToWorker` routes through `dispatch` instead of the Web Worker.
   */
  readonly native?: {
    readonly init: () => Promise<void>;
    readonly dispatch: (req: unknown) => Promise<unknown>;
  };

  /** Milliseconds to wait for the worker READY signal (default: 10 000). */
  readonly startupTimeoutMs?: number;
}

/**
 * Standard worker lifecycle message.
 * Workers MUST post one of these before responding to requests.
 */
export type WorkerLifecycleMessage =
  | { readonly type: "READY" }
  | { readonly type: "LOCK_UNAVAILABLE" }
  | { readonly type: "INIT_ERROR"; readonly message: string };

/**
 * Standard worker response envelope.
 * Every request/response pair is correlated by a UUID `id`.
 */
export interface WorkerResponseEnvelope {
  readonly id: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}
