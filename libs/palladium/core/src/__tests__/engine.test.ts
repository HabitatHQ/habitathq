import { describe, expect, it, vi } from "vitest";
import { createMockEngine } from "../mock.js";
import { sql } from "../sql.js";

// SQLite stores booleans as integers; schema done field is INTEGER.
interface Schema {
  tasks: { id: string; name: string; done: number };
  comments: { id: string; body: string };
}

const MIGRATIONS = [
  "CREATE TABLE tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
  "CREATE TABLE comments (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
];

function makeDb() {
  return createMockEngine<Schema>(MIGRATIONS);
}

describe("createMockEngine (SQLite)", () => {
  it("initialises without throwing", async () => {
    const db = makeDb();
    await expect(db.init()).resolves.toBeUndefined();
  });

  it("insert + query round-trip", async () => {
    const db = makeDb();
    await db.init();

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "hello", done: 0 });
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "t1", name: "hello", done: 0 });
  });

  it("update changes stored row", async () => {
    const db = makeDb();
    await db.init();

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "hello", done: 0 });
    });
    await db.tx((t) => {
      t.update("tasks", "t1", { done: 1 });
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks WHERE id = ${"t1"}`);
    expect(rows[0]?.done).toBe(1);
  });

  it("delete removes the row", async () => {
    const db = makeDb();
    await db.init();

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "A", done: 0 });
      t.insert("tasks", { id: "t2", name: "B", done: 0 });
    });
    await db.tx((t) => {
      t.delete("tasks", "t1");
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("t2");
  });

  it("liveQuery emits change on write to watched table", async () => {
    const db = makeDb();
    await db.init();

    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    lq.on("change", cb);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "x", done: 0 });
    });

    expect(cb).toHaveBeenCalledOnce();
  });

  it("liveQuery delivers updated rows to the callback", async () => {
    const db = makeDb();
    await db.init();

    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const received: Schema["tasks"][][] = [];
    lq.on("change", (rows) => received.push(rows));

    await db.insert("tasks", { id: "t1", name: "hello", done: 0 });

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    expect(received[0]?.[0]).toMatchObject({ id: "t1" });
  });

  it("liveQuery does not fire for writes to an unrelated table", async () => {
    const db = makeDb();
    await db.init();

    const taskQuery = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    taskQuery.on("change", cb);

    await db.insert("comments", { id: "c1", body: "hello" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("multiple live queries each fire independently", async () => {
    const db = makeDb();
    await db.init();

    const lq1 = db.liveQuery(sql`SELECT * FROM tasks`);
    const lq2 = db.liveQuery(sql`SELECT * FROM tasks`);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    lq1.on("change", cb1);
    lq2.on("change", cb2);

    await db.insert("tasks", { id: "t1", name: "x", done: 0 });

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("tx touching multiple tables notifies queries on each table", async () => {
    const db = makeDb();
    await db.init();

    const taskCb = vi.fn();
    const commentCb = vi.fn();
    db.liveQuery(sql`SELECT * FROM tasks`).on("change", taskCb);
    db.liveQuery(sql`SELECT * FROM comments`).on("change", commentCb);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "a", done: 0 });
      t.insert("comments", { id: "c1", body: "b" });
    });

    expect(taskCb).toHaveBeenCalledOnce();
    expect(commentCb).toHaveBeenCalledOnce();
  });

  it("cancelled liveQuery no longer fires after cancel()", async () => {
    const db = makeDb();
    await db.init();

    const lq = db.liveQuery(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    lq.on("change", cb);
    lq.cancel();

    await db.insert("tasks", { id: "t1", name: "x", done: 0 });

    expect(cb).not.toHaveBeenCalled();
  });

  it("cancel() deregisters the LiveQuery from the engine", async () => {
    const db = makeDb();
    await db.init();

    const lq = db.liveQuery(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    lq.on("change", cb);
    lq.cancel();

    // After cancel, even a direct notifyTables should not call the listener
    await db.insert("tasks", { id: "t1", name: "x", done: 0 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("getSyncStatus returns idle initially", async () => {
    const db = makeDb();
    await db.init();
    expect(db.getSyncStatus()).toBe("idle");
  });

  it("getSyncStatus reflects the value set by _setStatus", async () => {
    const db = makeDb();
    await db.init();
    db._setStatus("syncing");
    expect(db.getSyncStatus()).toBe("syncing");
    db._setStatus("idle");
    expect(db.getSyncStatus()).toBe("idle");
  });

  it("on('sync:status') fires when status changes", async () => {
    const db = makeDb();
    await db.init();

    const cb = vi.fn();
    db.on("sync:status", cb);
    db._setStatus("syncing");
    expect(cb).toHaveBeenCalledWith("syncing");
  });

  it("on('sync:status') unsubscribe stops further events", async () => {
    const db = makeDb();
    await db.init();

    const cb = vi.fn();
    const unsub = db.on("sync:status", cb);
    unsub();
    db._setStatus("syncing");
    expect(cb).not.toHaveBeenCalled();
  });

  it("shorthand insert/update/delete work", async () => {
    const db = makeDb();
    await db.init();

    await db.insert("tasks", { id: "t1", name: "hi", done: 0 });
    await db.update("tasks", "t1", { done: 1 });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows[0]?.done).toBe(1);

    await db.delete("tasks", "t1");
    const after = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(after).toHaveLength(0);
  });

  it("exec() with parameterised WHERE returns only matching row", async () => {
    const db = makeDb();
    await db.init();

    await db.insert("tasks", { id: "t1", name: "A", done: 0 });
    await db.insert("tasks", { id: "t2", name: "B", done: 0 });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks WHERE id = ${"t2"}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("t2");
  });
});
