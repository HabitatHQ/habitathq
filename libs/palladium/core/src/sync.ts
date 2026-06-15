/**
 * SyncTransport — HTTP-poll-based sync between a `PalladiumEngine` and a
 * `palladium-axum` server.
 *
 * Lifecycle
 * ─────────
 * The transport is a dumb drainer of the engine's `_changes` journal. It
 * does not own the journal; the engine writes a row for every local tx
 * (see {@link PalladiumEngine.tx}). On `start()`, the transport:
 *
 *   1. drains any rows already in the journal (writes made before
 *      `start()`, plus rows that never made it to the server last time),
 *   2. hydrates from the server with the current cursor,
 *   3. starts polling.
 *
 * Each tick: drain the journal, then poll for remote changes. `stop()`
 * clears the poll timer. The transport can be restarted (idempotently).
 *
 * Wire-format quirks
 * ──────────────────
 * The Rust server's `Op::Update` is single-column (`{col, value}`) while
 * the engine's update op carries a `patch: Partial<Row>` (potentially
 * many columns). The journal stores one `update` per column (fan-out),
 * which matches the wire shape directly.
 */

import type { PalladiumEngine, SyncStatus } from "./engine.js";
import type { Hlc } from "./hlc.js";
import { JOURNAL_TABLE, type JournalOp, type JournalRow, journalRowToEntry } from "./journal.js";
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

// ── Options ────────────────────────────────────────────────────────────────

export interface SyncTransportOptions {
  readonly serverUrl: string;
  /** Polling interval for the downlink. Default: 1000 ms. */
  readonly pollIntervalMs?: number;
  /** Override `fetch` for tests. */
  readonly fetch?: typeof globalThis.fetch;
}

// ── Journal ↔ wire conversion ──────────────────────────────────────────────

/** Convert one journal `Op` into its wire shape. The shapes already match. */
function journalOpToWire(op: JournalOp): WireOp {
  if (op.op === "insert") {
    return { op: "insert", table: op.table, row_id: op.row_id, data: op.data };
  }
  if (op.op === "update") {
    return { op: "update", table: op.table, row_id: op.row_id, col: op.col, value: op.value };
  }
  return { op: "delete", table: op.table, row_id: op.row_id };
}

function rowToChange(row: JournalRow): WireChange {
  const entry = journalRowToEntry(row);
  return {
    id: entry.changeId,
    hlc: entry.hlc,
    ops: entry.ops.map(journalOpToWire),
  };
}

/** Convert one wire `Op` into the engine `Op` shape that `applyRemote` accepts. */
function wireOpToEngine<S extends SchemaMap>(
  op: WireOp,
):
  | {
      type: "insert";
      table: keyof S & string;
      data: Record<string, unknown> & { id: string };
    }
  | {
      type: "update";
      table: keyof S & string;
      id: string;
      patch: Record<string, unknown>;
    }
  | {
      type: "delete";
      table: keyof S & string;
      id: string;
    } {
  if (op.op === "insert") {
    return {
      type: "insert",
      table: op.table as keyof S & string,
      data: { id: op.row_id, ...op.data } as Record<string, unknown> & { id: string },
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

type PostOutcome = "ok" | "rejected" | "offline";

const POST_OUTCOME_TO_STATUS: Record<PostOutcome, SyncStatus> = {
  ok: "idle",
  rejected: "error",
  offline: "offline",
};

// ── Transport ──────────────────────────────────────────────────────────────

export class SyncTransport<S extends SchemaMap> {
  readonly #engine: PalladiumEngine<S>;
  readonly #serverUrl: string;
  readonly #pollIntervalMs: number;
  readonly #fetch: typeof globalThis.fetch;

  #cursor: string | null = null;
  #pollHandle: ReturnType<typeof setInterval> | null = null;
  #polling = false;
  #initialHydrationDone = false;
  #unsubscribeLocal: (() => void) | null = null;

  constructor(engine: PalladiumEngine<S>, options: SyncTransportOptions) {
    this.#engine = engine;
    this.#serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Drain the engine's journal, hydrate from the server, then start polling.
   * Idempotent.
   *
   * We also subscribe to the engine's `changes:local` event to trigger an
   * *immediate* drain attempt when a new local tx commits. The journal is
   * still the source of truth: the event is just a hint to avoid waiting
   * for the next poll tick. A racing tick-drain and event-drain is safe —
   * both read the same rows in the same order, and the DELETE is idempotent
   * (the second one is a no-op).
   */
  async start(): Promise<void> {
    if (this.#pollHandle !== null) return;
    this.#unsubscribeLocal = this.#engine.on("changes:local", () => {
      void this.#drainJournal();
    });
    await this.#drainJournal();
    await this.#poll();
    this.#pollHandle = setInterval(() => {
      void this.#tick();
    }, this.#pollIntervalMs);
  }

  /** One periodic step: drain the journal, then poll. */
  async #tick(): Promise<void> {
    await this.#drainJournal();
    await this.#poll();
  }

  /**
   * Re-attempt every row currently in the engine's `_changes` journal,
   * oldest first. The transport owns nothing; the engine does. We just
   * observe and try to upload.
   *
   * Stop after the first failure to preserve ordering and avoid hammering
   * a server that's clearly not accepting writes.
   */
  async #drainJournal(): Promise<void> {
    const rows = await this.#engine.adapter.exec<JournalRow>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at
         FROM ${JOURNAL_TABLE}
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
        await this.#engine.adapter.exec(`DELETE FROM ${JOURNAL_TABLE} WHERE change_id = ?`, [
          row.change_id,
        ]);
      } else {
        break;
      }
    }
    this.#engine.setStatus(POST_OUTCOME_TO_STATUS[lastOutcome]);
  }

  /** Stop polling. Idempotent. */
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

  /**
   * Attempt a single POST.
   * - "ok": 2xx response
   * - "rejected": fetch returned a non-2xx (server reachable, request rejected)
   * - "offline": fetch threw (network down, DNS, CORS, etc.)
   */
  async #tryPost(change: WireChange): Promise<PostOutcome> {
    try {
      const res = await this.#fetch(`${this.#serverUrl}/v1/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      return res.ok ? "ok" : "rejected";
    } catch {
      return "offline";
    }
  }

  /** Fetch newer changes from server and apply them locally. */
  async #poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      const url =
        this.#cursor === null
          ? `${this.#serverUrl}/v1/changes`
          : `${this.#serverUrl}/v1/changes?after=${this.#cursor}`;

      let changes: WireChange[];
      try {
        const res = await this.#fetch(url);
        if (!res.ok) return;
        changes = (await res.json()) as WireChange[];
      } catch {
        return;
      }

      for (const change of changes) {
        // Advance cursor for every change we see, even own-changes we skip.
        this.#cursor = hlcToAfterCursor(change.hlc);

        // After initial hydration, skip own writes — we already applied them.
        if (this.#initialHydrationDone && change.hlc.nodeId === this.#engine.nodeId) {
          continue;
        }

        // Advance the engine's HLC past the remote so subsequent local sends
        // are causally later, then apply the ops. The change HLC is the
        // LWW comparator; column-level comparisons happen inside applyRemote.
        this.#engine.receiveHlc(change.hlc);
        const engineOps = change.ops.map(wireOpToEngine<S>);
        const opsForEngine = engineOps as unknown as Parameters<
          PalladiumEngine<S>["applyRemote"]
        >[1];
        await this.#engine.applyRemote(change.hlc, opsForEngine);
      }

      this.#initialHydrationDone = true;
    } finally {
      this.#polling = false;
    }
  }
}
