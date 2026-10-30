import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it, vi } from "vitest";
import { type ChangesLocal, createEngine, PalladiumEngine, type RemoteChange } from "../engine.js";
import { compareHlc, createHlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";
import type { StorageAdapter } from "../storage.js";
import type { Op } from "../tx.js";

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
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "hello", done: 0 });
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "hello",
      done: 0,
    });
  });

  it("update changes stored row", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.tx((t) => {
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "hello", done: 0 });
    });
    await db.tx((t) => {
      t.update("tasks", "018f0f50-7b8d-7a1c-8e2f-1234567890ab", { done: 1 });
    });

    const rows = await db.exec<Schema["tasks"]>(
      sql`SELECT * FROM tasks WHERE id = ${"018f0f50-7b8d-7a1c-8e2f-1234567890ab"}`,
    );
    expect(rows[0]?.done).toBe(1);
  });

  it("delete removes the row", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.tx((t) => {
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "A", done: 0 });
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac", name: "B", done: 0 });
    });
    await db.tx((t) => {
      t.delete("tasks", "018f0f50-7b8d-7a1c-8e2f-1234567890ab");
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("018f0f50-7b8d-7a1c-8e2f-1234567890ac");
  });

  it("liveQuery emits change on write to watched table", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    lq.on("change", cb);

    await db.tx((t) => {
      t.insert("tasks", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
        name: "018f0f50-7b8d-7a1c-8e2f-1234567890b1",
        done: 0,
      });
    });

    expect(cb).toHaveBeenCalledOnce();
  });

  it("liveQuery delivers updated rows to the callback", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const received: Schema["tasks"][][] = [];
    lq.on("change", (rows) => received.push(rows));

    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "hello",
      done: 0,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    expect(received[0]?.[0]).toMatchObject({ id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab" });
  });

  it.each([
    ["bare", sql`SELECT * FROM tasks`],
    ["double-quoted", sql`SELECT * FROM "tasks"`],
    ["bracketed", sql`SELECT * FROM [tasks]`],
    ["backtick-quoted", sql`SELECT * FROM \`tasks\``],
    ["schema-qualified", sql`SELECT * FROM main.tasks`],
    ["quoted schema", sql`SELECT * FROM "main".tasks`],
    ["quoted table", sql`SELECT * FROM main."tasks"`],
    ["quoted schema and table", sql`SELECT * FROM "main"."tasks"`],
    ["bracketed schema and table", sql`SELECT * FROM [main].[tasks]`],
    ["backtick-quoted schema and table", sql`SELECT * FROM \`main\`.\`tasks\``],
  ])(
    "liveQuery refreshes rows after insert and update using %s identifiers",
    async (_label, query) => {
      const db = makeDb();
      await db.init(SCHEMA);
      const live = db.liveQuery<Schema["tasks"]>(query);
      const received: Schema["tasks"][][] = [];
      live.on("change", (rows) => received.push(rows));
      const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";

      await db.insert("tasks", { id, name: "inserted", done: 0 });
      const insertedRows = await live.exec();
      expect(insertedRows).toEqual([{ id, name: "inserted", done: 0 }]);
      expect(received).toEqual([insertedRows]);

      await db.tx((tx) => tx.update("tasks", id, { name: "updated", done: 1 }));
      const updatedRows = await live.exec();
      expect(updatedRows).toEqual([{ id, name: "updated", done: 1 }]);
      expect(received).toEqual([insertedRows, updatedRows]);
      await db.adapter.close();
    },
  );

  it("liveQuery does not fire for writes to an unrelated table", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const taskQuery = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const cb = vi.fn();
    taskQuery.on("change", cb);

    await db.insert("comments", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad", body: "hello" });

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

    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "018f0f50-7b8d-7a1c-8e2f-1234567890b1",
      done: 0,
    });

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
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "a", done: 0 });
      t.insert("comments", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad", body: "b" });
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

    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "018f0f50-7b8d-7a1c-8e2f-1234567890b1",
      done: 0,
    });

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
    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "018f0f50-7b8d-7a1c-8e2f-1234567890b1",
      done: 0,
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("getSyncStatus returns idle initially", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    expect(db.getSyncStatus()).toBe("uninitialized");
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

    await db.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "hi", done: 0 });
    await db.update("tasks", "018f0f50-7b8d-7a1c-8e2f-1234567890ab", { done: 1 });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows[0]?.done).toBe(1);

    await db.delete("tasks", "018f0f50-7b8d-7a1c-8e2f-1234567890ab");
    const after = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(after).toHaveLength(0);
  });

  it("exec() with parameterised WHERE returns only matching row", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "A", done: 0 });
    await db.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac", name: "B", done: 0 });

    const rows = await db.exec<Schema["tasks"]>(
      sql`SELECT * FROM tasks WHERE id = ${"018f0f50-7b8d-7a1c-8e2f-1234567890ac"}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("018f0f50-7b8d-7a1c-8e2f-1234567890ac");
  });

  it("tx wraps in a transaction (adapter is transactable)", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    // Insert two rows in one tx — both should appear atomically.
    await db.tx((t) => {
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "a", done: 0 });
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac", name: "b", done: 0 });
    });

    const rows = await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(2);
  });

  it("rejects writes when the adapter cannot guarantee atomicity", async () => {
    const db = createEngine<Schema>(new NonTransactableStorageAdapter());
    await db.init(SCHEMA);

    await expect(
      db.tx((t) => {
        t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "local", done: 0 });
        t.insert("comments", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad", body: "local" });
      }),
    ).rejects.toThrow("PalladiumEngine writes require transaction support");

    await expect(
      db.applyRemote({
        hlc: {
          wallMs: 1_700_000_000_000,
          counter: 0,
          nodeId: "00000000-0000-4000-8000-00000000cafe",
        },
        ops: [
          {
            type: "insert",
            table: "tasks",
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
            data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac", name: "remote", done: 0 },
          },
          {
            type: "insert",
            table: "comments",
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae",
            data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae", body: "remote" },
          },
        ],
      }),
    ).rejects.toThrow("PalladiumEngine writes require transaction support");

    expect(await db.exec(sql`SELECT * FROM tasks`)).toHaveLength(0);
    expect(await db.exec(sql`SELECT * FROM comments`)).toHaveLength(0);
  });

  it("rejects nontransactional capture before invoking its callback", async () => {
    const db = createEngine<Schema>(new NonTransactableStorageAdapter());
    await db.init(SCHEMA);
    const callback = vi.fn(async () => ({ result: undefined, ops: [] }));
    await expect(db.captureLocal(callback)).rejects.toThrow(
      "PalladiumEngine writes require transaction support",
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it("rolls back callback failures without publishing a local change", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const changes = vi.fn();
    db.on("changes:local", changes);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await expect(
      db.captureLocal(async (adapter) => {
        await adapter.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [id, "x", 0]);
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");
    expect(await db.exec(sql`SELECT * FROM tasks`)).toEqual([]);
    expect(changes).not.toHaveBeenCalled();
    expect(db.currentHlc).toBeNull();
  });

  it("captures already-applied SQL once and publishes only after commit", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.exec(
      sql`CREATE TRIGGER forbid_capture_replay
          BEFORE INSERT ON tasks
          WHEN EXISTS (SELECT 1 FROM tasks WHERE id = NEW.id)
          BEGIN SELECT RAISE(ABORT, 'unexpected replay'); END`,
    );
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const invalidations: string[][] = [];
    let observedRead: Promise<Schema["tasks"][]> | null = null;
    const published: ChangesLocal<Schema>[] = [];
    db.on("changes:local", (change) => {
      published.push(change);
      observedRead = db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    });
    db.on("tables:changed", (tables) => invalidations.push([...tables]));
    const result = await db.captureLocal(async (adapter) => {
      await adapter.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [id, "first", 0]);
      const rows = await adapter.exec<Schema["tasks"]>("SELECT * FROM tasks WHERE id = ?", [id]);
      return {
        result: rows[0]?.name,
        ops: [{ type: "insert", table: "tasks", id, data: { id, name: "first", done: 0 } }],
      };
    });
    expect(result).toBe("first");
    expect(await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`)).toEqual([
      { id, name: "first", done: 0 },
    ]);
    const committedRead = observedRead;
    if (committedRead === null) throw new Error("expected a post-commit observer read");
    await expect(committedRead).resolves.toEqual([{ id, name: "first", done: 0 }]);
    expect(invalidations).toEqual([["tasks"]]);
    expect(published).toHaveLength(1);
    const publishedOp = published[0]?.ops[0];
    expect(Object.isFrozen(published[0]?.ops)).toBe(true);
    expect(Object.isFrozen(publishedOp)).toBe(true);
    if (publishedOp?.type === "insert") {
      expect(Object.isFrozen(publishedOp.data)).toBe(true);
    }
  });

  it("rolls back captured SQL, metadata, checkpoints and HLC when checkpoint fails", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const beforeHlc = db.currentHlc;
    db.registerLocalChangeCheckpoint(async (_change, adapter) => {
      await adapter.exec("INSERT INTO checkpoint_rows (id) VALUES (?)", ["checkpoint"]);
      throw new Error("capture checkpoint failed");
    });
    await db.exec(sql`CREATE TABLE checkpoint_rows (id TEXT PRIMARY KEY)`);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await expect(
      db.captureLocal(async (adapter) => {
        await adapter.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [id, "x", 0]);
        return {
          result: undefined,
          ops: [{ type: "insert", table: "tasks", id, data: { id, name: "x", done: 0 } }],
        };
      }),
    ).rejects.toThrow("capture checkpoint failed");
    expect(await db.exec(sql`SELECT * FROM tasks`)).toEqual([]);
    expect(await db.exec(sql`SELECT * FROM checkpoint_rows`)).toEqual([]);
    expect(await db.exec(sql`SELECT * FROM _sync_row_meta`)).toEqual([]);
    expect(await db.exec(sql`SELECT value FROM _sync_state WHERE key = 'hlc'`)).toEqual([]);
    expect(db.currentHlc).toEqual(beforeHlc);
  });

  it("rejects invalid captured ops by rolling back their already-applied SQL", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await expect(
      db.captureLocal(async (adapter) => {
        await adapter.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [id, "x", 0]);
        return {
          result: undefined,
          ops: [
            {
              type: "update",
              table: "tasks",
              id,
              patch: { unknown_column: 1 },
            } as never,
          ],
        };
      }),
    ).rejects.toThrow("Captured operation must use canonical schema table and columns");
    expect(await db.exec(sql`SELECT * FROM tasks`)).toEqual([]);
    expect(await db.exec(sql`SELECT * FROM _sync_row_meta`)).toEqual([]);
    expect(db.currentHlc).toBeNull();
  });

  it("rejects case-insensitive primary-key patches before committing capture SQL", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await expect(
      db.captureLocal(async (adapter) => {
        await adapter.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [id, "x", 0]);
        return {
          result: undefined,
          ops: [{ type: "update", table: "tasks", id, patch: { ID: id } } as never],
        };
      }),
    ).rejects.toThrow("Cannot update the immutable primary key");
    expect(await db.exec(sql`SELECT * FROM tasks`)).toEqual([]);
    expect(db.currentHlc).toBeNull();
  });

  it("records no change for a read-only or net-zero capture", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await db.insert("tasks", { id, name: "before", done: 0 });
    const priorHlc = db.currentHlc;
    const changes = vi.fn();
    const invalidations = vi.fn();
    db.on("changes:local", changes);
    db.on("tables:changed", invalidations);

    const preview = await db.captureLocal(async (adapter) => {
      const rows = await adapter.exec<Schema["tasks"]>("SELECT * FROM tasks WHERE id = ?", [id]);
      return { result: rows[0]?.name, ops: [] };
    });
    expect(preview).toBe("before");

    const netZero = await db.captureLocal(async (adapter) => {
      await adapter.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [
        "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
        "temporary",
        0,
      ]);
      await adapter.exec("DELETE FROM tasks WHERE id = ?", [
        "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
      ]);
      const rows = await adapter.exec<Schema["tasks"]>("SELECT * FROM tasks ORDER BY id");
      return { result: rows.length, ops: [] };
    });
    expect(netZero).toBe(1);

    expect(await db.exec(sql`SELECT name FROM tasks`)).toEqual([{ name: "before" }]);
    expect(db.currentHlc).toEqual(priorHlc);
    expect(changes).not.toHaveBeenCalled();
    expect(invalidations).not.toHaveBeenCalled();
  });
  it("rejects malformed captured operations before committing their SQL", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const cases: readonly {
      readonly label: string;
      readonly message: string;
      readonly ops: readonly unknown[];
    }[] = [
      {
        label: "unknown operation kind",
        message: "Captured operation type is invalid",
        ops: [{ type: "upsert", table: "tasks", id }],
      },
      {
        label: "unexpected operation fields",
        message: "Captured operation has unexpected fields",
        ops: [{ type: "delete", table: "tasks", id, extra: true }],
      },
      {
        label: "non-object insert data",
        message: "Captured insert data must be a JSON object",
        ops: [{ type: "insert", table: "tasks", id, data: "not-an-object" }],
      },
      {
        label: "non-object update patch",
        message: "Captured update patch must be a JSON object",
        ops: [{ type: "update", table: "tasks", id, patch: 7 }],
      },
      {
        label: "non-UUIDv7 row id",
        message: "Captured operation row id must be a canonical UUIDv7",
        ops: [{ type: "delete", table: "tasks", id: "not-a-uuid" }],
      },
      {
        label: "unknown schema table",
        message: "Captured operation must use canonical schema table and columns",
        ops: [{ type: "delete", table: "missing", id }],
      },
      {
        label: "duplicate row in one capture",
        message: "Captured ops must be net row changes",
        ops: [
          { type: "insert", table: "tasks", id, data: { id, name: "x", done: 0 } },
          { type: "insert", table: "tasks", id, data: { id, name: "x", done: 0 } },
        ],
      },
    ];

    for (const testCase of cases) {
      const db = makeDb();
      await db.init(SCHEMA);
      await expect(
        db.captureLocal(async (adapter) => {
          await adapter.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [id, "x", 0]);
          // `captureLocal` is typed for trusted callers, but its runtime
          // admission must still reject malformed shapes from untyped callers.
          return { result: undefined, ops: testCase.ops as readonly Op<Schema>[] };
        }),
      ).rejects.toThrow(testCase.message);
      expect(await db.exec(sql`SELECT * FROM tasks`), testCase.label).toEqual([]);
      expect(await db.exec(sql`SELECT * FROM _sync_row_meta`), testCase.label).toEqual([]);
      expect(db.currentHlc, testCase.label).toBeNull();
      await db.adapter.close();
    }
  });

  it("serializes an ordinary transaction behind an asynchronous capture", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    let entered!: () => void;
    let release!: () => void;
    const callbackEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const capture = db.captureLocal(async (adapter) => {
      entered();
      await gate;
      const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
      await adapter.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [
        id,
        "captured",
        0,
      ]);
      return {
        result: undefined,
        ops: [{ type: "insert", table: "tasks", id, data: { id, name: "captured", done: 0 } }],
      };
    });
    await callbackEntered;
    const queued = db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
      name: "queued",
      done: 0,
    });
    release();
    await Promise.all([capture, queued]);
    expect(await db.exec(sql`SELECT name FROM tasks ORDER BY name`)).toEqual([
      { name: "captured" },
      { name: "queued" },
    ]);
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

  it("captures mutable update payloads before SQL and checkpoint ownership", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await db.insert("tasks", { id, name: "initial", done: 0 });
    let entered!: () => void;
    let release!: () => void;
    const enteredCheckpoint = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const checkpointGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checkpointValue: unknown;
    db.registerLocalChangeCheckpoint(async (change) => {
      entered();
      await checkpointGate;
      checkpointValue = change.ops[0]?.type === "update" ? change.ops[0].patch.name : null;
    });
    const patch = { name: "committed" };
    const write = db.update("tasks", id, patch);
    await enteredCheckpoint;
    patch.name = "never-committed";
    release();
    await write;
    expect(
      (await db.exec<Schema["tasks"]>(sql`SELECT name FROM tasks WHERE id = ${id}`))[0]?.name,
    ).toBe("committed");
    expect(checkpointValue).toBe("committed");
  });

  it("rolls back standalone purge metadata cleanup failures without notifying tables", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const remote = {
      hlc: createHlc(crypto.randomUUID(), Date.now() + 100),
      ops: [{ type: "insert", table: "tasks", id, data: { id, name: "retained", done: 0 } }],
    } satisfies RemoteChange<Schema>;
    await db.applyRemote(remote);
    let notifications = 0;
    db.on("tables:changed", () => {
      notifications += 1;
    });
    await db.exec(
      sql`CREATE TRIGGER fail_meta_purge BEFORE DELETE ON _sync_row_meta
          BEGIN SELECT RAISE(ABORT, 'purge failure'); END`,
    );
    const before = notifications;
    await expect(db.purgeLocal("tasks", id)).rejects.toThrow();
    expect(await db.exec(sql`SELECT id FROM tasks WHERE id = ${id}`)).toHaveLength(1);
    expect(notifications).toBe(before);
    await db.applyRemote(remote);
    expect(await db.exec(sql`SELECT name FROM tasks WHERE id = ${id}`)).toEqual([
      { name: "retained" },
    ]);
  });
  it("rolls back local mutations when a checkpoint fails", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    db.registerLocalChangeCheckpoint(async () => {
      throw new Error("checkpoint failed");
    });

    await expect(
      db.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "blocked", done: 0 }),
    ).rejects.toThrow("checkpoint failed");
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

    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "durable",
      done: 0,
    });
    expect(observed).toBe(true);
    expect(observedRows).not.toBeNull();
    const checkpoints = await observedRows;
    expect(checkpoints).toHaveLength(1);
  });
  it("serializes live-query refreshes behind storage transactions and never exposes rolled-back rows", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const live = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const emissions: Schema["tasks"][][] = [];
    live.on("change", (rows) => emissions.push(rows));
    const queuedRefresh: { promise?: Promise<void> } = {};

    await expect(
      db.withStorage(async () =>
        db.adapter.transaction(async (tx) => {
          await tx.exec("INSERT INTO tasks (id, name, done) VALUES (?, ?, ?)", [
            "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
            "rolled back",
            0,
          ]);
          queuedRefresh.promise = live.refresh();
          throw new Error("rollback transaction");
        }),
      ),
    ).rejects.toThrow("rollback transaction");

    const refresh = queuedRefresh.promise;
    if (refresh === undefined) throw new Error("expected queued live-query refresh");
    await refresh;
    expect(emissions).toEqual([[]]);
    live.cancel();
  });
  it("keeps mutations queued until the canonical alias migration commits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "palladium-migration-serialize-"));
    const adapter = new NodeSqliteAdapter({
      vfs: { type: "file", filename: join(dir, "db.sqlite") },
    });
    const db = new PalladiumEngine<Schema>(adapter);
    let releaseMigration: (() => void) | undefined;
    try {
      await db.init(SCHEMA);
      await adapter.exec("INSERT INTO _sync_row_meta VALUES ('TASKS', 'row', 'NAME', 1, 0, ?)", [
        "00000000-0000-4000-8000-000000000001",
      ]);
      await adapter.close();
      let enteredMigration: (() => void) | undefined;
      const migrationEntered = new Promise<void>((resolve) => {
        enteredMigration = resolve;
      });
      const migrationGate = new Promise<void>((resolve) => {
        releaseMigration = resolve;
      });
      const originalTransaction = adapter.transaction.bind(adapter);
      vi.spyOn(adapter, "transaction").mockImplementation((callback) =>
        originalTransaction((tx) => {
          const originalExec = tx.exec.bind(tx);
          tx.exec = async (statement, params) => {
            if (statement.includes("SELECT DISTINCT tbl FROM _sync_row_meta")) {
              enteredMigration?.();
              await migrationGate;
            }
            return originalExec(statement, params);
          };
          return callback(tx).finally(() => {
            tx.exec = originalExec;
          });
        }),
      );

      const initialization = db.init(SCHEMA);
      await migrationEntered;
      let mutationFinished = false;
      const mutation = db
        .insert("tasks", {
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          name: "queued",
          done: 0,
        })
        .then(() => {
          mutationFinished = true;
        });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(mutationFinished).toBe(false);
      releaseMigration?.();
      await Promise.all([initialization, mutation]);
      expect(await db.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`)).toEqual([
        { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "queued", done: 0 },
      ]);
      expect(
        await db.exec<{ tbl: string; col: string }>(
          sql`SELECT tbl, col FROM _sync_row_meta WHERE row_id = ${"row"}`,
        ),
      ).toEqual([{ tbl: "tasks", col: "name" }]);
    } finally {
      releaseMigration?.();
      await db.adapter.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("does not let a distinct Unicode table's legacy metadata suppress an ASCII table update", async () => {
    const dir = mkdtempSync(join(tmpdir(), "palladium-catalog-identity-"));
    const adapter = new NodeSqliteAdapter({
      vfs: { type: "file", filename: join(dir, "db.sqlite") },
    });
    const keySchema: SchemaConfig = {
      version: 1,
      schema: "CREATE TABLE IF NOT EXISTS keys (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    };
    type KeySchema = { keys: { id: string; value: string } };
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const nodeId = "00000000-0000-4000-8000-000000000001";
    try {
      const firstOpen = new PalladiumEngine<KeySchema>(adapter, { nodeId });
      await firstOpen.init(keySchema);
      await adapter.exec('CREATE TABLE "Keys" (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
      await adapter.exec("INSERT INTO keys VALUES (?, ?)", [id, "original"]);
      await adapter.exec('INSERT INTO "Keys" VALUES (?, ?)', [id, "unowned"]);
      await adapter.exec("INSERT INTO _sync_row_meta VALUES (?, ?, 'value', 2000, 0, ?)", [
        "Keys",
        id,
        nodeId,
      ]);
      await adapter.close();

      const reopened = new PalladiumEngine<KeySchema>(adapter, { nodeId });
      await reopened.init(keySchema);
      await reopened.applyRemote({
        hlc: { wallMs: 1000, counter: 0, nodeId },
        ops: [{ type: "update", table: "keys", id, patch: { value: "updated" } }],
      });
      expect(await reopened.exec(sql`SELECT value FROM keys WHERE id = ${id}`)).toEqual([
        { value: "updated" },
      ]);
      expect(await adapter.exec('SELECT value FROM "Keys" WHERE id = ?', [id])).toEqual([
        { value: "unowned" },
      ]);
    } finally {
      await adapter.close();
      rmSync(dir, { recursive: true, force: true });
    }
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
    const nodeId = "00000000-0000-4000-8000-0000000000aa";
    const db = makeTestEngine(nodeId);
    expect(db.nodeId).toBe(nodeId);
  });

  it("rejects a nodeId that is not a canonical UUIDv4", () => {
    expect(() => makeTestEngine("legacy-node")).toThrow(
      "PalladiumEngine nodeId must be a canonical UUIDv4",
    );
  });

  it("currentHlc starts as null until the first send/receive", () => {
    const db = makeTestEngine();
    expect(db.currentHlc).toBeNull();
  });

  it("nextSendHlc carries the engine's nodeId", () => {
    const nodeId = "00000000-0000-4000-8000-0000000000bb";
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
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "a", done: 0 });
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac", name: "b", done: 0 });
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
        nodeId: "00000000-0000-4000-8000-0000000a11ce",
      },
      ops: [
        {
          type: "insert",
          table: "tasks",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "remote", done: 0 },
        },
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
          nodeId: "00000000-0000-4000-8000-0000000a11ce",
        },
        ops: [
          {
            type: "insert",
            table: "tasks",
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890b0",
            data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890b0", name: "remote", done: 0 },
          },
        ],
      }),
      db.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890af", name: "local", done: 0 }),
    ]);

    // The local write emitted exactly once; the remote apply emitted nothing.
    expect(cb).toHaveBeenCalledTimes(1);
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT id FROM tasks ORDER BY id`);
    expect(rows.map((r) => r.id)).toEqual([
      "018f0f50-7b8d-7a1c-8e2f-1234567890af",
      "018f0f50-7b8d-7a1c-8e2f-1234567890b0",
    ]);
  });

  it("rejects a remote op whose table name is not a plain identifier (SQL-injection guard)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);

    // A malicious peer sends a table name crafted to break out of the query.
    const maliciousChange = {
      hlc: { wallMs: 1, counter: 0, nodeId: "00000000-0000-4000-8000-0000000a11ce" },
      ops: [
        {
          type: "insert",
          table: "tasks",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890b1",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890b1", name: "n", done: 0 },
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
        nodeId: "00000000-0000-4000-8000-0000000a11ce",
      },
      ops: [
        {
          type: "insert",
          table: "tasks",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "remote", done: 0 },
        },
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
        nodeId: "00000000-0000-4000-8000-0000000a11ce",
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
      t.insert("tasks", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "a", done: 0 });
      t.insert("comments", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad",
        body: "018f0f50-7b8d-7a1c-8e2f-1234567890b1",
      });
    });

    const payload = cb.mock.calls[0]?.[0] as { touchedTables: readonly string[] };
    expect([...payload.touchedTables].sort()).toEqual(["comments", "tasks"]);
  });
  it("buffers absent-row updates and replays them after insert", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    await db.applyRemote({
      hlc: { wallMs: 2000, counter: 0, nodeId: "00000000-0000-4000-8000-00000000cafe" },
      ops: [
        {
          type: "update",
          table: "tasks",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          patch: { name: "new" },
        },
      ],
    });
    await db.applyRemote({
      hlc: { wallMs: 1000, counter: 0, nodeId: "00000000-0000-4000-8000-00000000cafe" },
      ops: [
        {
          type: "insert",
          table: "tasks",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", name: "old", done: 0 },
        },
      ],
    });
    const rows = await db.exec<Schema["tasks"]>(
      sql`SELECT * FROM tasks WHERE id = '018f0f50-7b8d-7a1c-8e2f-1234567890ab'`,
    );
    expect(rows[0]?.name).toBe("new");
  });

  it("restores purged history on replay without accepting changed identities or losing newer writes", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const commentId = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";
    const insert: RemoteChange<Schema> = {
      id: "00000000-0000-4000-8000-000000000011",
      hlc: { wallMs: 1000, counter: 0, nodeId: "00000000-0000-4000-8000-00000000cafe" },
      ops: [
        { type: "insert", table: "tasks", id, data: { id, name: "original", done: 0 } },
        {
          type: "insert",
          table: "comments",
          id: commentId,
          data: { id: commentId, body: "original" },
        },
      ],
    };
    const update: RemoteChange<Schema> = {
      id: "00000000-0000-4000-8000-000000000012",
      hlc: { ...insert.hlc, wallMs: 2000 },
      ops: [{ type: "update", table: "tasks", id, patch: { name: "authoritative" } }],
    };
    try {
      await db.applyRemote(insert);
      await db.applyRemote(update);
      await db.update("comments", commentId, { body: "newer local write" });
      await db.applyRemotePage([], [{ table: "tasks", id }], async () => {});
      expect(await db.exec(sql`SELECT * FROM tasks`)).toEqual([]);
      await expect(
        db.applyRemote({
          ...insert,
          ops: [{ type: "insert", table: "tasks", id, data: { id, name: "tampered", done: 0 } }],
        }),
      ).rejects.toThrow("Remote change id conflict");
      await db.applyRemote(insert);
      await db.applyRemote(update);
      await db.applyRemote(insert);
      expect(await db.exec(sql`SELECT * FROM tasks`)).toEqual([
        { id, name: "authoritative", done: 0 },
      ]);
      expect(await db.exec(sql`SELECT * FROM comments`)).toEqual([
        { id: commentId, body: "newer local write" },
      ]);
    } finally {
      await db.adapter.close();
    }
  });
  it("preserves manual refresh listener rejection (issue #86)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    const failure = new Error("manual refresh failure");
    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    lq.on("change", () => {
      throw failure;
    });
    await expect(lq.refresh()).rejects.toBe(failure);
    lq.cancel();
  });

  it("isolates throwing changes:local listener from insert promise (issue #86)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    const later = vi.fn();
    const reported: Error[] = [];
    db.on("error", () => {
      throw new Error("error listener failure");
    });
    db.on("error", (error) => reported.push(error));
    db.on("changes:local", () => {
      throw new Error("changes:local listener failure");
    });
    db.on("changes:local", later);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890aa";
    await expect(db.insert("tasks", { id, name: "isolated", done: 0 })).resolves.toBeUndefined();
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT name FROM tasks WHERE id = ${id}`);
    expect(rows).toEqual([{ name: "isolated" }]);
    expect(later).toHaveBeenCalledOnce();
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toBe("changes:local listener failure");
  });

  it("isolates throwing changes:local listener from update and delete (issue #86)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890aa";
    await db.insert("tasks", { id, name: "baseline", done: 0 });
    db.on("changes:local", () => {
      throw new Error("changes:local listener failure");
    });
    await expect(db.update("tasks", id, { name: "updated", done: 1 })).resolves.toBeUndefined();
    let rows = await db.exec<Schema["tasks"]>(sql`SELECT name, done FROM tasks WHERE id = ${id}`);
    expect(rows).toEqual([{ name: "updated", done: 1 }]);
    await expect(db.delete("tasks", id)).resolves.toBeUndefined();
    rows = await db.exec<Schema["tasks"]>(sql`SELECT name FROM tasks WHERE id = ${id}`);
    expect(rows).toEqual([]);
  });

  it("isolates throwing live-query listener from insert promise (issue #86)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const other = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const otherListener = vi.fn();
    other.on("change", otherListener);
    const later = vi.fn();
    lq.on("change", () => {
      throw new Error("live-query listener failure");
    });
    lq.on("change", later);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890aa";
    await expect(
      db.insert("tasks", { id, name: "isolated-live", done: 0 }),
    ).resolves.toBeUndefined();
    expect(later).toHaveBeenCalledOnce();
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT name FROM tasks WHERE id = ${id}`);
    expect(rows).toEqual([{ name: "isolated-live" }]);
    expect(otherListener).toHaveBeenCalledOnce();
    other.cancel();
    lq.cancel();
  });

  it("isolates throwing live-query listener from remote apply (issue #86)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    const lq = db.liveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    const later = vi.fn();
    lq.on("change", () => {
      throw new Error("live-query listener failure");
    });
    lq.on("change", later);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890aa";
    await expect(
      db.applyRemote({
        id: "00000000-0000-4000-8000-000000000099",
        hlc: {
          wallMs: 1_700_000_000_000,
          counter: 0,
          nodeId: "00000000-0000-4000-8000-0000000aa086",
        },
        ops: [
          {
            type: "insert",
            table: "tasks",
            id,
            data: { id, name: "remote-isolated", done: 0 },
          },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(later).toHaveBeenCalledOnce();
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT name FROM tasks WHERE id = ${id}`);
    expect(rows).toEqual([{ name: "remote-isolated" }]);
    lq.cancel();
  });

  it("isolates throwing error-listener and still resolves mutation (issue #86)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    db.on("error", () => {
      throw new Error("error listener failure");
    });
    db.on("changes:local", () => {
      throw new Error("changes:local listener failure");
    });
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890aa";
    await expect(
      db.insert("tasks", { id, name: "error-isolated", done: 0 }),
    ).resolves.toBeUndefined();
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT name FROM tasks WHERE id = ${id}`);
    expect(rows).toEqual([{ name: "error-isolated" }]);
  });

  it("keeps storage failure rejecting and rolling back when a later observer throws (issue #86)", async () => {
    const db = makeDbWithSchema();
    await db.init(SCHEMA);
    db.on("changes:local", () => {
      throw new Error("changes:local listener failure");
    });
    db.registerLocalChangeCheckpoint(async () => {
      throw new Error("checkpoint failure");
    });
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890aa";
    await expect(db.insert("tasks", { id, name: "blocked", done: 0 })).rejects.toThrow(
      "checkpoint failure",
    );
    const rows = await db.exec<Schema["tasks"]>(sql`SELECT name FROM tasks WHERE id = ${id}`);
    expect(rows).toEqual([]);
  });

  it("ACL purge clears retirement metadata so grant replay rebuilds the authoritative tombstone", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const nodeId = "00000000-0000-4000-8000-00000000cafe";
    const insert: RemoteChange<Schema> = {
      id: "00000000-0000-4000-8000-000000000021",
      hlc: { wallMs: 1_000, counter: 0, nodeId },
      ops: [{ type: "insert", table: "tasks", id, data: { id, name: "authoritative", done: 0 } }],
    };
    const deletion: RemoteChange<Schema> = {
      id: "00000000-0000-4000-8000-000000000022",
      hlc: { wallMs: 2_000, counter: 0, nodeId },
      ops: [{ type: "delete", table: "tasks", id }],
    };
    try {
      await db.applyRemote(insert);
      await db.applyRemote(deletion);
      await db.applyRemotePage([], [{ table: "tasks", id }], async () => {});
      await db.applyRemote(insert);
      await db.applyRemote(deletion);
      expect(await db.exec(sql`SELECT * FROM tasks WHERE id = ${id}`)).toEqual([]);
      const tombstones = await db.exec<{ hlc_wall_ms: number }>(
        sql`SELECT hlc_wall_ms FROM _sync_row_meta WHERE tbl = 'tasks' AND row_id = ${id} AND col = '__palladium_deleted__'`,
      );
      expect(tombstones).toEqual([{ hlc_wall_ms: 2_000 }]);
    } finally {
      await db.adapter.close();
    }
  });
});

