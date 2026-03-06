import { describe, expect, it, vi } from "vitest";
import { LiveQuery } from "../live-query.js";
import type { StorageAdapter } from "../storage.js";

/** Minimal fake adapter that returns preset rows. */
function makeAdapter(rows: Record<string, unknown>[]): StorageAdapter {
  return {
    exec: vi.fn().mockResolvedValue(rows),
    runMigrations: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeQuery(tables: string[] = ["tasks"]) {
  return { text: "SELECT * FROM tasks", params: [] as unknown[], tables };
}

describe("LiveQuery", () => {
  it("exec() returns the query result", async () => {
    const adapter = makeAdapter([{ id: "1", name: "task" }]);
    const lq = new LiveQuery(makeQuery(), adapter);
    const rows = await lq.exec();
    expect(rows).toEqual([{ id: "1", name: "task" }]);
  });

  it("exec() passes sql text and params to adapter", async () => {
    const adapter = makeAdapter([]);
    const query = { text: "SELECT * FROM tasks WHERE id = ?", params: ["t1"], tables: ["tasks"] };
    const lq = new LiveQuery(query, adapter);
    await lq.exec();
    expect(adapter.exec).toHaveBeenCalledWith("SELECT * FROM tasks WHERE id = ?", ["t1"]);
  });

  it("on('change') fires when notifyTables is called for a watched table", async () => {
    const adapter = makeAdapter([{ id: "1" }]);
    const lq = new LiveQuery(makeQuery(), adapter);

    const cb = vi.fn();
    lq.on("change", cb);
    await lq.notifyTables(["tasks"]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("on('change') receives the fresh rows from the adapter", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const adapter = makeAdapter(rows);
    const lq = new LiveQuery(makeQuery(), adapter);

    const received: unknown[][] = [];
    lq.on("change", (r) => received.push(r));
    await lq.notifyTables(["tasks"]);

    expect(received[0]).toEqual(rows);
  });

  it("multiple listeners all receive change events", async () => {
    const adapter = makeAdapter([{ id: "1" }]);
    const lq = new LiveQuery(makeQuery(), adapter);

    const a = vi.fn();
    const b = vi.fn();
    lq.on("change", a);
    lq.on("change", b);
    await lq.notifyTables(["tasks"]);

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("on('change') does not fire for unrelated tables", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(makeQuery(), adapter);

    const cb = vi.fn();
    lq.on("change", cb);
    await lq.notifyTables(["users"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("notifyTables fires when any of the listed tables is watched", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(makeQuery(["tasks"]), adapter);

    const cb = vi.fn();
    lq.on("change", cb);
    await lq.notifyTables(["users", "tasks", "comments"]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("on() returns an unsubscribe function", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(makeQuery(), adapter);

    const cb = vi.fn();
    const unsub = lq.on("change", cb);
    unsub();
    await lq.notifyTables(["tasks"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("cancel() prevents future change notifications", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(makeQuery(), adapter);

    const cb = vi.fn();
    lq.on("change", cb);
    lq.cancel();
    await lq.notifyTables(["tasks"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("cancel() prevents refresh() from notifying", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(makeQuery(), adapter);

    const cb = vi.fn();
    lq.on("change", cb);
    lq.cancel();
    await lq.refresh();
    expect(cb).not.toHaveBeenCalled();
  });

  it("exec() still works after cancel()", async () => {
    const rows = [{ id: "1" }];
    const adapter = makeAdapter(rows);
    const lq = new LiveQuery(makeQuery(), adapter);
    lq.cancel();
    await expect(lq.exec()).resolves.toEqual(rows);
  });

  it("refresh() re-runs the query and emits change", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(makeQuery(), adapter);

    const cb = vi.fn();
    lq.on("change", cb);
    await lq.refresh();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("multiple notifyTables calls each trigger a separate change event", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(makeQuery(), adapter);

    const cb = vi.fn();
    lq.on("change", cb);
    await lq.notifyTables(["tasks"]);
    await lq.notifyTables(["tasks"]);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
