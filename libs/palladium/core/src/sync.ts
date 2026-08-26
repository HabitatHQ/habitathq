/**
 * SyncTransport — HTTP-poll-based sync between a `PalladiumEngine` and a
 * `palladium-axum` server.
 *
 * Lifecycle
 * ─────────
 * `await transport.start()` creates a `_sync_outbox` table if
 * missing, drains any pending rows left from a previous session, hydrates the
 * local store from the server (full `GET /v1/changes`), then schedules a
 * periodic poll that applies new remote changes via `engine.applyRemote()`.
 * While the transport is running, any local `engine.tx()` fires a
 * `"changes:local"` event; the transport writes the change to the outbox,
 * attempts a `POST /v1/changes`, and deletes the outbox row on success. Each
 * poll cycle also re-attempts any outbox rows that are still pending.
 *
 * `await transport.stop()` clears the poll timer and unsubscribes from the
 * engine event bus. The transport can be restarted (idempotently).
 *
 * Wire-format quirks
 * ──────────────────
 * The Rust server's `Op::Update` is single-column (`{col, value}`) while the
 * engine's update op carries a `patch: Partial<Row>` (potentially many
 * columns). One engine update with N patched columns becomes N wire ops.
 */
import type { PalladiumEngine, RemoteChange, SyncStatus } from "./engine.js";
import type { Hlc } from "./hlc.js";
import { isUuidV7, isValidHlc } from "./hlc.js";
import type { StorageAdapter } from "./storage.js";
import type { Op, SchemaMap } from "./tx.js";
import { isJsonValue } from "./tx.js";

// ── Wire types (mirror of the Rust palladium-core JSON serialisation) ──────

export interface InsertWireOp {
  readonly op: "insert";
  readonly table: string;
  readonly row_id: string;
  readonly data: Record<string, unknown>;
}

export interface UpdateWireOp {
  readonly op: "update";
  readonly table: string;
  readonly row_id: string;
  readonly col: string;
  readonly value: unknown;
}

export interface DeleteWireOp {
  readonly op: "delete";
  readonly table: string;
  readonly row_id: string;
}

export type WireOp = InsertWireOp | UpdateWireOp | DeleteWireOp;

export interface WireChange {
  readonly id: string;
  readonly scope?: string;
  readonly hlc: Hlc;
  readonly ops: ReadonlyArray<WireOp>;
}

/** A durable server event that accompanies a version-one changes page. */
export interface SyncEvent {
  readonly id: number;
  readonly kind: "grant" | "revoke";
  readonly root_id: string;
}

export interface SyncPageEnvelope {
  readonly version: 1;
  readonly changes: readonly WireChange[];
  readonly purges: readonly { table: string; row_id: string }[];
  readonly events: readonly SyncEvent[];
  readonly cursor: string | null;
  readonly upperBound: string;
  readonly caughtUp: boolean;
  readonly control: { readonly mustRefetch: boolean };
}

/**
 * Runtime guard for a decoded change — the transport skips anything else.
 *
 * Validates a complete remote change, including its HLC and every exhaustive
 * wire operation, without performing any side effect.

 */
function isWireChange(value: unknown): value is WireChange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const change = value as Record<string, unknown>;
  if (
    !isUuidV4(change["id"]) ||
    (change["scope"] !== undefined && typeof change["scope"] !== "string") ||
    !isValidHlc(change["hlc"]) ||
    !Array.isArray(change["ops"])
  ) {
    return false;
  }
  return change["ops"].every(isWireOp);
}

function isSyncEvent(value: unknown): value is SyncEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(event["id"]) &&
    (event["kind"] === "grant" || event["kind"] === "revoke") &&
    isUuidV7(event["root_id"])
  );
}

function isWireOp(value: unknown): value is WireOp {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const op = value as Record<string, unknown>;
  if (
    typeof op["table"] !== "string" ||
    typeof op["row_id"] !== "string" ||
    !isUuidV7(op["row_id"])
  ) {
    return false;
  }
  if (op["op"] === "insert") {
    return (
      typeof op["data"] === "object" &&
      op["data"] !== null &&
      isJsonValue(op["data"]) &&
      (op["data"] as Record<string, unknown>)["id"] === op["row_id"]
    );
  }
  if (op["op"] === "update") return typeof op["col"] === "string" && isJsonValue(op["value"]);
  return op["op"] === "delete";
}

// ── Cursor encoding ─────────────────────────────────────────────────────────

/**
 * Atrium's append cursor is an unsigned decimal sequence number. It is
 * deliberately independent of an HLC: HLCs resolve conflicts but cannot
 * order history entries appended by offline clients.
 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

// ── Options ────────────────────────────────────────────────────────────────

export interface SyncTransportOptions {
  readonly serverUrl: string;
  /** Polling interval for the downlink. Default: 1000 ms. */
  readonly pollIntervalMs?: number;
  /** Override fetch for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /** Optional schema identity. Defaults to the initialized engine identity. */
  readonly schemaFingerprint?: string;
  readonly authHeaders?: (ctx: {
    readonly refresh: boolean;
  }) => Record<string, string> | Promise<Record<string, string>>;
  /** Policy for a terminal remote failure after it is quarantined. */
  readonly terminalPolicy?: "block" | "degraded_skip";
  /** Abort a request that exceeds this duration. Disabled when omitted. */
  readonly requestTimeoutMs?: number;
}

/** A version-one receipt authoritatively acknowledging an uploaded change. */
export interface SyncReceipt {
  readonly version: 1;
  readonly outcome: "inserted" | "duplicate";
  readonly cursor: string;
}

/** Classified transport failure retained for status and recovery decisions. */
export interface SyncError {
  readonly phase: "uplink" | "downlink" | "lifecycle" | "protocol";
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly body?: string;
  readonly changeId?: string;
  readonly attempt?: number;
  readonly nextRetryAt?: number;
}
// ── Outbox table ───────────────────────────────────────────────────────────

const OUTBOX_TABLE = "_sync_outbox";

/**
 * Idempotent DDL for the durable outbox. Creates the table only if missing,
 * so it's safe to run on every transport start without versioning.
 */
