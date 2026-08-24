/**
 * SyncTransport — HTTP-poll-based sync between a `PalladiumEngine` and a
 * `palladium-axum` server.
 *
 * Lifecycle
 * ─────────
 * `await transport.start()` creates a `_sync_pending_changes` outbox table if
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
import type { SchemaMap } from "./tx.js";

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
  readonly hlc: Hlc;
  readonly ops: ReadonlyArray<WireOp>;
  /** Server-assigned durable append cursor, when provided by the server. */
  readonly cursor?: string;
}

/**
 * Runtime guard for a decoded change — the transport skips anything else.
 *
 * Validates the envelope shape the downlink depends on: a string `id`, an HLC
 * with a string `nodeId` + numeric `wallMs`/`counter` (so `hlcToAfterCursor`
 * and own-write skipping work), and an `ops` array whose entries at least name
 * their kind. Deep per-op field validation stays in `applyRemote`, which
 * quarantines a malformed op rather than throwing — so this guard only has to
 * keep the poll loop itself from crashing on a bad shape.
 */
function isWireChange(value: unknown): value is WireChange {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c["id"] !== "string" || !Array.isArray(c["ops"])) return false;
  if (c["cursor"] !== undefined && typeof c["cursor"] !== "string") return false;
  const hlc = c["hlc"];
  if (typeof hlc !== "object" || hlc === null) return false;
  const h = hlc as Record<string, unknown>;
  if (
    typeof h["nodeId"] !== "string" ||
    typeof h["wallMs"] !== "number" ||
    typeof h["counter"] !== "number"
  ) {
    return false;
  }
  return c["ops"].every(
    (op) =>
      typeof op === "object" &&
      op !== null &&
      typeof (op as Record<string, unknown>)["op"] === "string",
  );
}

// ── Cursor encoding ─────────────────────────────────────────────────────────

/**
 * Encode an [`Hlc`] as the lexicographic cursor accepted by the server's
 * `GET /v1/changes?after=` query parameter.
 *
 * Format: `{wallMs:020}_{counter:010}_{nodeIdHex:032x}` — sortable as a string.
 */
export function hlcToAfterCursor(hlc: Hlc): string {
  const wallMs = String(hlc.wallMs).padStart(20, "0");
  const counter = String(hlc.counter).padStart(10, "0");
  const nodeId = hlc.nodeId.replace(/-/g, "").padStart(32, "0");
  return `${wallMs}_${counter}_${nodeId}`;
}

