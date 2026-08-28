/**
 * Transaction builder — accumulates a list of write operations synchronously.
 *
 * Usage:
 * ```ts
 * await db.tx(t => {
 *   t.insert('tasks', { id: generateUuidV7(), name: 'hello', done: false });
 *   t.update('tasks', id, { done: true });
 *   t.delete('tasks', oldId);
 * });
 * ```
 *
 * The builder callback is synchronous; `db.tx()` flushes the ops asynchronously.
 */

import { isUuidV7 } from "./hlc.js";

/** A value that preserves its meaning through JSON serialisation. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A replicated row with an immutable UUIDv7 primary key. */
export type SyncRow = {
  readonly id: string;
  readonly [column: string]: JsonValue;
};

/** A row type keyed by table name. Every row must be sync-safe. */
export type SchemaMap = Record<string, SyncRow>;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonArrayIndex(key: string): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key;
}

function isJsonArray(value: object, ancestors: WeakSet<object>): boolean {
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.getOwnPropertyNames(value).some((key) => key !== "length" && !isJsonArrayIndex(key))
  ) {
    return false;
  }
  const array = value as unknown[];
  return (
    array.every((item) => visitJsonValue(item, ancestors)) &&
    array.length === Object.keys(array).length
  );
}

function isJsonObjectValue(value: object, ancestors: WeakSet<object>): boolean {
  if (!isJsonObject(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) =>
      descriptor.enumerable && "value" in descriptor && visitJsonValue(descriptor.value, ancestors),
  );
}

function visitJsonObject(value: object, ancestors: WeakSet<object>): boolean {
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? isJsonArray(value, ancestors)
      : isJsonObjectValue(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function visitJsonValue(candidate: unknown, ancestors: WeakSet<object>): boolean {
  if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
    return true;
  }
  if (typeof candidate === "number") {
    return Number.isFinite(candidate) && !Object.is(candidate, -0);
  }
  return typeof candidate === "object" && visitJsonObject(candidate, ancestors);
}

/**
 * Returns whether `value` can round-trip through JSON without losing values.
 *
 * Objects must be plain, enumerable data-property maps; arrays must not carry
 * non-index properties. Cycles and values JSON would coerce or omit are rejected.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  return visitJsonValue(value, new WeakSet<object>());
}

/** Returns whether `value` is a JSON-safe replicated row with a canonical UUIDv7 id. */
export function isSyncRow(value: unknown): value is SyncRow {
  return (
    isJsonObject(value) &&
    isJsonValue(value) &&
    typeof value["id"] === "string" &&
    isUuidV7(value["id"])
  );
}

function assertJsonValue(value: unknown, context: string): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new TypeError(`${context} must losslessly round-trip through JSON`);
  }
}

function assertUuidV7(id: unknown): asserts id is string {
  if (typeof id !== "string" || !isUuidV7(id)) {
    throw new TypeError("Row id must be a canonical UUIDv7");
  }
}

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
  readonly patch: Partial<Omit<S[K], "id">>;
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

  /** Queue an INSERT operation. The row must contain a canonical UUIDv7 `id`. */
  insert<K extends keyof S & string>(table: K, data: S[K]): this {
    assertJsonValue(data, "Inserted row");
    assertUuidV7(data.id);
    this.#ops.push({ type: "insert", table, id: data.id, data });
    return this;
  }

  /** Queue an UPDATE operation (partial patch without the immutable primary key). */
  update<K extends keyof S & string>(table: K, id: string, patch: Partial<Omit<S[K], "id">>): this {
    assertUuidV7(id);
    if (!isJsonObject(patch)) {
      throw new TypeError("Update patch must be a JSON object");
    }
    if (Object.hasOwn(patch, "id")) {
      throw new TypeError("Update patches must not contain the immutable primary key `id`");
    }
    assertJsonValue(patch, "Update patch");
    this.#ops.push({ type: "update", table, id, patch });
    return this;
  }

  /** Queue a DELETE operation by canonical UUIDv7 id. */
  delete<K extends keyof S & string>(table: K, id: string): this {
    assertUuidV7(id);
    this.#ops.push({ type: "delete", table, id });
    return this;
  }

  /** Return the accumulated list of operations. Safe to call multiple times. */
  build(): Op<S>[] {
    return [...this.#ops];
  }
}
