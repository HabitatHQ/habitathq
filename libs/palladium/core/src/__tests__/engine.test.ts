import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it, vi } from "vitest";
import { createEngine, PalladiumEngine, type RemoteChange } from "../engine.js";
import { compareHlc, createHlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";
import type { StorageAdapter } from "../storage.js";

// SQLite stores booleans as integers; schema done field is INTEGER.
type Schema = {
  tasks: { id: string; name: string; done: number };
  comments: { id: string; body: string };
};

const SCHEMA: SchemaConfig = {
  schema: [
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
  ].join(";\n"),
  version: 1,
};

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
}

class NonTransactableStorageAdapter implements StorageAdapter {
  readonly #inner = new NodeSqliteAdapter({ vfs: { type: "memory" } });

  open(): Promise<void> {
    return this.#inner.open();
  }

  exec<T = Record<string, unknown>>(statement: string, params?: readonly unknown[]): Promise<T[]> {
    return this.#inner.exec<T>(statement, params);
  }

  put(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    return this.#inner.put(table, id, data);
  }

  patch(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
    return this.#inner.patch(table, id, patch);
  }

  remove(table: string, id: string): Promise<void> {
    return this.#inner.remove(table, id);
  }

  runMigrations(migrations: readonly string[]): Promise<void> {
    return this.#inner.runMigrations(migrations);
  }

  close(): Promise<void> {
    return this.#inner.close();
  }
}

