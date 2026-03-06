import { MemoryAdapter, PalladiumEngine, generateUlid } from "@palladium/core";

export type TodoRow = { id: string; text: string; done: number };
export type TodoSchema = { tasks: TodoRow };

class TodoEngine extends PalladiumEngine<TodoSchema> {
  readonly #mem: MemoryAdapter;

  constructor() {
    const mem = new MemoryAdapter();
    super(mem);
    this.#mem = mem;
  }

  async init(): Promise<void> {
    // MemoryAdapter needs no migrations — schema is inferred from writes.
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
}

export const db = new TodoEngine();
export { generateUlid };
