import { describe, expect, it } from "vitest";
import { MemoryAdapter } from "../memory-adapter.js";

type Task = { id: string; name: string; done: boolean };
type Minimal = { id: string };

describe("MemoryAdapter", () => {
  it("_put then exec returns the row", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1", name: "hello", done: false });
    const rows = await adapter.exec<Task>("SELECT * FROM tasks");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "t1", name: "hello" });
  });

  it("_put stores a snapshot — mutations to the original object do not affect the store", async () => {
    const adapter = new MemoryAdapter();
    const row = { id: "t1", name: "original", done: false };
    adapter._put("tasks", "t1", row);
    row.name = "mutated";
    const rows = await adapter.exec<Task>("SELECT * FROM tasks");
    expect(rows[0]?.name).toBe("original");
  });

  it("_patch updates only the given fields", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1", name: "hello", done: false });
    adapter._patch("tasks", "t1", { done: true });
    const rows = await adapter.exec<Task>("SELECT * FROM tasks");
    expect(rows[0]?.done).toBe(true);
    expect(rows[0]?.name).toBe("hello");
  });

  it("_patch on non-existent row is a no-op", async () => {
    const adapter = new MemoryAdapter();
    expect(() => adapter._patch("tasks", "ghost", { done: true })).not.toThrow();
    const rows = await adapter.exec("SELECT * FROM tasks");
    expect(rows).toHaveLength(0);
  });

  it("_remove deletes the row", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1" });
    adapter._put("tasks", "t2", { id: "t2" });
    adapter._remove("tasks", "t1");
    const rows = await adapter.exec<Minimal>("SELECT * FROM tasks");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("t2");
  });

  it("_remove on non-existent row is a no-op", async () => {
    const adapter = new MemoryAdapter();
    expect(() => adapter._remove("tasks", "ghost")).not.toThrow();
  });

  it("exec on unknown table returns empty array", async () => {
    const adapter = new MemoryAdapter();
    const rows = await adapter.exec("SELECT * FROM nonexistent");
    expect(rows).toEqual([]);
  });

  it("exec returns all rows when no WHERE clause", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1" });
    adapter._put("tasks", "t2", { id: "t2" });
    adapter._put("tasks", "t3", { id: "t3" });
    const rows = await adapter.exec("SELECT * FROM tasks");
    expect(rows).toHaveLength(3);
  });

  it("exec WHERE id = ? filters to a single row", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1", name: "A" });
    adapter._put("tasks", "t2", { id: "t2", name: "B" });
    const rows = await adapter.exec<Minimal>("SELECT * FROM tasks WHERE id = ?", ["t1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("t1");
  });

  it("exec WHERE id = ? with no match returns empty array", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1" });
    const rows = await adapter.exec("SELECT * FROM tasks WHERE id = ?", ["nope"]);
    expect(rows).toHaveLength(0);
  });

  it("multiple tables are stored independently", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1" });
    adapter._put("users", "u1", { id: "u1" });
    const tasks = await adapter.exec<Minimal>("SELECT * FROM tasks");
    const users = await adapter.exec<Minimal>("SELECT * FROM users");
    expect(tasks).toHaveLength(1);
    expect(users).toHaveLength(1);
    expect(tasks[0]?.id).toBe("t1");
    expect(users[0]?.id).toBe("u1");
  });

  it("_put overwrites a row with the same id", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1", name: "old" });
    adapter._put("tasks", "t1", { id: "t1", name: "new" });
    const rows = await adapter.exec<Task>("SELECT * FROM tasks");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("new");
  });

  it("runMigrations resolves without error", async () => {
    const adapter = new MemoryAdapter();
    await expect(adapter.runMigrations(["CREATE TABLE t (id TEXT)"])).resolves.toBeUndefined();
  });

  it("close() clears all stored data", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1" });
    await adapter.close();
    const rows = await adapter.exec("SELECT * FROM tasks");
    expect(rows).toHaveLength(0);
  });

  it("handles backtick-quoted table names from Kysely", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1", name: "hello" });
    const rows = await adapter.exec("select * from `tasks`");
    expect(rows).toHaveLength(1);
  });

  it("handles backtick-quoted id column in WHERE from Kysely", async () => {
    const adapter = new MemoryAdapter();
    adapter._put("tasks", "t1", { id: "t1" });
    adapter._put("tasks", "t2", { id: "t2" });
    const rows = await adapter.exec<Minimal>("select * from `tasks` where `id` = ?", ["t1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("t1");
  });
});
