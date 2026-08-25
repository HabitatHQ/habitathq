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

import type { PalladiumEngine, SyncStatus } from "./engine.js";
import type { Hlc } from "./hlc.js";
import { isUuidV7, isValidHlc } from "./hlc.js";
import type { SchemaMap } from "./tx.js";
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

export interface SyncPageEnvelope {
  readonly version: 1;
  readonly changes: readonly WireChange[];
  readonly purges: readonly { table: string; row_id: string }[];
  readonly events: readonly Record<string, unknown>[];
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

function isAppendCursor(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value);
}

// ── Options ────────────────────────────────────────────────────────────────

export interface SyncTransportOptions {
  readonly serverUrl: string;
  /** Polling interval for the downlink. Default: 1000 ms. */
  readonly pollIntervalMs?: number;
  /** Override `fetch` for tests. */
  readonly fetch?: typeof globalThis.fetch;
  readonly schemaFingerprint?: string;
  readonly authHeaders?: (ctx: {
    readonly refresh: boolean;
  }) => Promise<Record<string, string>> | Record<string, string>;
  /** Policy for a terminal remote failure after it is quarantined. */
  readonly terminalPolicy?: "block" | "degraded_skip";
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
  created_at INTEGER NOT NULL
)`;

const OUTBOX_SCHEMA_FINGERPRINT_DDL = `ALTER TABLE ${OUTBOX_TABLE}
  ADD COLUMN schema_fingerprint TEXT NOT NULL DEFAULT 'legacy'`;

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
  ops TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  permanent INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL
)`;

