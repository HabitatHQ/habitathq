/**
 * NotesEngine — PalladiumEngine subclass that syncs notes to/from the
 * Palladium REST backend while keeping local state in a BrowserSqliteAdapter.
 *
 * Sync protocol
 * ─────────────
 * • Local mutations (_putRow / _patchRow / _removeRow) are immediately
 *   written to SQLite AND fire-and-forget POSTed to the server.
 * • A 1-second poll fetches changes produced by OTHER nodes (cursor-based
 *   pagination) and applies them via the engine's public insert/update/delete
 *   so that live queries are notified.
 * • On init(), a full fetch (no cursor) hydrates the local store from the
 *   server before the first render — own past changes are included so that
 *   the state survives page reloads.
 */

import type { Hlc, StorageAdapter } from "@palladium/core";
import { PalladiumEngine } from "@palladium/core";
import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";

// ── Schema ─────────────────────────────────────────────────────────────────

export interface NoteRow {
  id: string;
  title: string;
  /** Stringified TipTap JSON. */
  content: string;
  updated_at: number;
}

export type NotesSchema = { notes: NoteRow };

const SCHEMA = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

// ── Server wire types (mirrors Rust serialization) ─────────────────────────
//
// The Hlc wire shape matches `@palladium/core`'s `Hlc` exactly because the
// Rust side uses `#[serde(rename = ...)]` to project to camelCase
// (`wallMs`, `counter`, `nodeId`). No bridge type needed.

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
  hlc: Hlc;
  ops: ServerOp[];
}

/** Produce the lexicographic sort key used as a pagination cursor. */
function hlcSortKey(hlc: Hlc): string {
  const wallMs = hlc.wallMs.toString().padStart(20, "0");
  const counter = hlc.counter.toString().padStart(10, "0");
  const nodeId = hlc.nodeId.replace(/-/g, "").padStart(32, "0");
  return `${wallMs}_${counter}_${nodeId}`;
}

// ── Engine ─────────────────────────────────────────────────────────────────

export class NotesEngine extends PalladiumEngine<NotesSchema> {
  readonly #serverUrl: string;

  #cursor: string | null = null;
  /** True while applying remote changes — suppresses re-posting to server. */
  #applyingRemote = false;
  /** True once the initial full fetch from server has completed. */
  #initialLoadDone = false;
  /** Prevents concurrent polls from overlapping. */
  #polling = false;
  #pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(serverUrl: string, nodeId: string) {
    super(new BrowserSqliteAdapter({ vfs: { type: "memory" } }), { nodeId });
    this.#serverUrl = serverUrl;
  }

  override async init(): Promise<void> {
    await super.init(SCHEMA); // opens adapter, runs the notes-table migration
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

  protected override async _putRow(
    adpt: StorageAdapter,
    table: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await super._putRow(adpt, table, id, data);
    if (!this.#applyingRemote) {
      void this.#postChange([{ op: "insert", table, row_id: id, data }]);
    }
  }

  protected override async _patchRow(
    adpt: StorageAdapter,
    table: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await super._patchRow(adpt, table, id, patch);
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

  protected override async _removeRow(
    adpt: StorageAdapter,
    table: string,
    id: string,
  ): Promise<void> {
    await super._removeRow(adpt, table, id);
    if (!this.#applyingRemote) {
      void this.#postChange([{ op: "delete", table, row_id: id }]);
    }
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  async #postChange(ops: ServerOp[]): Promise<void> {
    const change: ServerChange = {
      id: crypto.randomUUID(),
      hlc: this.nextSendHlc(),
      ops,
    };
    this.setStatus("syncing");
    try {
      const res = await fetch(`${this.#serverUrl}/v1/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      this.setStatus(res.ok ? "idle" : "error");
    } catch {
      this.setStatus("offline");
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
        if (this.#initialLoadDone && change.hlc.nodeId === this.nodeId) {
          // Skip our own changes once initial hydration is complete.
          continue;
        }

        // Apply the remote HLC so future local sends are causally later than it.
        this.receiveHlc(change.hlc);

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
}