it("owns async observer failures while preserving successful writes and reporting errors", async () => {
  const db = makeDb();
  await db.init(SCHEMA);
  const errors: unknown[] = [];
  let finish!: () => void;
  const reported = new Promise<void>((resolve) => {
    finish = resolve;
  });
  db.on("changes:local", async () => {
    throw new Error("observer rejected");
  });
  db.on("sync:status", () => Promise.reject(new Error("status rejected")));
  db.on("error", (error) => {
    errors.push(error);
    if (errors.length === 2) finish();
  });
  db.on("error", async () => {
    throw new Error("error observer rejected");
  });
  const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
  await db.insert("tasks", { id, name: "committed", done: 0 });
  db.setStatus("syncing");
  await reported;
  expect(await db.exec(sql`SELECT name FROM tasks WHERE id = ${id}`)).toEqual([
    { name: "committed" },
  ]);
  expect(errors).toHaveLength(2);
  await db.adapter.close();
});

it("does not await reentrant local observers while engine storage ownership is held", async () => {
  const db = makeDb();
  await db.init(SCHEMA);
  const firstId = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
  const secondId = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";
  let finish!: () => void;
  const nestedWrite = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let reentered = false;
  db.on("changes:local", async () => {
    if (reentered) return;
    reentered = true;
    await db.insert("tasks", { id: secondId, name: "nested", done: 0 });
    finish();
  });
  await db.insert("tasks", { id: firstId, name: "outer", done: 0 });
  await nestedWrite;
  expect(await db.exec(sql`SELECT name FROM tasks ORDER BY name`)).toEqual([
    { name: "nested" },
    { name: "outer" },
  ]);
  await db.adapter.close();
});

