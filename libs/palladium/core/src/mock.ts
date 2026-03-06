/**
 * createMockEngine — in-memory engine for testing and local-only usage.
 *
 * ```ts
 * const db = createMockEngine<Schema>();
 * await db.init();
 * await db.insert('tasks', { id: ulid(), name: 'hello', done: false });
 * const rows = await db.exec<Task>(sql`SELECT * FROM tasks`);
 * ```
 */

import { PalladiumEngine } from "./engine.js";
import type { SyncStatus } from "./engine.js";
import { MemoryAdapter } from "./memory-adapter.js";
import type { SchemaMap } from "./tx.js";

class MockEngine<S extends SchemaMap> extends PalladiumEngine<S> {
  readonly #mem: MemoryAdapter;

  constructor() {
    const mem = new MemoryAdapter();
    super(mem);
    this.#mem = mem;
  }

  async init(): Promise<void> {
    // Nothing to open for the in-memory adapter.
  }

  protected _putRow(table: string, id: string, data: Record<string, unknown>): void {
    this.#mem._put(table, id, data);
  }

  protected _patchRow(table: string, id: string, patch: Record<string, unknown>): void {
    this.#mem._patch(table, id, patch);
  }

  protected _removeRow(table: string, id: string): void {
    this.#mem._remove(table, id);
  }

  /** Test helper: manually set sync status and emit the event. */
  _setStatus(s: SyncStatus): void {
    this.status = s;
    this.emitter.emit("sync:status", s);
  }
}

export function createMockEngine<S extends SchemaMap>(): MockEngine<S> {
  return new MockEngine<S>();
}