const OUTBOX_DDL = `CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (
  change_id TEXT PRIMARY KEY,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  ops TEXT NOT NULL,
  schema_fingerprint TEXT NOT NULL DEFAULT 'legacy',
  retry_attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  terminal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`;

const OUTBOX_MIGRATIONS = [
  {
    column: "schema_fingerprint",
    sql: `ALTER TABLE ${OUTBOX_TABLE} ADD COLUMN schema_fingerprint TEXT NOT NULL DEFAULT 'legacy'`,
  },
  {
    column: "retry_attempts",
    sql: `ALTER TABLE ${OUTBOX_TABLE} ADD COLUMN retry_attempts INTEGER NOT NULL DEFAULT 0`,
  },
  {
    column: "next_retry_at",
    sql: `ALTER TABLE ${OUTBOX_TABLE} ADD COLUMN next_retry_at INTEGER`,
  },
  {
    column: "terminal",
    sql: `ALTER TABLE ${OUTBOX_TABLE} ADD COLUMN terminal INTEGER NOT NULL DEFAULT 0`,
  },
] as const;

async function ensureOutboxSchema(adapter: StorageAdapter): Promise<void> {
  const columns = await adapter.exec<{ name: string }>(`PRAGMA table_info("${OUTBOX_TABLE}")`, []);
  const existing = new Set(columns.map((column) => column.name));
  for (const migration of OUTBOX_MIGRATIONS) {
    if (existing.has(migration.column)) continue;
    try {
      await adapter.exec(migration.sql, []);
    } catch (error) {
      if (!(error instanceof Error && /duplicate column name:/iu.test(error.message))) throw error;
    }
  }
}

const OUTBOX_QUARANTINE_TABLE = "_sync_outbox_quarantine";

const OUTBOX_QUARANTINE_DDL = `CREATE TABLE IF NOT EXISTS ${OUTBOX_QUARANTINE_TABLE} (
  change_id TEXT PRIMARY KEY,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  ops TEXT NOT NULL,
  schema_fingerprint TEXT NOT NULL,
  error_code TEXT NOT NULL,
  quarantined_at INTEGER NOT NULL
)`;
/**
 * Durable dead-letter table for remote changes that fail to apply (`D2a`,
 * G2). A row records the failing change, its retry count, and whether it has
 * been permanently skipped so the poll cursor can advance past it on recovery.
 */
const QUARANTINE_TABLE = "_sync_quarantine";

const QUARANTINE_DDL = `CREATE TABLE IF NOT EXISTS ${QUARANTINE_TABLE} (
  change_id TEXT PRIMARY KEY,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'default',
  ops TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  schema_identity TEXT NOT NULL DEFAULT 'unknown',
  history_position TEXT,
  attempts INTEGER NOT NULL,
  permanent INTEGER NOT NULL DEFAULT 0,
  disposition TEXT,
  last_error TEXT,
  first_failed_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  discarded_at INTEGER
)`;
const QUARANTINE_MIGRATIONS = [
  `ALTER TABLE ${QUARANTINE_TABLE} ADD COLUMN scope TEXT NOT NULL DEFAULT 'default'`,
  `ALTER TABLE ${QUARANTINE_TABLE} ADD COLUMN payload TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE ${QUARANTINE_TABLE} ADD COLUMN schema_identity TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE ${QUARANTINE_TABLE} ADD COLUMN history_position TEXT`,
  `ALTER TABLE ${QUARANTINE_TABLE} ADD COLUMN disposition TEXT`,
  `ALTER TABLE ${QUARANTINE_TABLE} ADD COLUMN first_failed_at INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ${QUARANTINE_TABLE} ADD COLUMN discarded_at INTEGER`,
] as const;

const EVENT_TABLE = "_sync_events";
const EVENT_DDL = `CREATE TABLE IF NOT EXISTS ${EVENT_TABLE} (
  event_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  root_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  acknowledged_at INTEGER
)`;

interface QuarantineState {
  attempts: number;
  permanent: boolean;
}

/** A durable, inspectable failed sync payload. */
export interface SyncQuarantineEntry {
  readonly phase: "uplink" | "downlink";
  readonly changeId: string;
  readonly attempts: number;
  readonly permanent: boolean;
  /** Complete serialized WireChange for downlink records. */
  readonly payload: string;
  readonly schemaIdentity?: string;
  readonly code?: string;
  readonly historyPosition?: string;
  readonly disposition?: "degraded_skip" | "discarded";
  readonly firstFailedAt?: number;
  readonly discardedAt?: number;
  readonly updatedAt: number;
  readonly hlcWallMs?: number;
  readonly hlcCounter?: number;
  readonly hlcNodeId?: string;
}

/**
 * `_sync_state` key for the server-issued append cursor.
 */
const STATE_APPEND_CURSOR = "append_cursor_v1";

interface OutboxRow {
  change_id: string;
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
  /** JSON-encoded array of `WireOp`. */
  ops: string;
  schema_fingerprint: string;
  retry_attempts: number;
  next_retry_at: number | null;
  terminal: number;
  created_at: number;
}

function rowToChange(row: OutboxRow): WireChange {
  return {
    id: row.change_id,
    hlc: {
      wallMs: row.hlc_wall_ms,
      counter: row.hlc_counter,
      nodeId: row.hlc_node_id,
    },
    ops: JSON.parse(row.ops) as WireOp[],
  };
}

type PostOutcome = "ok" | "rejected" | "offline" | "blocked_auth";

const POST_OUTCOME_TO_STATUS: Record<PostOutcome, SyncStatus> = {
  ok: "caught_up",
  rejected: "degraded",
  offline: "offline",
  blocked_auth: "blocked_auth",
};

function isOpaqueCursor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096;
}

