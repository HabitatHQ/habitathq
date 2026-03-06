import { describe, expect, it, vi } from "vitest";
import { createMockEngine } from "../mock.js";
import { sql } from "../sql.js";

interface Schema {
  tasks: { id: string; name: string; done: boolean };
  comments: { id: string; body: string };
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

  it("liveQuery delivers updated rows to the callback", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const received: Schema["tasks"][][] = [];
    lq.on("change", (rows) => received.push(rows));

    await db.insert("tasks", { id: "t1", name: "hello", done: false });

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    expect(received[0]?.[0]).toMatchObject({ id: "t1" });
  });

  it("liveQuery does not fire for writes to an unrelated table", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const taskQuery = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    taskQuery.on("change", cb);

    await db.insert("comments", { id: "c1", body: "hello" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("multiple live queries each fire independently", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const lq1 = db.liveQuery(sql`SELECT * FROM tasks`);
    const lq2 = db.liveQuery(sql`SELECT * FROM tasks`);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    lq1.on("change", cb1);
    lq2.on("change", cb2);

    await db.insert("tasks", { id: "t1", name: "x", done: false });

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("tx touching multiple tables notifies queries on each table", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const taskCb = vi.fn();
    const commentCb = vi.fn();
    db.liveQuery(sql`SELECT * FROM tasks`).on("change", taskCb);
    db.liveQuery(sql`SELECT * FROM comments`).on("change", commentCb);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "a", done: false });
      t.insert("comments", { id: "c1", body: "b" });
    });

    expect(taskCb).toHaveBeenCalledOnce();
    expect(commentCb).toHaveBeenCalledOnce();
  });

  it("cancelled liveQuery no longer fires after cancel()", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const lq = db.liveQuery(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    lq.on("change", cb);
    lq.cancel();

    await db.insert("tasks", { id: "t1", name: "x", done: false });

    expect(cb).not.toHaveBeenCalled();
  });

  it("getSyncStatus returns idle initially", async () => {
    const db = createMockEngine<Schema>();
    await db.init();
    expect(db.getSyncStatus()).toBe("idle");
  });

  it("getSyncStatus reflects the value set by _setStatus", async () => {
    const db = createMockEngine<Schema>();
    await db.init();
    db._setStatus("syncing");
    expect(db.getSyncStatus()).toBe("syncing");
    db._setStatus("idle");
    expect(db.getSyncStatus()).toBe("idle");
  });

  it("on('sync:status') fires when status changes", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const cb = vi.fn();
    db.on("sync:status", cb);
    db._setStatus("syncing");
    expect(cb).toHaveBeenCalledWith("syncing");
  });

  it("on('sync:status') unsubscribe stops further events", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    const cb = vi.fn();
    const unsub = db.on("sync:status", cb);
    unsub();
    db._setStatus("syncing");
    expect(cb).not.toHaveBeenCalled();
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

  it("exec() with parameterised WHERE returns only matching row", async () => {
    const db = createMockEngine<Schema>();
    await db.init();

    await db.insert("tasks", { id: "t1", name: "A", done: false });
    await db.insert("tasks", { id: "t2", name: "B", done: false });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks WHERE id = ${"t2"}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("t2");
  });
});
