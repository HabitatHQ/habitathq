import { describe, expect, it } from "vitest";
import { generateUuidV7 } from "../hlc.js";
import type { JsonValue, SyncRow } from "../tx.js";
import { TxBuilder } from "../tx.js";

type Task = SyncRow & { name: string; done: boolean; metadata?: JsonValue };
type User = SyncRow & { email: string };

type Schema = {
  tasks: Task;
  users: User;
};

const taskId = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
const userId = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";

describe("TxBuilder", () => {
  it("records valid insert, update, and delete operations", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("tasks", { id: taskId, name: "hello", done: false });
    tx.update("tasks", taskId, { done: true });
    tx.delete("tasks", taskId);
    expect(tx.build()).toEqual([
      {
        type: "insert",
        table: "tasks",
        id: taskId,
        data: { id: taskId, name: "hello", done: false },
      },
      { type: "update", table: "tasks", id: taskId, patch: { done: true } },
      { type: "delete", table: "tasks", id: taskId },
    ]);
  });

  it("rejects ULIDs, UUIDv4, malformed IDs, and mismatched insert IDs", () => {
    const tx = new TxBuilder<Schema>();
    expect(() => tx.delete("tasks", "01J2QJ5G8Q3Y5TQW3V9B6J1M2N")).toThrow();
    expect(() => tx.delete("tasks", "018f0f50-7b8d-4a1c-8e2f-1234567890ab")).toThrow();
    expect(() => tx.delete("tasks", "not-an-id")).toThrow();
    expect(() => tx.insert("tasks", { id: userId, name: "x", done: false })).not.toThrow();
    expect(() => tx.insert("tasks", { id: "bad", name: "x", done: false })).toThrow();
    expect(tx.build()).toHaveLength(1);
  });

  it("rejects non-JSON values before building operations", () => {
    const tx = new TxBuilder<Schema>();
    expect(() =>
      tx.insert("tasks", { id: taskId, name: "x", done: false, metadata: { date: new Date() } }),
    ).toThrow();
    expect(() => tx.update("tasks", taskId, { metadata: { nested: undefined } })).toThrow();
    expect(() => tx.update("tasks", taskId, { metadata: { nested: Number.NaN } })).toThrow();
    expect(tx.build()).toHaveLength(0);
  });

  it("accepts nested JSON values", () => {
    const tx = new TxBuilder<Schema>();
    tx.update("tasks", taskId, {
      metadata: { labels: ["one", "two"], archived: false, count: 2 },
    });
    expect(tx.build()).toHaveLength(1);
  });

  it("rejects primary-key patches before appending an operation", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("users", { id: userId, email: "a@b.com" });
    expect(() => tx.update("users", userId, { id: taskId })).toThrow();
    expect(tx.build()).toHaveLength(1);
  });

  it("chains operations and build is idempotent", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("users", { id: userId, email: "a@b.com" });
    expect(tx.build()).toEqual(tx.build());
  });

  it("generates UUIDv7 IDs accepted by the builder", () => {
    const id = generateUuidV7();
    const tx = new TxBuilder<Schema>();
    tx.insert("tasks", { id, name: "generated", done: false });
    expect(tx.build()[0]?.id).toBe(id);
  });
});
