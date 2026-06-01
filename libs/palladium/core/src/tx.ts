/**
 * Transaction builder — accumulates a list of write operations synchronously.
 *
 * Usage:
 * ```ts
 * await db.tx(t => {
 *   t.insert('tasks', { id: ulid(), name: 'hello', done: false });
 *   t.update('tasks', id, { done: true });
 *   t.delete('tasks', oldId);
 * });
 * ```
 *
 * The builder callback is synchronous; `db.tx()` flushes the ops asynchronously.
 */

/** A row type keyed by table name. Each value is a row type (plain object). */
export type SchemaMap = Record<string, Record<string, unknown>>;

export type InsertOp<S extends SchemaMap, K extends keyof S & string> = {
  readonly type: "insert";
  readonly table: K;
  readonly id: string;
  readonly data: S[K];
};

export type UpdateOp<S extends SchemaMap, K extends keyof S & string> = {
  readonly type: "update";
  readonly table: K;
  readonly id: string;
  readonly patch: Partial<S[K]>;
};

export type DeleteOp<S extends SchemaMap, K extends keyof S & string> = {
  readonly type: "delete";
  readonly table: K;
  readonly id: string;
};

export type Op<S extends SchemaMap = SchemaMap, K extends keyof S & string = keyof S & string> =
  | InsertOp<S, K>
  | UpdateOp<S, K>
  | DeleteOp<S, K>;

export class TxBuilder<S extends SchemaMap> {
  readonly #ops: Op<S>[] = [];

  /** Queue an INSERT operation. The row must contain an `id` field. */
  insert<K extends keyof S & string>(table: K, data: S[K]): this {
    this.#ops.push({ type: "insert", table, id: (data as unknown as { id: string }).id, data });
    return this;
  }

  /** Queue an UPDATE operation (partial patch). */
  update<K extends keyof S & string>(table: K, id: string, patch: Partial<S[K]>): this {
    this.#ops.push({ type: "update", table, id, patch });
    return this;
  }

  /** Queue a DELETE operation by id. */
  delete<K extends keyof S & string>(table: K, id: string): this {
    this.#ops.push({ type: "delete", table, id });
    return this;
  }

  /** Return the accumulated list of operations. Safe to call multiple times. */
  build(): Op<S>[] {
    return [...this.#ops];
  }
}