interface QuarantineState {
  attempts: number;
  permanent: boolean;
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

type PostOutcome = "ok" | "rejected" | "offline";

const POST_OUTCOME_TO_STATUS: Record<PostOutcome, SyncStatus> = {
  ok: "caught_up",
  rejected: "degraded",
  offline: "offline",
};

// ── Engine ↔ wire conversion ───────────────────────────────────────────────

interface EngineInsertOp {
  readonly type: "insert";
  readonly table: string;
  readonly id: string;
  readonly data: Record<string, unknown> & { id: string };
}

interface EngineUpdateOp {
  readonly type: "update";
  readonly table: string;
  readonly id: string;
  readonly patch: Record<string, unknown>;
}

interface EngineDeleteOp {
  readonly type: "delete";
  readonly table: string;
  readonly id: string;
}

type EngineOp = EngineInsertOp | EngineUpdateOp | EngineDeleteOp;

/** Convert one engine `Op` into one or more wire `Op`s. */
function engineOpToWire(op: EngineOp): WireOp[] {
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
function wireOpToEngine<S extends SchemaMap>(op: WireOp): EngineOp & { table: keyof S & string } {
  if (op.op === "insert") {
    return {
      type: "insert",
      table: op.table as keyof S & string,
      id: op.row_id,
      data: { ...op.data, id: op.row_id } as Record<string, unknown> & { id: string },
    };
  }
  if (op.op === "update") {
    return {
      type: "update",
      table: op.table as keyof S & string,
      id: op.row_id,
      patch: { [op.col]: op.value },
    };
  }
  return { type: "delete", table: op.table as keyof S & string, id: op.row_id };
}

function wireOpsToEngine<S extends SchemaMap>(
  ops: ReadonlyArray<WireOp>,
): Array<EngineOp & { table: keyof S & string }> {
  const result: Array<EngineOp & { table: keyof S & string }> = [];
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
// ── Transport ──────────────────────────────────────────────────────────────

export class SyncTransport<S extends SchemaMap> {
  readonly #engine: PalladiumEngine<S>;
  readonly #serverUrl: string;
  readonly #pollIntervalMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #authHeaders?: SyncTransportOptions["authHeaders"];
  readonly #schemaFingerprint: string;
  readonly #terminalPolicy: NonNullable<SyncTransportOptions["terminalPolicy"]>;

  #cursor: string | null = null;
  #pollHandle: ReturnType<typeof setInterval> | null = null;
  #initialHydrationDone = false;
  #polling = false;
  #unsubscribeLocal: (() => void) | null = null;
  #initialized = false;
  #initPromise: Promise<void> | null = null;
  #startPromise: Promise<void> | null = null;
  #stopPromise: Promise<void> | null = null;
  #disposed = false;

  /**
   * Once-only transport init: provision the durable outbox + quarantine tables
   * AND restore the persisted poll cursor (`D2b`). Called by both `start()` and
   * the public `poll()`, so a caller that drives a single `poll()` before
   * `start()` both has a `_sync_quarantine` to write to and resumes from the
   * saved cursor instead of re-fetching the full history from scratch.
   *
   * Concurrency-safe: the work runs once behind a shared in-flight promise, so
   * overlapping `start()`/`poll()` callers await the same init rather than both
   * running the DDL + cursor restore and racing on `#cursor`. The promise is
   * cleared on failure so a later call can retry.
   */
  #ensureInitialized(): Promise<void> {
    if (this.#initialized) return Promise.resolve();
    if (this.#initPromise === null) this.#initPromise = this.#runInit();
    return this.#initPromise;
  }

  async #runInit(): Promise<void> {
    try {
      await this.#engine.adapter.exec(OUTBOX_DDL, []);
      try {
        await this.#engine.adapter.exec(OUTBOX_SCHEMA_FINGERPRINT_DDL, []);
      } catch (err) {
        if (
          !(
            err instanceof Error &&
            /duplicate column name:\s*schema_fingerprint/iu.test(err.message)
          )
        ) {
          throw err;
        }
      }
      await this.#engine.adapter.exec(OUTBOX_QUARANTINE_DDL, []);
      await this.#engine.adapter.exec(QUARANTINE_DDL, []);
      const savedAppendCursor = await this.#engine.getSyncState(STATE_APPEND_CURSOR);
      if (isAppendCursor(savedAppendCursor)) {
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
    this.#engine = engine;
    engine.acquireSyncTransport(this);
    this.#serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#schemaFingerprint = options.schemaFingerprint ?? "unversioned";
    this.#authHeaders = options.authHeaders;
    this.#terminalPolicy = options.terminalPolicy ?? "block";
    engine.registerLocalChangeCheckpoint(async (local, adapter) => {
      const wireOps = (local.ops as ReadonlyArray<EngineOp>).flatMap(engineOpToWire);
      if (wireOps.length === 0) return;
      await adapter.exec(OUTBOX_DDL, []);
      const columns = await adapter.exec<{ name: string }>(
        `PRAGMA table_info("${OUTBOX_TABLE}")`,
        [],
      );
      if (!columns.some((column) => column.name === "schema_fingerprint")) {
        await adapter.exec(OUTBOX_SCHEMA_FINGERPRINT_DDL, []);
      }
      await adapter.exec(
        `INSERT INTO ${OUTBOX_TABLE}
         (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
    });
  }
  /**
   * Fetch with the auth-decoration hook applied. Attaches the headers from
   * `authHeaders` (bearer token + advisory workspace selector); on a `401` it
   * re-invokes the hook once with `refresh: true` and retries, so an on-demand
   * token refresh recovers without dropping the request (`§2b`).
   *
   * When no hook is configured this returns the underlying fetch promise
   * directly — no extra microtask — so timing matches a bare `fetch`.
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
      const extra = await authHeaders({ refresh });
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(extra)) headers.set(k, v);
      return this.#fetch(input, { ...init, headers });
    };
    const res = await send(false);
    // One refresh+retry on 401 — the token may have just expired.
    return res.status === 401 ? send(true) : res;
  }

  /**
   * Provision the outbox + quarantine tables, drain any pending rows from
   * previous sessions, hydrate from server, then start polling. Idempotent.
   */
  async start(): Promise<void> {
    if (this.#disposed) throw new Error("SyncTransport is disposed");
    if (this.#pollHandle !== null) return;
    if (this.#startPromise !== null) return this.#startPromise;
    this.#startPromise = (async () => {
      await this.#ensureInitialized();
      await this.#drainOutbox();
      this.#unsubscribeLocal = this.#engine.on("changes:local", () => void this.#tick());
      await this.#poll();
      this.#pollHandle = setInterval(() => void this.#tick(), this.#pollIntervalMs);
    })().finally(() => {
      this.#startPromise = null;
    });
    return this.#startPromise;
  }

  /** One periodic step: drain the outbox, then poll. */
  async #tick(): Promise<void> {
    await this.#drainOutbox();
    await this.#poll();
  }

  /** Re-attempt pending rows, terminally quarantining schema mismatches. */
  async #drainOutbox(): Promise<void> {
    const rows = await this.#engine.adapter.exec<OutboxRow>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint, created_at
         FROM ${OUTBOX_TABLE}
         ORDER BY hlc_wall_ms ASC, hlc_counter ASC, change_id ASC`,
      [],
    );
    if (rows.length === 0) return;
    this.#engine.setStatus("syncing");
    let lastOutcome: PostOutcome = "ok";
    for (const row of rows) {
      if (
        row.schema_fingerprint !== this.#schemaFingerprint &&
        !(await this.#outboxCompatible(row))
      ) {
        await this.#quarantineOutbox(row);
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
        break;
      }
    }
    this.#engine.setStatus(POST_OUTCOME_TO_STATUS[lastOutcome]);
  }

  #decodeOutboxOps(serialized: string): WireOp[] | null {
    try {
      const parsed: unknown = JSON.parse(serialized);
      return Array.isArray(parsed) ? (parsed as WireOp[]) : null;
    } catch {
      return null;
    }
  }

  async #outboxCompatible(row: OutboxRow): Promise<boolean> {
    const ops = this.#decodeOutboxOps(row.ops);
    if (ops === null) return false;

    const columns = new Map<string, Set<string>>();
    for (const op of ops) {
      if (!(await this.#outboxOpCompatible(op, columns))) return false;
    }
    return true;
  }

  async #outboxOpCompatible(op: WireOp, columns: Map<string, Set<string>>): Promise<boolean> {
    if (typeof op !== "object" || op === null) return false;
    if (
      typeof op.table !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(op.table) ||
      !this.#engine.hasTable(op.table)
    ) {
      return false;
    }
    let tableColumns = columns.get(op.table);
    if (tableColumns === undefined) {
      const schemaRows = await this.#engine.adapter.exec<{ name: string }>(
        `PRAGMA table_info("${op.table}")`,
        [],
      );
      tableColumns = new Set(schemaRows.map((entry) => entry.name));
      columns.set(op.table, tableColumns);
    }
    if (op.op === "insert") {
      return (
        tableColumns.has("id") && Object.keys(op.data).every((column) => tableColumns?.has(column))
      );
    }
    if (op.op === "update") return tableColumns.has(op.col);
    return op.op === "delete";
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

  /** Stop polling and unsubscribe from engine events. Idempotent. */
  async stop(): Promise<void> {
    if (this.#stopPromise !== null) return this.#stopPromise;
    this.#stopPromise = (async () => {
      if (this.#pollHandle !== null) {
        clearInterval(this.#pollHandle);
        this.#pollHandle = null;
      }
      if (this.#unsubscribeLocal !== null) {
        this.#unsubscribeLocal();
        this.#unsubscribeLocal = null;
      }
    })().finally(() => {
      this.#stopPromise = null;
    });
    return this.#stopPromise;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    await this.stop();
    this.#disposed = true;
    this.#engine.releaseSyncTransport(this);
  }

  async inspectQuarantine(): Promise<ReadonlyArray<Record<string, unknown>>> {
    await this.#ensureInitialized();
    return this.#engine.adapter.exec(
      `SELECT * FROM ${QUARANTINE_TABLE} ORDER BY updated_at ASC`,
      [],
    );
  }

  async exportQuarantine(): Promise<string> {
    return JSON.stringify(await this.inspectQuarantine());
  }

  async retryQuarantined(changeId: string): Promise<void> {
    await this.#ensureInitialized();
    await this.#engine.adapter.exec(
      `UPDATE ${QUARANTINE_TABLE} SET permanent = 0, attempts = 0, updated_at = ? WHERE change_id = ?`,
      [Date.now(), changeId],
    );
  }

  async discardQuarantined(changeId: string): Promise<void> {
    await this.#ensureInitialized();
    await this.#engine.adapter.exec(`DELETE FROM ${QUARANTINE_TABLE} WHERE change_id = ?`, [
      changeId,
    ]);
  }

  /**
   * Attempt a single POST.
   * - "ok": 2xx response
   * - "rejected": fetch returned a non-2xx (server reachable, request rejected)
   * - "offline": fetch threw (network down, DNS, CORS, etc.)
   */
  async #tryPost(change: WireChange): Promise<PostOutcome> {
    try {
      const res = await this.#fetchWithAuth(`${this.#serverUrl}/v1/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      return res.ok ? "ok" : "rejected";
    } catch {
      return "offline";
    }
  }

  /**
   * Perform one downlink poll: fetch changes newer than the cursor and apply
   * them. Public so callers (and tests) can drive a deterministic single sync
   * step; the periodic timer calls the same path.
   */
  async poll(): Promise<void> {
    await this.#ensureInitialized();
    return this.#poll();
  }

  async syncOnce(): Promise<void> {
    await this.#ensureInitialized();
    await this.#drainOutbox();
    await this.#poll();
  }

  /** Fetch and validate one versioned page envelope before applying any of it. */
  async #fetchPollPage(): Promise<{
    readonly changes: WireChange[];
    readonly purges: ReadonlyArray<{ readonly table: string; readonly row_id: string }>;
    readonly cursor: string | null;
    readonly upperBound: string;
    readonly caughtUp: boolean;
    readonly control: { readonly mustRefetch: boolean };
  } | null> {
    const params = new URLSearchParams({ limit: "100" });
    if (this.#cursor !== null) params.set("cursor", this.#cursor);
    try {
      const res = await this.#fetchWithAuth(`${this.#serverUrl}/v1/changes?${params}`);
      if (!res.ok) return null;
      const bodyValue: unknown = await res.json();
      if (typeof bodyValue !== "object" || bodyValue === null || Array.isArray(bodyValue))
        return null;
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
        !body["events"].every((event) => isJsonValue(event)) ||
        !("cursor" in body) ||
        (body["cursor"] !== null && !isAppendCursor(body["cursor"])) ||
        !isAppendCursor(body["upperBound"]) ||
        typeof body["caughtUp"] !== "boolean" ||
        typeof control !== "object" ||
        control === null ||
        typeof (control as Record<string, unknown>)["mustRefetch"] !== "boolean"
      )
        return null;
      const changes = body["changes"];
      if (!changes.every(isWireChange)) return null;
      return {
        changes,
        purges: body["purges"] as ReadonlyArray<{
          readonly table: string;
          readonly row_id: string;
        }>,
        cursor: body["cursor"] as string | null,
        upperBound: body["upperBound"] as string,
        caughtUp: body["caughtUp"] as boolean,
        control: control as { readonly mustRefetch: boolean },
      };
    } catch {
      return null;
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
      for (const change of page.changes) {
        const advanced = await this.#applyOneRemote(change);
        if (!advanced) return;
      }
      for (const purge of page.purges) {
        await this.#engine.purgeLocal(purge.table as keyof S & string, purge.row_id);
      }
      this.#initialHydrationDone = true;
      if (page.cursor !== null) {
        const saved = this.#cursor;
        if (saved === null || BigInt(page.cursor) >= BigInt(saved)) {
          await this.#engine.setSyncState(STATE_APPEND_CURSOR, page.cursor);
          this.#cursor = page.cursor;
        }
      }
      if (
        this.#engine.getSyncStatus() !== "degraded" &&
        this.#engine.getSyncStatus() !== "offline"
      ) {
        this.#engine.setStatus(page.caughtUp ? "caught_up" : "syncing");
      }
    } finally {
      this.#polling = false;
    }
  }

  /**
   * Apply one polled change with non-poisoning semantics.
   */
  async #applyOneRemote(change: WireChange): Promise<boolean> {
    if (this.#initialHydrationDone && change.hlc.nodeId === this.#engine.nodeId) return true;
    const quarantine = await this.#quarantineState(change.id);
    if (quarantine?.permanent) return true;
    const remoteChange = {
      hlc: change.hlc,
      id: change.id,
      scope: change.scope,
      ops: wireOpsToEngine<S>(change.ops),
    } as unknown as Parameters<PalladiumEngine<S>["applyRemote"]>[0];
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
  /** Read the quarantine state for a change, or `null` if not quarantined. */
  async #quarantineState(changeId: string): Promise<QuarantineState | null> {
    const rows = await this.#engine.adapter.exec<{
      attempts: number;
      permanent: number;
    }>(`SELECT attempts, permanent FROM ${QUARANTINE_TABLE} WHERE change_id = ?`, [changeId]);
    const row = rows[0];
    return row ? { attempts: row.attempts, permanent: row.permanent !== 0 } : null;
  }

  /** Record (or increment) a failed apply; returns the new attempt count. */
  async #recordFailure(change: WireChange, err: unknown): Promise<number> {
    const message = err instanceof Error ? err.message : String(err);
    await this.#engine.adapter.exec(
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
    const state = await this.#quarantineState(change.id);
    return state?.attempts ?? 1;
  }

  async #markPermanent(changeId: string): Promise<void> {
    await this.#engine.adapter.exec(
      `UPDATE ${QUARANTINE_TABLE} SET permanent = 1, updated_at = ? WHERE change_id = ?`,
      [Date.now(), changeId],
    );
  }

  async #clearQuarantine(changeId: string): Promise<void> {
    await this.#engine.adapter.exec(`DELETE FROM ${QUARANTINE_TABLE} WHERE change_id = ?`, [
      changeId,
    ]);
  }
}