it("snapshots remote input before waiting for engine storage ownership", async () => {
  const db = makeDb();
  await db.init(SCHEMA);
  const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
  await db.insert("tasks", { id, name: "before", done: 0 });
  let entered!: () => void;
  let release!: () => void;
  const enteredStorage = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = db.withStorage(async () => {
    entered();
    await gate;
  });
  await enteredStorage;
  const patch = { name: "accepted" };
  const remote = db.applyRemote({
    hlc: createHlc(crypto.randomUUID(), Date.now() + 100),
    ops: [{ type: "update", table: "tasks", id, patch }],
  });
  patch.name = "mutated after admission";
  release();
  await Promise.all([owner, remote]);
  expect(await db.exec(sql`SELECT name FROM tasks WHERE id = ${id}`)).toEqual([
    { name: "accepted" },
  ]);
  await db.adapter.close();
});

it("rejects coerced remote JSON values and snapshots remote pages at admission", async () => {
  const db = makeDb();
  await db.init(SCHEMA);
  const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
  await db.insert("tasks", { id, name: "before", done: 0 });
  for (const name of [Number.NaN, undefined]) {
    const invalid = {
      hlc: createHlc(crypto.randomUUID(), Date.now() + 100),
      ops: [{ type: "update", table: "tasks", id, patch: { name } }],
    } as unknown as RemoteChange<Schema>;
    await expect(db.applyRemote(invalid)).rejects.toThrow();
  }
  let entered!: () => void;
  let release!: () => void;
  const enteredStorage = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = db.withStorage(async () => {
    entered();
    await gate;
  });
  await enteredStorage;
  const patch = { name: "page accepted" };
  const page = db.applyRemotePage(
    [
      {
        hlc: createHlc(crypto.randomUUID(), Date.now() + 200),
        ops: [{ type: "update", table: "tasks", id, patch }],
      },
    ],
    [],
    async () => {},
  );
  patch.name = "page mutated";
  release();
  await Promise.all([owner, page]);
  expect(await db.exec(sql`SELECT name FROM tasks WHERE id = ${id}`)).toEqual([
    { name: "page accepted" },
  ]);
  await db.adapter.close();
});