function retryAfterAt(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

const KNOWN_SERVER_ERROR_CODES: Record<string, true> = {
  unauthorized: true,
  forbidden: true,
  not_found: true,
  invalid_request: true,
  invalid_cursor: true,
  invalid_hlc: true,
  unsupported_version: true,
  idempotency_conflict: true,
  clock_skew: true,
  expired_checkpoint: true,
  checkpoint_expired: true,
  conflict: true,
  internal: true,
  rate_limited: true,
  schema_incompatible: true,
  invalid_envelope: true,
  invalid_operation: true,
  invalid_row_id: true,
  invalid_json_value: true,
};

function serverErrorCode(body: string): string {
  try {
    const value: unknown = JSON.parse(body);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as Record<string, unknown>)["code"] !== "string"
    ) {
      return "http_rejected";
    }
    const code = (value as Record<string, unknown>)["code"];
    return typeof code === "string" && KNOWN_SERVER_ERROR_CODES[code] === true
      ? code
      : "unknown_server_error";
  } catch {
    return "http_rejected";
  }
}
function isRetryableServerError(code: string, status: number): boolean {
  return (code === "internal" && status >= 500) || code === "rate_limited" || status === 429;
}

class SyncRequestAbortedError extends Error {
  readonly code: "request_timeout" | "request_cancelled";

  constructor(code: "request_timeout" | "request_cancelled") {
    super(code);
    this.code = code;
  }
}

class SyncAuthHeadersError extends Error {
  readonly refresh: boolean;

  constructor(refresh: boolean, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.refresh = refresh;
  }
}

function decodeReceipt(value: unknown): SyncReceipt | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (
    receipt["version"] !== 1 ||
    (receipt["outcome"] !== "inserted" && receipt["outcome"] !== "duplicate") ||
    !isOpaqueCursor(receipt["cursor"])
  ) {
    return null;
  }
  return { version: 1, outcome: receipt["outcome"], cursor: receipt["cursor"] };
}

/** Convert one engine `Op` into one or more wire `Op`s. */
function engineOpToWire<S extends SchemaMap>(op: Op<S>): WireOp[] {
  if (op.type === "insert") {
    return [
      {
        op: "insert",
        table: String(op.table),
        row_id: op.data.id,
        data: { ...op.data, id: op.data.id },
      },
    ];
  }
  if (op.type === "update") {
    // Engine patch is multi-column; wire is single-column per Op.
    const entries = Object.entries(op.patch);
    return entries.map<UpdateWireOp>(([col, value]) => ({
      op: "update",
      table: String(op.table),
      row_id: op.id,
      col,
      value,
    }));
  }
  return [{ op: "delete", table: String(op.table), row_id: op.id }];
}

/** Convert one wire `Op` into the engine `Op` shape that `applyRemote` accepts. */
function wireOpToEngine<S extends SchemaMap>(op: WireOp): Op<S> {
  // Runtime schema validation owns this boundary; TypeScript cannot derive a
  // concrete schema key or row shape from the server's validated string fields.
  const table = op.table as keyof S & string;
  if (op.op === "insert") {
    return {
      type: "insert",
      table,
      id: op.row_id,
      data: { ...op.data, id: op.row_id } as S[typeof table],
    };
  }
  if (op.op === "update") {
    return {
      type: "update",
      table,
      id: op.row_id,
      patch: { [op.col]: op.value } as Partial<Omit<S[typeof table], "id">>,
    };
  }
  return { type: "delete", table, id: op.row_id };
}

function wireOpsToEngine<S extends SchemaMap>(ops: ReadonlyArray<WireOp>): Op<S>[] {
  const result: Op<S>[] = [];
  const indexes = new Map<string, number>();
  for (const wireOp of ops) {
    const op = wireOpToEngine<S>(wireOp);
    const key = `${op.table}\u0000${op.id}`;
    const priorIndex = indexes.get(key);
    const prior = priorIndex === undefined ? undefined : result[priorIndex];
    if (priorIndex !== undefined && prior?.type === "update" && op.type === "update") {
      result[priorIndex] = { ...prior, patch: { ...prior.patch, ...op.patch } };
    } else if (priorIndex !== undefined && prior?.type === "insert" && op.type === "update") {
      result[priorIndex] = { ...prior, data: { ...prior.data, ...op.patch } };
    } else if (prior?.type === "delete") {
      // A delete supersedes later updates in the canonical form.
    } else {
      indexes.set(key, result.length);
      result.push(op);
    }
  }
  return result;
}

function wireChangeToRemote<S extends SchemaMap>(change: WireChange): RemoteChange<S> {
  return {
    id: change.id,
    hlc: change.hlc,
    ops: wireOpsToEngine<S>(change.ops),
    ...(change.scope === undefined ? {} : { scope: change.scope }),
  };
}

/**
 * A wire change must already be in the only form the engine conversion can
 * represent without silently coalescing or discarding intent: either one
 * insert/delete for a row, or distinct-column updates for that row.
 */
function hasCanonicalWireOps(ops: ReadonlyArray<WireOp>): boolean {
  const states = new Map<
    string,
    { kind: "insert" | "delete" | "updates"; columns?: Set<string> }
  >();
  for (const op of ops) {
    const key = `${op.table}\u0000${op.row_id}`;
    const previous = states.get(key);
    if (op.op === "update") {
      if (previous === undefined) {
        states.set(key, { kind: "updates", columns: new Set([op.col]) });
        continue;
      }
      if (
        previous.kind !== "updates" ||
        previous.columns === undefined ||
        previous.columns.has(op.col)
      ) {
        return false;
      }
      previous.columns.add(op.col);
      continue;
    }
    if (previous !== undefined) return false;
    states.set(key, { kind: op.op });
  }
  return true;
}

