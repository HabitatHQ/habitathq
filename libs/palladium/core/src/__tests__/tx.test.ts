import { describe, expect, it } from "vitest";
import { TxBuilder } from "../tx.js";
import type { Op } from "../tx.js";

interface Schema {
  tasks: { id: string; name: string; done: boolean };
  users: { id: string; email: string };
}

describe("TxBuilder", () => {
  it("records an insert op", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("tasks", { id: "t1", name: "hello", done: false });
    const ops: Op[] = tx.build();
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

  it("chains multiple ops", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("users", { id: "u1", email: "a@b.com" });
    tx.insert("tasks", { id: "t1", name: "Buy milk", done: false });
    tx.update("tasks", "t1", { done: true });
    tx.delete("users", "u1");
    const ops = tx.build();
    expect(ops).toHaveLength(4);
    expect(ops.map((o) => o.type)).toEqual(["insert", "insert", "update", "delete"]);
  });

  it("build() is idempotent — multiple calls return same ops", () => {
    const tx = new TxBuilder<Schema>();
    tx.insert("tasks", { id: "t1", name: "hi", done: false });
    expect(tx.build()).toEqual(tx.build());
  });
});