describe("createEngine (SQLite)", () => {
  it("initialises without throwing", async () => {
    const db = makeDb();
    await expect(db.init(SCHEMA)).resolves.toBeUndefined();
  });

  it("init without schema just opens the adapter", async () => {
    const db = makeDb();
    await expect(db.init()).resolves.toBeUndefined();
  });

  it("insert + query round-trip", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "hello", done: 0 });
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "t1", name: "hello", done: 0 });
  });

  it("update changes stored row", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

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
    await db.init(SCHEMA);

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
    await db.init(SCHEMA);

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
    await db.init(SCHEMA);

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
    await db.init(SCHEMA);

    const taskQuery = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    taskQuery.on("change", cb);

    await db.insert("comments", { id: "c1", body: "hello" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("multiple live queries each fire independently", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

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
    await db.init(SCHEMA);

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
    await db.init(SCHEMA);

    const lq = db.liveQuery(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    lq.on("change", cb);
    lq.cancel();

    await db.insert("tasks", { id: "t1", name: "x", done: 0 });

    expect(cb).not.toHaveBeenCalled();
  });

  it("cancel() deregisters the LiveQuery from the engine", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

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
    await db.init(SCHEMA);
    expect(db.getSyncStatus()).toBe("idle");
  });

  it("getSyncStatus reflects the value set by setStatus", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    db.setStatus("syncing");
    expect(db.getSyncStatus()).toBe("syncing");
    db.setStatus("idle");
    expect(db.getSyncStatus()).toBe("idle");
  });

  it("on('sync:status') fires when status changes", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const cb = vi.fn();
    db.on("sync:status", cb);
    db.setStatus("syncing");
    expect(cb).toHaveBeenCalledWith("syncing");
  });

  it("on('sync:status') unsubscribe stops further events", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const cb = vi.fn();
    const unsub = db.on("sync:status", cb);
    unsub();
    db.setStatus("syncing");
    expect(cb).not.toHaveBeenCalled();
  });

  it("shorthand insert/update/delete work", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

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
    await db.init(SCHEMA);

    await db.insert("tasks", { id: "t1", name: "A", done: 0 });
    await db.insert("tasks", { id: "t2", name: "B", done: 0 });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks WHERE id = ${"t2"}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("t2");
  });

  it("tx wraps in a transaction (adapter is transactable)", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    // Insert two rows in one tx — both should appear atomically.
    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "a", done: 0 });
      t.insert("tasks", { id: "t2", name: "b", done: 0 });
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(2);
  });

  it("rejects writes when the adapter cannot guarantee atomicity", async () => {
    const db = createEngine<Schema>(new NonTransactableStorageAdapter());
    await db.init(SCHEMA);

    await expect(
      db.tx((t) => {
        t.insert("tasks", { id: "t1", name: "local", done: 0 });
        t.insert("comments", { id: "c1", body: "local" });
      }),
    ).rejects.toThrow("PalladiumEngine writes require transaction support");

    await expect(
      db.applyRemote({
        hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: "remote" },
        ops: [
          {
            type: "insert",
            table: "tasks",
            id: "t2",
            data: { id: "t2", name: "remote", done: 0 },
          },
          {
            type: "insert",
            table: "comments",
            id: "c2",
            data: { id: "c2", body: "remote" },
          },
        ],
      }),
    ).rejects.toThrow("PalladiumEngine writes require transaction support");

    expect(await db.exec(sql`SELECT * FROM tasks`)).toHaveLength(0);
    expect(await db.exec(sql`SELECT * FROM comments`)).toHaveLength(0);
  });

  it("init with schema config runs DDL and seeds", async () => {
    const db = makeDb();
    await db.init({
      ...SCHEMA,
      seeds: [
        {
          key: "test-seed",
          apply: async (exec) => {
            await exec("INSERT INTO tasks (id, name, done) VALUES ('s1', 'seeded', 0)");
          },
        },
      ],
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks WHERE id = ${"s1"}`);
    expect(rows[0]?.name).toBe("seeded");
  });
  it("rolls back local mutations when a checkpoint fails", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    db.registerLocalChangeCheckpoint(async () => {
      throw new Error("checkpoint failed");
    });

    await expect(db.insert("tasks", { id: "t1", name: "blocked", done: 0 })).rejects.toThrow(
      "checkpoint failed",
    );
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(0);
  });

  it("runs checkpoints before exposing a successful local commit", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.exec(
      sql`CREATE TABLE checkpoint (change_id TEXT PRIMARY KEY, op_count INTEGER NOT NULL)`,
    );
    let observed = false;
    let observedRows: Promise<Record<string, unknown>[]> | null = null;
    db.registerLocalChangeCheckpoint(async (change, adapter) => {
      await adapter.exec("INSERT INTO checkpoint (change_id, op_count) VALUES (?, ?)", [
        change.changeId,
        change.ops.length,
      ]);
    });
    db.on("changes:local", (change) => {
      observed = true;
      observedRows = db.exec(sql`SELECT * FROM checkpoint WHERE change_id = ${change.changeId}`);
    });

    await db.insert("tasks", { id: "t1", name: "durable", done: 0 });
    expect(observed).toBe(true);
    expect(observedRows).not.toBeNull();
    const checkpoints = await observedRows;
    expect(checkpoints).toHaveLength(1);
  });
});

describe("PalladiumEngine HLC stamping", () => {
  function makeTestEngine(nodeId?: string): PalladiumEngine<Schema> {
    return new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId,
    });
  }

  it("nodeId defaults to a fresh UUID when not provided", () => {
    const a = makeTestEngine();
    const b = makeTestEngine();
    expect(a.nodeId).not.toBe(b.nodeId);
    expect(a.nodeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("nodeId is preserved when provided", () => {
    const nodeId = "00000000-0000-0000-0000-0000000000aa";
    const db = makeTestEngine(nodeId);
    expect(db.nodeId).toBe(nodeId);
  });

  it("currentHlc starts as null until the first send/receive", () => {
    const db = makeTestEngine();
    expect(db.currentHlc).toBeNull();
  });

  it("nextSendHlc carries the engine's nodeId", () => {
    const nodeId = "00000000-0000-0000-0000-0000000000bb";
    const db = makeTestEngine(nodeId);
    const hlc = db.nextSendHlc();
    expect(hlc.nodeId).toBe(nodeId);
  });

  it("consecutive nextSendHlc calls in the same millisecond increment the counter", () => {
    const db = makeTestEngine();
    // Freeze Date.now so both calls land in the same ms.
    const fixed = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(fixed);
    try {
      const a = db.nextSendHlc();
      const b = db.nextSendHlc();
      expect(b.wallMs).toBe(a.wallMs);
      expect(b.counter).toBeGreaterThan(a.counter);
      expect(compareHlc(a, b)).toBeLessThan(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("nextSendHlc resets counter to 0 when wall-clock advances", () => {
    const db = makeTestEngine();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const a = db.nextSendHlc();
      now.mockReturnValue(1_700_000_000_500); // 500ms later
      const b = db.nextSendHlc();
      expect(b.wallMs).toBe(1_700_000_000_500);
      expect(b.counter).toBe(0);
      expect(compareHlc(a, b)).toBeLessThan(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("receiveHlc lifts currentHlc past a future remote HLC", () => {
    const db = makeTestEngine();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const remote = createHlc("ff000000-0000-0000-0000-000000000001");
      const future = { ...remote, wallMs: remote.wallMs + 10_000, counter: 5 };
      db.receiveHlc(future);
      const next = db.nextSendHlc();
      // Strictly greater than the remote HLC we just saw.
      expect(compareHlc(next, future)).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("PalladiumEngine changes:local + applyRemote", () => {
  function makeDbWithSchema(nodeId?: string): PalladiumEngine<Schema> {
    return new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId,
    });
  }

  it("changes:local fires after a successful local tx with the original ops", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);

    const cb = vi.fn();
    db.on("changes:local", cb);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "a", done: 0 });
      t.insert("tasks", { id: "t2", name: "b", done: 0 });
    });

    expect(cb).toHaveBeenCalledOnce();
    const payload = cb.mock.calls[0]?.[0] as { ops: unknown[]; touchedTables: string[] };
    expect(payload.ops).toHaveLength(2);
    expect(payload.touchedTables).toEqual(["tasks"]);
  });

  it("changes:local does NOT fire when applyRemote applies ops", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);

    const cb = vi.fn();
    db.on("changes:local", cb);

    await db.applyRemote({
      hlc: {
        wallMs: 1_700_000_000_000,
        counter: 0,
        nodeId: "00000000-0000-0000-0000-0000000a11ce",
      },
      ops: [
        { type: "insert", table: "tasks", id: "t1", data: { id: "t1", name: "remote", done: 0 } },
      ],
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it("a local tx concurrent with applyRemote still emits changes:local (F21)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);

    const cb = vi.fn();
    db.on("changes:local", cb);

    // Fire a remote apply and a local write together. Serialisation must keep
    // the local write's emit from being swallowed by applyRemote's suppression
    // window — the bug this guards was a silently-dropped uplink.
    await Promise.all([
      db.applyRemote({
        hlc: {
          wallMs: 1_700_000_000_000,
          counter: 0,
          nodeId: "00000000-0000-0000-0000-0000000a11ce",
        },
        ops: [
          { type: "insert", table: "tasks", id: "r1", data: { id: "r1", name: "remote", done: 0 } },
        ],
      }),
      db.insert("tasks", { id: "l1", name: "local", done: 0 }),
    ]);

    // The local write emitted exactly once; the remote apply emitted nothing.
    expect(cb).toHaveBeenCalledTimes(1);
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT id FROM tasks ORDER BY id`);
    expect(rows.map((r) => r.id)).toEqual(["l1", "r1"]);
  });

  it("rejects a remote op whose table name is not a plain identifier (SQL-injection guard)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);

    // A malicious peer sends a table name crafted to break out of the query.
    const maliciousChange = {
      hlc: { wallMs: 1, counter: 0, nodeId: "00000000-0000-0000-0000-0000000a11ce" },
      ops: [
        {
          type: "insert",
          table: "tasks",
          id: "x",
          data: { id: "x", name: "n", done: 0 },
        },
      ],
    } satisfies RemoteChange<Schema>;
    Object.defineProperty(maliciousChange.ops[0], "table", {
      value: "tasks; DROP TABLE tasks; --",
    });

    await expect(db.applyRemote(maliciousChange)).rejects.toThrow(/invalid SQL identifier/);

    // The real table is untouched (the change never reached a query).
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT id FROM tasks`);
    expect(rows).toHaveLength(0);
  });

  it("applyRemote still notifies live queries on touched tables", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);

    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const lqCb = vi.fn();
    lq.on("change", lqCb);

    await db.applyRemote({
      hlc: {
        wallMs: 1_700_000_000_000,
        counter: 0,
        nodeId: "00000000-0000-0000-0000-0000000a11ce",
      },
      ops: [
        { type: "insert", table: "tasks", id: "t1", data: { id: "t1", name: "remote", done: 0 } },
      ],
    });

    expect(lqCb).toHaveBeenCalledOnce();
  });

  it("applyRemote([]) is a no-op", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);

    const cb = vi.fn();
    db.on("changes:local", cb);
    await db.applyRemote({
      hlc: {
        wallMs: 1_700_000_000_000,
        counter: 0,
        nodeId: "00000000-0000-0000-0000-0000000a11ce",
      },
      ops: [],
    });

    expect(cb).not.toHaveBeenCalled();
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(0);
  });

  it("changes:local payload carries touchedTables for multi-table tx", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);

    const cb = vi.fn();
    db.on("changes:local", cb);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "a", done: 0 });
      t.insert("comments", { id: "c1", body: "x" });
    });

    const payload = cb.mock.calls[0]?.[0] as { touchedTables: string[] };
    expect(payload.touchedTables.sort()).toEqual(["comments", "tasks"]);
  });
  it("buffers absent-row updates and replays them after insert", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    await db.applyRemote({
      hlc: { wallMs: 2000, counter: 0, nodeId: "remote" },
      ops: [{ type: "update", table: "tasks", id: "t1", patch: { name: "new" } }],
    });
    await db.applyRemote({
      hlc: { wallMs: 1000, counter: 0, nodeId: "remote" },
      ops: [{ type: "insert", table: "tasks", id: "t1", data: { id: "t1", name: "old", done: 0 } }],
    });
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks WHERE id = 't1'`);
    expect(rows[0]?.name).toBe("new");
  });
});
