/**
 * NotesEngine — PalladiumEngine subclass that syncs notes to/from the
 * Palladium REST backend while keeping local state in a MemoryAdapter.
 *
 * Sync protocol
 * ─────────────
 * • Local mutations (_putRow / _patchRow / _removeRow) are immediately
 *   written to the in-memory store AND fire-and-forget POSTed to the server.
 * • A 1-second poll fetches changes produced by OTHER nodes (cursor-based
 *   pagination) and applies them via the engine's public insert/update/delete
 *   so that live queries are notified.
 * • On init(), a full fetch (no cursor) hydrates the local store from the
 *   server before the first render — own past changes are included so that
 *   the state survives page reloads.
 */

import { MemoryAdapter, PalladiumEngine } from "@palladium/core";
import type { SyncStatus } from "@palladium/core";

// ── Schema ─────────────────────────────────────────────────────────────────

export interface NoteRow {
  id: string;
  title: string;
  /** Stringified TipTap JSON. */
  content: string;
  updated_at: number;
}

export type NotesSchema = { notes: NoteRow };

// ── Server wire types (mirrors Rust serialization) ─────────────────────────

interface ServerHlc {
  millis: number;
  counter: number;
  /** UUID string, e.g. "550e8400-e29b-41d4-a716-446655440000". */
  node_id: string;
}

interface InsertOp {
  op: "insert";
  table: string;
  row_id: string;
  data: Record<string, unknown>;
}

interface UpdateOp {
  op: "update";
  table: string;
  row_id: string;
  col: string;
  value: unknown;
}

interface DeleteOp {
  op: "delete";
  table: string;
  row_id: string;
}

type ServerOp = InsertOp | UpdateOp | DeleteOp;

interface ServerChange {
  id: string;
  hlc: ServerHlc;
  ops: ServerOp[];
}

/** Produce the lexicographic sort key used as a pagination cursor. */
function hlcSortKey(hlc: ServerHlc): string {
  const millis = hlc.millis.toString().padStart(20, "0");
  const counter = hlc.counter.toString().padStart(10, "0");
  const nodeId = hlc.node_id.replace(/-/g, "").padStart(32, "0");
  return `${millis}_${counter}_${nodeId}`;
}

// ── Engine ─────────────────────────────────────────────────────────────────

export class NotesEngine extends PalladiumEngine<NotesSchema> {
  readonly #mem: MemoryAdapter;
  readonly #serverUrl: string;
  /** UUID-formatted node identifier (read from URL `?node=` param). */
  readonly #nodeId: string;

  #cursor: string | null = null;
  /** True while applying remote changes — suppresses re-posting to server. */
  #applyingRemote = false;
  /** True once the initial full fetch from server has completed. */
  #initialLoadDone = false;
  /** Prevents concurrent polls from overlapping. */
  #polling = false;
  #pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(serverUrl: string, nodeId: string) {
    const mem = new MemoryAdapter();
    super(mem);
    this.#mem = mem;
    this.#serverUrl = serverUrl;
    this.#nodeId = nodeId;
  }

  override async init(): Promise<void> {
    // Hydrate local state from the server before the first render.
    await this.#poll();
    this.#pollHandle = setInterval(() => {
      void this.#poll();
    }, 1_000);
  }

  /** Stop the background sync loop (call before unmounting). */
  stopSync(): void {
    if (this.#pollHandle !== null) {
      clearInterval(this.#pollHandle);
      this.#pollHandle = null;
    }
  }

  // ── StorageAdapter hooks ─────────────────────────────────────────────────

  protected override _putRow(table: string, id: string, data: Record<string, unknown>): void {
    this.#mem._put(table, id, data);
    if (!this.#applyingRemote) {
      void this.#postChange([{ op: "insert", table, row_id: id, data }]);
    }
  }

  protected override _patchRow(table: string, id: string, patch: Record<string, unknown>): void {
    this.#mem._patch(table, id, patch);
    if (!this.#applyingRemote) {
      const ops: ServerOp[] = Object.entries(patch).map(([col, value]) => ({
        op: "update" as const,
        table,
        row_id: id,
        col,
        value,
      }));
      void this.#postChange(ops);
    }
  }

  protected override _removeRow(table: string, id: string): void {
    this.#mem._remove(table, id);
    if (!this.#applyingRemote) {
      void this.#postChange([{ op: "delete", table, row_id: id }]);
    }
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  async #postChange(ops: ServerOp[]): Promise<void> {
    const change: ServerChange = {
      id: crypto.randomUUID(),
      hlc: { millis: Date.now(), counter: 0, node_id: this.#nodeId },
      ops,
    };
    this.#setStatus("syncing");
    try {
      const res = await fetch(`${this.#serverUrl}/v1/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      this.#setStatus(res.ok ? "idle" : "error");
    } catch {
      this.#setStatus("offline");
    }
  }

  async #poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      const url = this.#cursor
        ? `${this.#serverUrl}/v1/changes?after=${this.#cursor}`
        : `${this.#serverUrl}/v1/changes`;

      let changes: ServerChange[];
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        changes = (await res.json()) as ServerChange[];
      } catch {
        return;
      }

      for (const change of changes) {
        // Always advance cursor — even for changes we will skip.
        this.#cursor = hlcSortKey(change.hlc);

        // After the initial full hydration, skip our own changes: we already
        // applied them locally and posting them again would be redundant.
        if (this.#initialLoadDone && change.hlc.node_id === this.#nodeId) {
          continue;
        }

        // Apply via the engine's public API so live queries are notified.
        this.#applyingRemote = true;
        try {
          await this.#applyOps(change.ops);
        } finally {
          this.#applyingRemote = false;
        }
      }

      this.#initialLoadDone = true;
    } finally {
      this.#polling = false;
    }
  }

  async #applyOps(ops: ServerOp[]): Promise<void> {
    for (const op of ops) {
      if (op.op === "insert" && op.table === "notes") {
        await this.insert("notes", {
          id: op.row_id,
          ...(op.data as Omit<NoteRow, "id">),
        });
      } else if (op.op === "update" && op.table === "notes") {
        await this.update("notes", op.row_id, {
          [op.col]: op.value,
        } as Partial<NoteRow>);
      } else if (op.op === "delete" && op.table === "notes") {
        await this.delete("notes", op.row_id);
      }
    }
  }

  #setStatus(s: SyncStatus): void {
    this.status = s;
    this.emitter.emit("sync:status", s);
  }
}
