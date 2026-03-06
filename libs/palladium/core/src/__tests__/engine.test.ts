import { describe, expect, it, vi } from "vitest";
import { createMockEngine } from "../mock.js";
import { sql } from "../sql.js";

interface Schema {
  tasks: { id: string; name: string; done: boolean };
}

describe("createMockEngine", () => {
  it("initialises without throwing", async () => {
    const db = createMockEngine<Schema>();
    await expect(db.init()).resolves.toBeUndefined();
  });

  it("insert + query round-trip", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "hello", done: false });
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "t1", name: "hello", done: false });
  });

  it("update changes stored row", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "hello", done: false });
    });
    await db.tx((t) => {
      t.update("tasks", "t1", { done: true });
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks WHERE id = ${"t1"}`);
    expect(rows[0]?.done).toBe(true);
  });

  it("delete removes the row", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "A", done: false });
      t.insert("tasks", { id: "t2", name: "B", done: false });
    });
    await db.tx((t) => {
      t.delete("tasks", "t1");
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("t2");
  });

  it("liveQuery emits change on write to watched table", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    lq.on("change", cb);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "x", done: false });
    });

    expect(cb).toHaveBeenCalledOnce();
  });

  it("getSyncStatus returns idle initially", async () => {
    const db = createMockEngine<Schema>();
    await db.init();
    expect(db.getSyncStatus()).toBe("idle");
  });

  it("on('sync:status') fires when status changes", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const cb = vi.fn();
    db.on("sync:status", cb);
    db._setStatus("syncing"); // test helper
    expect(cb).toHaveBeenCalledWith("syncing");
  });

  it("shorthand insert/update/delete work", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    await db.insert("tasks", { id: "t1", name: "hi", done: false });
    await db.update("tasks", "t1", { done: true });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows[0]?.done).toBe(true);

    await db.delete("tasks", "t1");
    const after = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(after).toHaveLength(0);
  });
});
