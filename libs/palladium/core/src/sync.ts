/**
 * SyncTransport — HTTP-poll-based sync between a `PalladiumEngine` and a
 * `palladium-axum` server.
 *
 * Lifecycle
 * ─────────
 * `await transport.start()` hydrates the local store from the server (full
 * `GET /v1/changes`), then schedules a periodic poll that applies new remote
 * changes via `engine.applyRemote()`. While the transport is running, any
 * local `engine.tx()` fires a `"changes:local"` event that the transport
 * batches into a single `POST /v1/changes`.
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

import type { PalladiumEngine } from "./engine.js";
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
        data: op.data,
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

  /** Hydrate from server, then start polling. Idempotent. */
  async start(): Promise<void> {
    if (this.#pollHandle !== null) return;
    this.#unsubscribeLocal = this.#engine.on("changes:local", (payload) => {
      void this.#postLocal(payload.ops as ReadonlyArray<EngineOp>);
    });
    await this.#poll();
    this.#pollHandle = setInterval(() => {
      void this.#poll();
    }, this.#pollIntervalMs);
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

  /** Post one batched Change for the just-committed local ops. */
  async #postLocal(ops: ReadonlyArray<EngineOp>): Promise<void> {
    const wireOps = ops.flatMap(engineOpToWire);
    if (wireOps.length === 0) return;
    const change: WireChange = {
      id: crypto.randomUUID(),
      hlc: this.#engine.nextSendHlc(),
      ops: wireOps,
    };
    this.#engine.setStatus("syncing");
    try {
      const res = await this.#fetch(`${this.#serverUrl}/v1/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      this.#engine.setStatus(res.ok ? "idle" : "error");
    } catch {
      this.#engine.setStatus("offline");
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
        // are causally later, then apply the ops via the suppress-emit path.
        this.#engine.receiveHlc(change.hlc);
        const engineOps = change.ops.map(wireOpToEngine<S>);
        // The cast is structural: wireOpToEngine emits the same {type, table,
        // id, data?, patch?} shape Op<S> declares, but TS can't see through
        // the generic to verify. The runtime values pass through applyRemote's
        // own validation inside tx().
        const opsForEngine = engineOps as unknown as Parameters<
          PalladiumEngine<S>["applyRemote"]
        >[0];
        await this.#engine.applyRemote(opsForEngine);
      }

      this.#initialHydrationDone = true;
    } finally {
      this.#polling = false;
    }
  }
}