export class SyncTransport<S extends SchemaMap> {
  readonly #engine: PalladiumEngine<S>;
  readonly #serverUrl: string;
  readonly #pollIntervalMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #requestTimeoutMs: number | undefined;
  readonly #authHeaders?: SyncTransportOptions["authHeaders"];
  readonly #schemaFingerprint: string;
  readonly #terminalPolicy: NonNullable<SyncTransportOptions["terminalPolicy"]>;
  #cursor: string | null = null;
  #pollHandle: ReturnType<typeof setInterval> | null = null;
  #initialHydrationDone = false;
  #polling = false;
  #unsubscribeLocal: (() => void) | null = null;
  #unregisterLocalCheckpoint: (() => void) | null = null;
  #initialized = false;
  #initPromise: Promise<void> | null = null;
  #startPromise: Promise<void> | null = null;
  #stopPromise: Promise<void> | null = null;
  #disposed = false;
  #stopping = false;
  #lastError: SyncError | null = null;
  #attempts = new Map<string, number>();
  #quarantineCache = new Map<string, QuarantineState>();
  #lifecycle: Promise<void> = Promise.resolve();
  #activeAbortController: AbortController | null = null;
  #activeRequestTimedOut = false;
  #activeRequestTimer: ReturnType<typeof setTimeout> | undefined;
  get lastError(): SyncError | null {
    return this.#lastError;
  }
  #recordError(error: SyncError): void {
    this.#lastError = error;
  }
  #serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#lifecycle.then(operation, operation);
    this.#lifecycle = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  #ensureInitialized(): Promise<void> {
    if (this.#initialized) return Promise.resolve();
    if (this.#initPromise === null) this.#initPromise = this.#runInit();
    return this.#initPromise;
  }
  async #runInit(): Promise<void> {
    try {
      await this.#engine.adapter.exec(OUTBOX_DDL, []);
      await ensureOutboxSchema(this.#engine.adapter);
      await this.#engine.adapter.exec(OUTBOX_QUARANTINE_DDL, []);
      await this.#engine.adapter.exec(QUARANTINE_DDL, []);
      for (const migration of QUARANTINE_MIGRATIONS) {
        try {
          await this.#engine.adapter.exec(migration, []);
        } catch (err) {
          if (!(err instanceof Error && /duplicate column name:/iu.test(err.message))) throw err;
        }
      }
      await this.#engine.setSyncState("schema_identity_v1", this.#schemaFingerprint);
      const savedAppendCursor = await this.#engine.getSyncState(STATE_APPEND_CURSOR);
      await this.#engine.adapter.exec(EVENT_DDL, []);
      if (isOpaqueCursor(savedAppendCursor)) {
        this.#cursor = savedAppendCursor;
        this.#initialHydrationDone = true;
      }
      this.#initialized = true;
    } catch (err) {
      this.#initPromise = null;
      throw err;
    }
  }

  constructor(engine: PalladiumEngine<S>, options: SyncTransportOptions) {
    const schemaFingerprint = options.schemaFingerprint ?? engine.initializedSchemaIdentity;
    if (schemaFingerprint === null) {
      throw new Error(
        "SyncTransport requires schemaFingerprint or an engine initialized with SchemaConfig",
      );
    }
    this.#engine = engine;
    engine.acquireSyncTransport(this);
    this.#serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#schemaFingerprint = schemaFingerprint;
    this.#authHeaders = options.authHeaders;
    this.#terminalPolicy = options.terminalPolicy ?? "block";
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#unregisterLocalCheckpoint = engine.registerLocalChangeCheckpoint(
      async (local, adapter) => {
        const wireOps = local.ops.flatMap((op) => engineOpToWire(op));
        if (wireOps.length === 0) return;
        await adapter.exec(OUTBOX_DDL, []);
        await ensureOutboxSchema(adapter);
        await adapter.exec(
          `INSERT INTO ${OUTBOX_TABLE}
         (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint,
          retry_attempts, next_retry_at, terminal, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0, ?)`,
          [
            local.changeId,
            local.hlc.wallMs,
            local.hlc.counter,
            local.hlc.nodeId,
            JSON.stringify(wireOps),
            this.#schemaFingerprint,
            Date.now(),
          ],
        );
      },
    );
  }
  /**
   * Fetch with the auth-decoration hook applied.
   */
  #fetchWithAuth(input: string, init?: RequestInit): Promise<Response> {
    if (this.#authHeaders === undefined) return this.#fetch(input, init);
    return this.#fetchDecorated(this.#authHeaders, input, init);
  }
  async #fetchDecorated(
    authHeaders: NonNullable<SyncTransportOptions["authHeaders"]>,
    input: string,
    init?: RequestInit,
  ): Promise<Response> {
    const send = async (refresh: boolean): Promise<Response> => {
      let extra: Record<string, string>;
      try {
        extra = await authHeaders({ refresh });
      } catch (error) {
        throw new SyncAuthHeadersError(refresh, error);
      }
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(extra)) headers.set(k, v);
      return this.#fetch(input, { ...init, headers });
    };
    const res = await send(false);
    return res.status === 401 ? send(true) : res;
  }

  async #fetchCancellable(input: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    this.#activeAbortController?.abort();
    clearTimeout(this.#activeRequestTimer);
    this.#activeAbortController = controller;
    this.#activeRequestTimedOut = false;
    this.#activeRequestTimer =
      this.#requestTimeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            this.#activeRequestTimedOut = true;
            controller.abort();
          }, this.#requestTimeoutMs);
    try {
      return await this.#fetchWithAuth(input, { ...init, signal: controller.signal });
    } catch (error) {
      this.#releaseRequest(controller);
      if (error instanceof SyncAuthHeadersError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new SyncRequestAbortedError(timedOut ? "request_timeout" : "request_cancelled");
      }
      if (controller.signal.aborted) {
        throw new SyncRequestAbortedError(timedOut ? "request_timeout" : "request_cancelled");
      }
      throw error;
    }
  }

  #releaseRequest(controller: AbortController | null): void {
    if (this.#activeAbortController !== controller) return;
    clearTimeout(this.#activeRequestTimer);
    this.#activeRequestTimer = undefined;
    this.#activeAbortController = null;
    this.#activeRequestTimedOut = false;
  }

  async #readBody<T>(read: () => Promise<T>): Promise<T> {
    const controller = this.#activeAbortController;
    if (controller === null) return read();
    let rejectAborted: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = () => {
        reject(
          new SyncRequestAbortedError(
            this.#activeRequestTimedOut ? "request_timeout" : "request_cancelled",
          ),
        );
      };
      controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });
    try {
      return await Promise.race([read(), aborted]);
    } finally {
      if (rejectAborted !== undefined) {
        controller.signal.removeEventListener("abort", rejectAborted);
      }
      this.#releaseRequest(controller);
    }
  }

  /** Re-attempt pending rows, terminally quarantining schema mismatches. */
  async #drainOutbox(): Promise<void> {
    const rows = await this.#engine.adapter.exec<OutboxRow>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint,
              retry_attempts, next_retry_at, terminal, created_at
         FROM ${OUTBOX_TABLE}
         ORDER BY hlc_wall_ms ASC, hlc_counter ASC, change_id ASC`,
      [],
    );
    if (rows.length === 0) return;
    this.#engine.setStatus("syncing");
    let lastOutcome: PostOutcome = "ok";
    for (const row of rows) {
      if (this.#isOutboxRowBlocked(row)) {
        lastOutcome = "rejected";
        break;
      }
      if (row.schema_fingerprint !== this.#schemaFingerprint) {
        await this.#recordSchemaMismatch(row);
        lastOutcome = "rejected";
        continue;
      }
      const outcome = await this.#tryPost(rowToChange(row));
      lastOutcome = outcome;
      if (outcome === "ok") {
        await this.#engine.adapter.exec(`DELETE FROM ${OUTBOX_TABLE} WHERE change_id = ?`, [
          row.change_id,
        ]);
      } else {
        await this.#recordOutboxFailure(row, outcome);
        break;
      }
    }
    this.#engine.setStatus(POST_OUTCOME_TO_STATUS[lastOutcome]);
  }

  #isOutboxRowBlocked(row: OutboxRow): boolean {
    return row.terminal !== 0 || (row.next_retry_at !== null && row.next_retry_at > Date.now());
  }

  async #recordSchemaMismatch(row: OutboxRow): Promise<void> {
    await this.#quarantineOutbox(row);
    this.#recordError({
      phase: "uplink",
      code: "schema_identity_mismatch",
      retryable: false,
      changeId: row.change_id,
    });
  }

  async #recordOutboxFailure(row: OutboxRow, outcome: PostOutcome): Promise<void> {
    const error = this.#lastError;
    const terminal = outcome === "rejected" && error?.code === "invalid_receipt" ? 1 : 0;
    const nextRetryAt = terminal
      ? null
      : (error?.nextRetryAt ?? (error?.retryable ? this.#backoffAt(row.retry_attempts + 1) : null));
    await this.#engine.adapter.exec(
      `UPDATE ${OUTBOX_TABLE}
         SET retry_attempts = retry_attempts + 1, next_retry_at = ?, terminal = ?
       WHERE change_id = ?`,
      [nextRetryAt, terminal, row.change_id],
    );
  }

  async #quarantineOutbox(row: OutboxRow): Promise<void> {
    await this.#engine.adapter.exec(
      `INSERT INTO ${OUTBOX_QUARANTINE_TABLE}
       (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint, error_code, quarantined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (change_id) DO UPDATE SET
         schema_fingerprint = excluded.schema_fingerprint,
         error_code = excluded.error_code,
         quarantined_at = excluded.quarantined_at`,
      [
        row.change_id,
        row.hlc_wall_ms,
        row.hlc_counter,
        row.hlc_node_id,
        row.ops,
        row.schema_fingerprint,
        "schema_incompatible",
        Date.now(),
      ],
    );
    await this.#engine.adapter.exec(`DELETE FROM ${OUTBOX_TABLE} WHERE change_id = ?`, [
      row.change_id,
    ]);
  }

  async start(): Promise<void> {
    if (this.#disposed) throw new Error("SyncTransport is disposed");
    if (this.#startPromise !== null) return this.#startPromise;
    this.#stopping = false;
    this.#startPromise = this.#serializeLifecycle(async () => {
      if (this.#disposed || this.#pollHandle !== null || this.#stopping) return;
      await this.#ensureInitialized();
      if (this.#disposed || this.#stopping) return;
      await this.#drainOutbox();
      if (this.#disposed || this.#stopping) return;
      this.#unsubscribeLocal = this.#engine.on("changes:local", () => this.#backgroundTick());
      await this.#poll();
      if (!this.#disposed && !this.#stopping) {
        this.#pollHandle = setInterval(() => this.#backgroundTick(), this.#pollIntervalMs);
      }
    }).finally(() => {
      this.#startPromise = null;
    });
    return this.#startPromise;
  }

  #backgroundTick(): void {
    void this.#serializeLifecycle(() => this.#tick()).catch((error: unknown) => {
      this.#recordError({
        phase: "lifecycle",
        code: "background_failure",
        retryable: true,
        body: error instanceof Error ? error.message : String(error),
      });
      this.#engine.setStatus("degraded");
    });
  }

  async #tick(): Promise<void> {
    if (this.#disposed || this.#stopping) return;
    await this.#drainOutbox();
    if (this.#disposed || this.#stopping) return;
    await this.#poll();
  }

  /** Stop polling and unsubscribe from engine events. Idempotent. */
  async stop(): Promise<void> {
    this.#stopping = true;
    this.#activeAbortController?.abort();
    if (this.#stopPromise !== null) return this.#stopPromise;
    this.#stopPromise = this.#serializeLifecycle(async () => {
      if (this.#pollHandle !== null) {
        clearInterval(this.#pollHandle);
        this.#pollHandle = null;
      }
      if (this.#unsubscribeLocal !== null) {
        this.#unsubscribeLocal();
        this.#unsubscribeLocal = null;
      }
    }).finally(() => {
      this.#stopPromise = null;
    });
    return this.#stopPromise;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopping = true;
    await this.stop();
    this.#unregisterLocalCheckpoint?.();
    this.#unregisterLocalCheckpoint = null;
    this.#engine.releaseSyncTransport(this);
  }

  async inspectQuarantine(): Promise<readonly SyncQuarantineEntry[]> {
    await this.#ensureInitialized();
    const rows = await this.#engine.adapter.exec<
      Omit<SyncQuarantineEntry, "permanent"> & { permanent: number }
    >(
      `SELECT 'downlink' AS phase, change_id AS changeId, attempts, permanent, ops AS payload,
              hlc_wall_ms AS hlcWallMs, hlc_counter AS hlcCounter, hlc_node_id AS hlcNodeId,
              NULL AS schemaIdentity, last_error AS code, updated_at AS updatedAt
         FROM ${QUARANTINE_TABLE}
       UNION ALL
       SELECT 'uplink' AS phase, change_id AS changeId, 0 AS attempts, 1 AS permanent,
              ops AS payload, hlc_wall_ms AS hlcWallMs, hlc_counter AS hlcCounter,
              hlc_node_id AS hlcNodeId, schema_fingerprint AS schemaIdentity, error_code AS code,
              quarantined_at AS updatedAt
         FROM ${OUTBOX_QUARANTINE_TABLE}
       ORDER BY updatedAt ASC`,
      [],
    );
    return rows.map((row) => ({ ...row, permanent: row.permanent !== 0 }));
  }

  async exportQuarantine(): Promise<string> {
    return JSON.stringify(await this.inspectQuarantine());
  }

  async retryQuarantined(changeId: string): Promise<void> {
    await this.#ensureInitialized();
    const uplink = await this.#engine.adapter.exec<OutboxRow>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint,
              0 AS retry_attempts, NULL AS next_retry_at, 0 AS terminal,
              quarantined_at AS created_at
         FROM ${OUTBOX_QUARANTINE_TABLE} WHERE change_id = ?`,
      [changeId],
    );
    const row = uplink[0];
    if (row !== undefined) {
      await this.#engine.adapter.exec(
        `INSERT INTO ${OUTBOX_TABLE}
         (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint,
          retry_attempts, next_retry_at, terminal, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0, ?)
         ON CONFLICT(change_id) DO NOTHING`,
        [
          row.change_id,
          row.hlc_wall_ms,
          row.hlc_counter,
          row.hlc_node_id,
          row.ops,
          row.schema_fingerprint,
          Date.now(),
        ],
      );
      await this.#engine.adapter.exec(
        `DELETE FROM ${OUTBOX_QUARANTINE_TABLE} WHERE change_id = ?`,
        [changeId],
      );
      return;
    }
    const downlink = await this.#engine.adapter.exec<{
      change_id: string;
      hlc_wall_ms: number;
      hlc_counter: number;
      hlc_node_id: string;
      ops: string;
    }>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops
         FROM ${QUARANTINE_TABLE} WHERE change_id = ?`,
      [changeId],
    );
    const failed = downlink[0];
    if (failed === undefined) return;
    await this.#engine.adapter.exec(
      `UPDATE ${QUARANTINE_TABLE} SET permanent = 0, attempts = 0, updated_at = ? WHERE change_id = ?`,
      [Date.now(), changeId],
    );
    this.#quarantineCache.set(changeId, { attempts: 0, permanent: false });
    const ops: unknown = JSON.parse(failed.ops);
    if (!Array.isArray(ops) || !ops.every(isWireOp))
      throw new TypeError("Quarantined downlink payload is invalid");
    await this.#applyOneRemote({
      id: failed.change_id,
      hlc: { wallMs: failed.hlc_wall_ms, counter: failed.hlc_counter, nodeId: failed.hlc_node_id },
      ops,
    });
  }
  async discardQuarantined(changeId: string): Promise<void> {
    await this.#ensureInitialized();
    const rows = await this.#engine.adapter.exec<{ change_id: string }>(
      `SELECT change_id FROM ${QUARANTINE_TABLE} WHERE change_id = ?`,
      [changeId],
    );
    if (rows[0] === undefined) return;
    await this.#engine.adapter.exec(
      `UPDATE ${QUARANTINE_TABLE} SET permanent = 1, updated_at = ? WHERE change_id = ?`,
      [Date.now(), changeId],
    );
    this.#quarantineCache.set(changeId, { attempts: 0, permanent: true });
  }

  async #tryPost(change: WireChange): Promise<PostOutcome> {
    try {
      const res = await this.#fetchCancellable(`${this.#serverUrl}/v1/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!res.ok) return this.#recordPostFailure(change, res);
      return await this.#recordPostReceipt(change, res);
    } catch (error) {
      return this.#recordPostException(change, error);
    }
  }

  async #recordPostFailure(change: WireChange, res: Response): Promise<PostOutcome> {
    const body = await this.#readBody(() => res.text());
    const code = serverErrorCode(body);
    const nextRetryAt = retryAfterAt(res.headers.get("Retry-After"));
    const attempt = this.#nextAttempt(change.id);
    this.#recordError({
      phase: "uplink",
      code: res.status === 401 ? "unauthorized" : code,
      retryable: isRetryableServerError(code, res.status),
      status: res.status,
      body,
      changeId: change.id,
      attempt,
      ...(nextRetryAt === null ? {} : { nextRetryAt }),
    });
    return res.status === 401 ? "blocked_auth" : "rejected";
  }

  async #recordPostReceipt(change: WireChange, res: Response): Promise<PostOutcome> {
    try {
      if (decodeReceipt(await this.#readBody(() => res.json())) === null)
        return this.#recordInvalidReceipt(change, res);
    } catch (error) {
      if (error instanceof SyncRequestAbortedError) throw error;
      return this.#recordInvalidReceipt(change, res);
    }
    this.#attempts.delete(change.id);
    this.#lastError = null;
    return "ok";
  }

  #recordInvalidReceipt(change: WireChange, res: Response): PostOutcome {
    const attempt = this.#attempts.get(change.id);
    this.#recordError({
      phase: "protocol",
      code: "invalid_receipt",
      retryable: false,
      status: res.status,
      changeId: change.id,
      ...(attempt === undefined ? {} : { attempt }),
    });
    return "rejected";
  }

  #recordPostException(change: WireChange, error: unknown): PostOutcome {
    const attempt = this.#nextAttempt(change.id);
    if (error instanceof SyncRequestAbortedError) {
      this.#recordError({
        phase: "uplink",
        code: error.code,
        retryable: error.code === "request_timeout",
        changeId: change.id,
        attempt,
        body: error.message,
        ...(error.code === "request_timeout" ? { nextRetryAt: this.#backoffAt(attempt) } : {}),
      });
      return error.code === "request_timeout" ? "offline" : "rejected";
    }
    if (error instanceof SyncAuthHeadersError) {
      this.#recordError({
        phase: "uplink",
        code: error.refresh ? "auth_refresh_failed" : "auth_headers_failed",
        retryable: false,
        changeId: change.id,
        attempt,
        body: error.message,
      });
      return "blocked_auth";
    }
    this.#recordError({
      phase: "uplink",
      code: "offline",
      retryable: true,
      changeId: change.id,
      attempt,
      body: error instanceof Error ? error.message : String(error),
      nextRetryAt: this.#backoffAt(attempt),
    });
    return "offline";
  }

  #nextAttempt(changeId: string): number {
    const attempt = (this.#attempts.get(changeId) ?? 0) + 1;
    this.#attempts.set(changeId, attempt);
    return attempt;
  }

  #backoffAt(attempt: number): number {
    return Date.now() + Math.min(60_000, 1_000 * 2 ** (attempt - 1));
  }

  /**
   * Perform one downlink poll: fetch changes newer than the cursor and apply
   * them. Public so callers (and tests) can drive a deterministic single sync
   * step; the periodic timer calls the same path.
   */
  async poll(): Promise<void> {
    return this.#serializeLifecycle(async () => {
      if (this.#disposed || this.#stopping) return;
      await this.#ensureInitialized();
      await this.#poll();
    });
  }

  async syncOnce(): Promise<void> {
    return this.#serializeLifecycle(async () => {
      if (this.#disposed || this.#stopping) return;
      await this.#ensureInitialized();
      await this.#drainOutbox();
      if (!this.#disposed && !this.#stopping) await this.#poll();
    });
  }

  async #persistEvents(
    events: readonly SyncEvent[],
    adapter: StorageAdapter = this.#engine.adapter,
  ): Promise<void> {
    for (const event of events) {
      await adapter.exec(
        `INSERT INTO ${EVENT_TABLE} (event_id, kind, root_id, payload, processed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO NOTHING`,
        [event.id, event.kind, event.root_id, JSON.stringify(event), Date.now()],
      );
    }
  }

  /** Fetch and validate one versioned page envelope before applying any of it. */
  async #fetchPollPage(): Promise<{
    readonly changes: WireChange[];
    readonly purges: ReadonlyArray<{ readonly table: string; readonly row_id: string }>;
    readonly events: readonly SyncEvent[];
    readonly cursor: string | null;
    readonly upperBound: string;
    readonly caughtUp: boolean;
    readonly control: { readonly mustRefetch: boolean };
  } | null> {
    const params = new URLSearchParams({ limit: "100" });
    if (this.#cursor !== null) params.set("cursor", this.#cursor);
    try {
      const res = await this.#fetchCancellable(`${this.#serverUrl}/v1/changes?${params}`);
      if (!res.ok) {
        const body = await this.#readBody(() => res.text());
        this.#recordError({
          phase: "downlink",
          code: serverErrorCode(body),
          retryable: isRetryableServerError(serverErrorCode(body), res.status),
          status: res.status,
          body,
        });
        return null;
      }
      const bodyValue: unknown = await this.#readBody(() => res.json());
      if (typeof bodyValue !== "object" || bodyValue === null || Array.isArray(bodyValue)) {
        this.#recordError({ phase: "protocol", code: "invalid_envelope", retryable: false });
        return null;
      }
      const body = bodyValue as Record<string, unknown>;
      const control = body["control"];
      if (
        body["version"] !== 1 ||
        !Array.isArray(body["changes"]) ||
        !Array.isArray(body["purges"]) ||
        !body["purges"].every(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as Record<string, unknown>)["table"] === "string" &&
            isUuidV7((p as Record<string, unknown>)["row_id"]),
        ) ||
        !Array.isArray(body["events"]) ||
        !body["events"].every(isSyncEvent) ||
        !("cursor" in body) ||
        (body["cursor"] !== null && !isOpaqueCursor(body["cursor"])) ||
        !isOpaqueCursor(body["upperBound"]) ||
        typeof body["caughtUp"] !== "boolean" ||
        typeof control !== "object" ||
        control === null ||
        typeof (control as Record<string, unknown>)["mustRefetch"] !== "boolean"
      ) {
        this.#recordError({ phase: "protocol", code: "invalid_envelope", retryable: false });
        return null;
      }
      const changes = body["changes"];
      if (!changes.every(isWireChange)) {
        this.#recordError({ phase: "protocol", code: "invalid_operation", retryable: false });
        return null;
      }
      return {
        changes,
        purges: body["purges"] as ReadonlyArray<{
          readonly table: string;
          readonly row_id: string;
        }>,
        events: body["events"] as readonly SyncEvent[],
        cursor: body["cursor"] as string | null,
        upperBound: body["upperBound"] as string,
        caughtUp: body["caughtUp"] as boolean,
        control: control as { readonly mustRefetch: boolean },
      };
    } catch (error) {
      const code = error instanceof SyncRequestAbortedError ? error.code : "offline";
      this.#recordError({
        phase: "downlink",
        code,
        retryable: code === "request_timeout" || code === "offline",
        body: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async #acknowledgeEvents(events: readonly SyncEvent[]): Promise<boolean> {
    if (events.length === 0) return true;
    try {
      const res = await this.#fetchCancellable(`${this.#serverUrl}/v1/changes/events/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_ids: events.map((event) => event.id) }),
      });
      if (!res.ok) {
        this.#recordError({
          phase: "downlink",
          code: "event_ack_rejected",
          retryable: res.status >= 500 || res.status === 429,
          status: res.status,
          body: await this.#readBody(() => res.text()),
        });
        return false;
      }
      await this.#readBody(async () => undefined);
      const now = Date.now();
      for (const event of events) {
        await this.#engine.adapter.exec(
          `UPDATE ${EVENT_TABLE} SET acknowledged_at = ? WHERE event_id = ?`,
          [now, event.id],
        );
      }
      return true;
    } catch (error) {
      this.#recordError({
        phase: "downlink",
        code: "event_ack_offline",
        retryable: true,
        body: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** Fetch newer changes from server and apply them locally (non-poisoning). */
  async #poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      const page = await this.#fetchPollPage();
      if (page === null) return;
      if (page.control.mustRefetch) {
        this.#engine.setStatus("degraded");
        return;
      }
      const pendingChanges: Array<WireChange> = [];
      for (const change of page.changes) {
        const state = await this.#quarantineState(change.id);
        if (state?.permanent) continue;
        pendingChanges.push(change);
      }
      const nonCanonical = page.changes.find((change) => !hasCanonicalWireOps(change.ops));
      if (nonCanonical !== undefined) {
        this.#recordError({
          phase: "protocol",
          code: "invalid_operation",
          retryable: false,
          changeId: nonCanonical.id,
        });
        return;
      }
      const remoteChanges = pendingChanges.map((change) => wireChangeToRemote<S>(change));
      const applied = await this.#engine.applyRemotePage(
        remoteChanges,
        page.purges.map((purge) => ({
          table: purge.table as keyof S & string,
          id: purge.row_id,
        })),
        async (adpt) => {
          await this.#persistEvents(page.events, adpt);
          if (page.cursor !== null)
            await this.#engine.setSyncState(STATE_APPEND_CURSOR, page.cursor, adpt);
        },
        async (change, error, adpt) => {
          const wire = page.changes.find((candidate) => candidate.id === change.id);
          if (wire === undefined) return;
          await this.#recordFailure(wire, error, adpt);
          if (this.#terminalPolicy === "degraded_skip") {
            await adpt.exec(
              `UPDATE ${QUARANTINE_TABLE} SET permanent = 1, updated_at = ? WHERE change_id = ?`,
              [Date.now(), change.id],
            );
            this.#quarantineCache.set(wire.id, { attempts: 0, permanent: true });
            this.#recordError({
              phase: "downlink",
              code: "quarantine_degraded_skip",
              retryable: false,
              changeId: wire.id,
              body: error instanceof Error ? error.message : String(error),
            });
          } else {
            this.#recordError({
              phase: "downlink",
              code: "quarantine_blocked",
              retryable: false,
              changeId: wire.id,
              body: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
      if (applied) {
        this.#initialHydrationDone = true;
        if (page.cursor !== null) this.#cursor = page.cursor;
      }
      if (!applied) {
        this.#engine.setStatus("degraded");
        return;
      }
      if (!(await this.#acknowledgeEvents(page.events))) {
        this.#engine.setStatus("degraded");
        return;
      }
      if (!this.#hasUnresolvedFailure()) {
        this.#lastError = null;
        this.#engine.setStatus(page.caughtUp ? "caught_up" : "syncing");
      }
    } finally {
      this.#polling = false;
    }
  }

  #hasUnresolvedFailure(): boolean {
    return (
      this.#lastError?.phase === "uplink" ||
      this.#lastError?.code === "invalid_receipt" ||
      this.#lastError?.code.startsWith("quarantine_") === true
    );
  }

  /** Read persisted quarantine state for a change. */
  async #quarantineState(changeId: string): Promise<QuarantineState | null> {
    const cached = this.#quarantineCache.get(changeId);
    if (cached !== undefined) return cached;
    const rows = await this.#engine.adapter.exec<{ attempts: number; permanent: number }>(
      `SELECT attempts, permanent FROM ${QUARANTINE_TABLE} WHERE change_id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    const state = { attempts: row.attempts, permanent: row.permanent !== 0 };
    this.#quarantineCache.set(changeId, state);
    return state;
  }
  async #applyOneRemote(change: WireChange): Promise<boolean> {
    if (this.#initialHydrationDone && change.hlc.nodeId === this.#engine.nodeId) return true;
    const quarantine = await this.#quarantineState(change.id);
    if (!hasCanonicalWireOps(change.ops)) {
      await this.#recordFailure(change, new Error("invalid_operation"));
      this.#engine.setStatus("degraded");
      return false;
    }
    const remoteChange = wireChangeToRemote<S>(change);
    try {
      if (change.ops.some((op) => !this.#engine.hasTable(op.table))) {
        throw new Error("remote change references an unknown table");
      }
      await this.#engine.applyRemote(remoteChange);
      if (quarantine !== null) await this.#clearQuarantine(change.id);
      return true;
    } catch (err) {
      await this.#recordFailure(change, err);
      if (this.#terminalPolicy === "degraded_skip") {
        await this.#markPermanent(change.id);
        this.#engine.setStatus("degraded");
        return true;
      }
      this.#engine.setStatus("degraded");
      return false;
    }
  }

  async #recordFailure(
    change: WireChange,
    err: unknown,
    adapter: StorageAdapter = this.#engine.adapter,
  ): Promise<number> {
    const message = err instanceof Error ? err.message : String(err);
    await adapter.exec(
      `INSERT INTO ${QUARANTINE_TABLE}
         (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, attempts, permanent, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
       ON CONFLICT (change_id) DO UPDATE SET
         attempts = attempts + 1,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [
        change.id,
        change.hlc.wallMs,
        change.hlc.counter,
        change.hlc.nodeId,
        JSON.stringify(change.ops),
        message,
        Date.now(),
      ],
    );
    const state = await adapter.exec<{ attempts: number }>(
      `SELECT attempts FROM ${QUARANTINE_TABLE} WHERE change_id = ?`,
      [change.id],
    );
    const attempts = state[0]?.attempts ?? 1;
    this.#quarantineCache.set(change.id, { attempts, permanent: false });
    return attempts;
  }

  async #markPermanent(changeId: string): Promise<void> {
    await this.#engine.adapter.exec(
      `UPDATE ${QUARANTINE_TABLE} SET permanent = 1, updated_at = ? WHERE change_id = ?`,
      [Date.now(), changeId],
    );
    const cached = this.#quarantineCache.get(changeId);
    this.#quarantineCache.set(changeId, {
      attempts: cached?.attempts ?? 0,
      permanent: true,
    });
  }

  async #clearQuarantine(changeId: string): Promise<void> {
    await this.#engine.adapter.exec(`DELETE FROM ${QUARANTINE_TABLE} WHERE change_id = ?`, [
      changeId,
    ]);
    this.#quarantineCache.delete(changeId);
  }
}