/** Return whether `next` is after `current` in its server cursor domain. */
function cursorAdvances(current: string | null, next: string): boolean {
  if (current === null) return true;
  if (/^\d+$/.test(current) && /^\d+$/.test(next)) return BigInt(next) > BigInt(current);
  return next > current;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface SyncTransportOptions {
  readonly serverUrl: string;
  /** Polling interval for the downlink. Default: 1000 ms. */
  readonly pollIntervalMs?: number;
  /** Override `fetch` for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * How many times a change may fail to apply before it is permanently
   * dead-lettered and the cursor advances past it (`D2a` terminal state).
   * Default: 5.
   */
  readonly maxApplyAttempts?: number;
  /**
   * Request-decoration hook: returns headers attached to every server request
   * — typically `Authorization: Bearer <token>` plus an advisory workspace
   * *selector* (`D11`/§2b). Called per request so a rotating token is always
   * fresh; on a `401` the transport re-invokes it once (`refresh: true`) and
   * retries the request. The opaque store scope is **never** sent — the server
   * derives it from these headers.
   */
  readonly authHeaders?: (ctx: {
    readonly refresh: boolean;
  }) => Promise<Record<string, string>> | Record<string, string>;
  /**
   * Adapt a raw `GET /v1/changes` response body into changes and optionally
   * an envelope cursor. Bare arrays remain supported for generic servers.
   */
  readonly decodeChanges?: (
    body: unknown,
  ) =>
    | WireChange[]
    | { readonly changes: WireChange[]; readonly cursor?: string | null }
    | Promise<WireChange[] | { readonly changes: WireChange[]; readonly cursor?: string | null }>;

  /** Opaque post-apply acknowledgement hook for the decoded response body. */
  readonly acknowledgeChanges?: (body: unknown) => Promise<void>;
}

// ── Outbox table ───────────────────────────────────────────────────────────

const OUTBOX_TABLE = "_sync_pending_changes";

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
  created_at INTEGER NOT NULL
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

/** `_sync_state` key under which the durable poll cursor is stored (`D2b`). */
const STATE_CURSOR = "cursor";

interface OutboxRow {
  change_id: string;
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
  /** JSON-encoded array of `WireOp`. */
  ops: string;
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
  ok: "idle",
  rejected: "error",
  offline: "offline",
};

// ── Engine ↔ wire conversion ───────────────────────────────────────────────

interface EngineInsertOp {
  readonly type: "insert";
  readonly table: string;
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
      data: { ...op.data, id: op.row_id } as Record<string, unknown> & {
        id: string;
      },
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
  return {
    type: "delete",
    table: op.table as keyof S & string,
    id: op.row_id,
  };
}

// ── Transport ──────────────────────────────────────────────────────────────

export class SyncTransport<S extends SchemaMap> {
  readonly #engine: PalladiumEngine<S>;
  readonly #serverUrl: string;
  readonly #pollIntervalMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxApplyAttempts: number;
  readonly #authHeaders?: SyncTransportOptions["authHeaders"];
  readonly #acknowledgeChanges?: SyncTransportOptions["acknowledgeChanges"];

  #cursor: string | null = null;
  #pollHandle: ReturnType<typeof setInterval> | null = null;
  readonly #decodeChanges: NonNullable<SyncTransportOptions["decodeChanges"]>;
  #initialHydrationDone = false;
  #polling = false;
  #unsubscribeLocal: (() => void) | null = null;
  #initialized = false;
  #initPromise: Promise<void> | null = null;

  constructor(engine: PalladiumEngine<S>, options: SyncTransportOptions) {
    this.#engine = engine;
    this.#serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const maxAttempts = options.maxApplyAttempts ?? 5;
    this.#maxApplyAttempts = Number.isInteger(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 5;
    this.#authHeaders = options.authHeaders;
    this.#acknowledgeChanges = options.acknowledgeChanges;
    this.#decodeChanges =
      options.decodeChanges ??
      ((body) => {
        if (Array.isArray(body)) return body;
        if (typeof body === "object" && body !== null && "changes" in body) {
          const changes = body.changes;
          return Array.isArray(changes) ? (changes as WireChange[]) : [];
        }
        return [];
      });
    engine.registerLocalChangeCheckpoint(async (local, adapter) => {
      const wireOps = (local.ops as ReadonlyArray<EngineOp>).flatMap(engineOpToWire);
      if (wireOps.length === 0) return;
      await adapter.exec(OUTBOX_DDL, []);
      await adapter.exec(
        `INSERT INTO ${OUTBOX_TABLE} (change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          local.changeId,
          local.hlc.wallMs,
          local.hlc.counter,
          local.hlc.nodeId,
          JSON.stringify(wireOps),
          Date.now(),
        ],
      );
    });
  }

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
      await this.#engine.adapter.exec(QUARANTINE_DDL, []);
      const savedCursor = await this.#engine.getSyncState(STATE_CURSOR);
      if (savedCursor !== null) {
        // A prior session already hydrated; resume after the cursor and skip own writes.
        this.#cursor = savedCursor;
        this.#initialHydrationDone = true;
      }
      this.#initialized = true;
    } catch (err) {
      this.#initPromise = null; // allow a retry after a transient failure
      throw err;
    }
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
    if (this.#pollHandle !== null) return;
    await this.#ensureInitialized();
    await this.#drainOutbox();
    this.#unsubscribeLocal = this.#engine.on("changes:local", (payload) => {
      const wireOps = (payload.ops as ReadonlyArray<EngineOp>).flatMap(engineOpToWire);
      if (wireOps.length === 0) return;
      void this.#postLocal({ id: payload.changeId, hlc: payload.hlc, ops: wireOps });
    });
    await this.#poll();
    this.#pollHandle = setInterval(() => {
      void this.#tick();
    }, this.#pollIntervalMs);
  }

  /** One periodic step: drain the outbox, then poll. */
  async #tick(): Promise<void> {
    await this.#drainOutbox();
    await this.#poll();
  }

  /** Re-attempt every row currently in `_sync_pending_changes`, oldest first. */
  async #drainOutbox(): Promise<void> {
    const rows = await this.#engine.adapter.exec<OutboxRow>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at
         FROM ${OUTBOX_TABLE}
         ORDER BY hlc_wall_ms ASC, hlc_counter ASC, change_id ASC`,
      [],
    );
    if (rows.length === 0) return;
    this.#engine.setStatus("syncing");
    let lastOutcome: PostOutcome = "ok";
    for (const row of rows) {
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

  /** Stop polling and unsubscribe from engine events. Idempotent. */
  async stop(): Promise<void> {
    if (this.#pollHandle !== null) {
      clearInterval(this.#pollHandle);
      this.#pollHandle = null;
    }
    if (this.#unsubscribeLocal !== null) {
      this.#unsubscribeLocal();
      this.#unsubscribeLocal = null;
    }
  }

  /** Attempt delivery of a change already durably recorded by the engine. */
  async #postLocal(change: WireChange): Promise<void> {
    this.#engine.setStatus("syncing");
    const outcome = await this.#tryPost(change);
    if (outcome === "ok") {
      await this.#engine.adapter.exec(`DELETE FROM ${OUTBOX_TABLE} WHERE change_id = ?`, [
        change.id,
      ]);
    }
    this.#engine.setStatus(POST_OUTCOME_TO_STATUS[outcome]);
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
    // A caller may drive a single poll() without start(); provision tables and
    // restore the persisted cursor first, so this poll resumes from the saved
    // position instead of re-fetching the whole history.
    await this.#ensureInitialized();
    return this.#poll();
  }

  /** Fetch newer changes from server and apply them locally (non-poisoning). */
  async #poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      const url =
        this.#cursor === null
          ? `${this.#serverUrl}/v1/changes`
          : `${this.#serverUrl}/v1/changes?after=${this.#cursor}`;

      let changes: WireChange[];
      let envelopeCursor: string | null | undefined;
      let responseBody: unknown;
      try {
        const res = await this.#fetchWithAuth(url);
        if (!res.ok) return;
        responseBody = await res.json();
        const decoded = await this.#decodeChanges(responseBody);
        if (Array.isArray(decoded)) {
          changes = decoded;
        } else {
          changes = Array.isArray(decoded.changes) ? decoded.changes : [];
          envelopeCursor = decoded.cursor;
        }
      } catch {
        return;
      }

      let pageSucceeded = true;
      for (const change of changes) {
        if (!isWireChange(change)) continue;
        const nextCursor = change.cursor ?? hlcToAfterCursor(change.hlc);
        const advanced = await this.#applyOneRemote(change, nextCursor);
        if (!advanced) {
          pageSucceeded = false;
          break;
        }
        if (cursorAdvances(this.#cursor, nextCursor)) {
          this.#cursor = nextCursor;
          await this.#engine.setSyncState(STATE_CURSOR, nextCursor);
        }
      }

      if (pageSucceeded && envelopeCursor !== undefined && envelopeCursor !== null) {
        this.#cursor = envelopeCursor;
        await this.#engine.setSyncState(STATE_CURSOR, envelopeCursor);
      }

      this.#initialHydrationDone = true;
      if (this.#acknowledgeChanges !== undefined) {
        await this.#acknowledgeChanges(responseBody);
      }
    } finally {
      this.#polling = false;
    }
  }

  /**
   * Apply one polled change with non-poisoning semantics (`D2a`, G2). Returns
   * `true` when the cursor may advance past this change — it was applied, is
   * our own already-applied write, or has been permanently dead-lettered —
   * and `false` when the change failed transiently and should be retried
   * (so the cursor must not move past it yet).
   */
  async #applyOneRemote(change: WireChange, cursor: string): Promise<boolean> {
    // After initial hydration, skip own writes — we already applied them.
    if (this.#initialHydrationDone && change.hlc.nodeId === this.#engine.nodeId) {
      return true;
    }

    const quarantine = await this.#quarantineState(change.id);
    // Already permanently dead-lettered: skip past it (terminal state, L71).
    if (quarantine?.permanent) return true;

    if (change.ops.some((op) => !this.#engine.hasTable(op.table))) {
      throw new Error("remote change references an unknown table");
    }
    const remoteChange = {
      hlc: change.hlc,
      id: change.id,
      ops: change.ops.map(wireOpToEngine<S>),
    } as unknown as Parameters<PalladiumEngine<S>["applyRemote"]>[0];

    try {
      await this.#engine.applyRemote(remoteChange, cursor);
      if (quarantine !== null) await this.#clearQuarantine(change.id);
      return true;
    } catch (err) {
      const attempts = await this.#recordFailure(change, err);
      if (attempts >= this.#maxApplyAttempts) {
        await this.#markPermanent(change.id);
        this.#engine.setStatus("error");
        return true;
      }
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
