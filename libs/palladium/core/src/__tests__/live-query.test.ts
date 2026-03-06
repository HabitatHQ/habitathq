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

describe("LiveQuery", () => {
  it("exec() returns the query result", async () => {
    const adapter = makeAdapter([{ id: "1", name: "task" }]);
    const lq = new LiveQuery(
      { text: "SELECT * FROM tasks", params: [], tables: ["tasks"] },
      adapter,
    );
    const rows = await lq.exec();
    expect(rows).toEqual([{ id: "1", name: "task" }]);
  });

  it("on('change') fires when notifyTables is called for a watched table", async () => {
    const adapter = makeAdapter([{ id: "1" }]);
    const lq = new LiveQuery(
      { text: "SELECT * FROM tasks", params: [], tables: ["tasks"] },
      adapter,
    );

    const cb = vi.fn();
    lq.on("change", cb);
    await lq.notifyTables(["tasks"]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("on('change') does not fire for unrelated tables", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(
      { text: "SELECT * FROM tasks", params: [], tables: ["tasks"] },
      adapter,
    );

    const cb = vi.fn();
    lq.on("change", cb);
    await lq.notifyTables(["users"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("on() returns an unsubscribe function", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(
      { text: "SELECT * FROM tasks", params: [], tables: ["tasks"] },
      adapter,
    );

    const cb = vi.fn();
    const unsub = lq.on("change", cb);
    unsub();
    await lq.notifyTables(["tasks"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("cancel() prevents future change notifications", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(
      { text: "SELECT * FROM tasks", params: [], tables: ["tasks"] },
      adapter,
    );

    const cb = vi.fn();
    lq.on("change", cb);
    lq.cancel();
    await lq.notifyTables(["tasks"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("refresh() re-runs the query and emits change", async () => {
    const adapter = makeAdapter([]);
    const lq = new LiveQuery(
      { text: "SELECT * FROM tasks", params: [], tables: ["tasks"] },
      adapter,
    );

    const cb = vi.fn();
    lq.on("change", cb);
    await lq.refresh();
    expect(cb).toHaveBeenCalledOnce();
  });
});
