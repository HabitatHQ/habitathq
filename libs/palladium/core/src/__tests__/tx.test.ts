import { describe, expect, it } from "vitest";
import { TxBuilder } from "../tx.js";

interface Schema {
  tasks: { id: string; name: string; done: boolean };
  users: { id: string; email: string };
}

describe("TxBuilder", () => {
  it("records an insert op", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("tasks", { id: "t1", name: "hello", done: false });
    const ops = tx.build();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      type: "insert",
      table: "tasks",
      id: "t1",
      data: { id: "t1", name: "hello", done: false },
    });
  });

  it("records an update op", () => {
    const tx = new TxBuilder<Schema>();
    tx.update("tasks", "t1", { done: true });
    const ops = tx.build();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ type: "update", table: "tasks", id: "t1", patch: { done: true } });
  });

  it("records a delete op", () => {
    const tx = new TxBuilder<Schema>();
    tx.delete("tasks", "t1");
    const ops = tx.build();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ type: "delete", table: "tasks", id: "t1" });
  });

  it("empty builder produces no ops", () => {
    const tx = new TxBuilder<Schema>();
    expect(tx.build()).toHaveLength(0);
  });

  it("chains multiple ops preserving order", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("users", { id: "u1", email: "a@b.com" });
    tx.insert("tasks", { id: "t1", name: "Buy milk", done: false });
    tx.update("tasks", "t1", { done: true });
    tx.delete("users", "u1");
    const ops = tx.build();
    expect(ops).toHaveLength(4);
    expect(ops.map((o) => o.type)).toEqual(["insert", "insert", "update", "delete"]);
  });

  it("ops span multiple tables", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("users", { id: "u1", email: "x@y.com" });
    tx.insert("tasks", { id: "t1", name: "hi", done: false });
    const tables = tx.build().map((o) => o.table);
    expect(tables).toContain("users");
    expect(tables).toContain("tasks");
  });

  it("build() is idempotent — multiple calls return same ops", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("tasks", { id: "t1", name: "hi", done: false });
    expect(tx.build()).toEqual(tx.build());
  });

  it("fluent chaining returns the same builder instance", () => {
    const tx = new TxBuilder<Schema>();
    const result = tx.insert("tasks", { id: "t1", name: "a", done: false });
    expect(result).toBe(tx);
  });

  it("update op records only the partial patch fields", () => {
    const tx = new TxBuilder<Schema>();
    tx.update("tasks", "t1", { done: true });
    const op = tx.build()[0];
    expect(op).toMatchObject({ type: "update", patch: { done: true } });
    // patch should only contain what was passed
    if (op?.type === "update") {
      expect(Object.keys(op.patch)).toEqual(["done"]);
    }
  });
});