it("rolls back standalone purge when deferred-update cleanup fails late", async () => {
  const db = makeDb();
  await db.init(SCHEMA);
  const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
  await db.applyRemote({
    hlc: createHlc(crypto.randomUUID(), Date.now() + 100),
    ops: [{ type: "update", table: "tasks", id, patch: { name: "pending" } }],
  });
  await db.adapter.put("tasks", id, { id, name: "stored", done: 0 });
  await db.exec(
    sql`CREATE TRIGGER fail_pending_purge BEFORE DELETE ON _sync_pending_remote_updates
        BEGIN SELECT RAISE(ABORT, 'late purge failure'); END`,
  );
  await expect(db.purgeLocal("tasks", id)).rejects.toThrow();
  expect(await db.exec(sql`SELECT name FROM tasks WHERE id = ${id}`)).toEqual([{ name: "stored" }]);
  expect(
    await db.exec(sql`SELECT row_id FROM _sync_pending_remote_updates WHERE row_id = ${id}`),
  ).toEqual([{ row_id: id }]);
  await db.adapter.close();
});

it("does not await reentrant async local observers while storage ownership is held", async () => {
  const db = makeDb();
  await db.init(SCHEMA);
  let reentrantDone!: () => void;
  const finished = new Promise<void>((resolve) => {
    reentrantDone = resolve;
  });
  db.on("changes:local", async (change) => {
    const op = change.ops[0];
    if (op?.type !== "insert" || op.data.name !== "first") return;
    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
      name: "second",
      done: 0,
    });
    reentrantDone();
  });
  await db.insert("tasks", {
    id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
    name: "first",
    done: 0,
  });
  await finished;
  expect(await db.exec(sql`SELECT name FROM tasks ORDER BY name`)).toEqual([
    { name: "first" },
    { name: "second" },
  ]);
  await db.adapter.close();
});

it("notifies worker subscribers only after committed local writes and remote applies", async () => {
  const db = makeDb();
  await db.init(SCHEMA);
  const tables: Array<readonly string[]> = [];
  db.on("tables:changed", (changed) => tables.push(changed));
  const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
  await db.insert("tasks", { id, name: "local", done: 0 });
  await db.applyRemote({
    hlc: createHlc(crypto.randomUUID(), Date.now() + 10),
    ops: [{ type: "update", table: "tasks", id, patch: { name: "remote" } }],
  });
  expect(tables).toEqual([["tasks"], ["tasks"]]);
  await db.adapter.close();
});
