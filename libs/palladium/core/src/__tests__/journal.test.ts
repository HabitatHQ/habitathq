/**
 * Engine change-journal tests — verify that a local `tx()` writes a journal
 * row in the same storage transaction as the data writes.
 *
 * The journal table is `_changes (change_id, hlc_wall_ms, hlc_counter,
 * hlc_node_id, ops, created_at)`. After every committed local tx with at
 * least one op, exactly one journal row must exist carrying the engine's
 * HLC and the serialised ops.
 *
 * `applyRemote` must NOT journal (the change came from the server; it is
 * not something we need to upload).
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it, vi } from "vitest";
import { createEngine } from "../engine.js";
import { sql } from "../sql.js";
import type { SchemaMap } from "../tx.js";

interface Schema extends SchemaMap {
  tasks: { id: string; name: string; done: number };
}

const SCHEMA = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
};

interface JournalRow {
  change_id: string;
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
  ops: string;
  created_at: number;
}

async function journalRows(db: ReturnType<typeof makeDb>): Promise<JournalRow[]> {
  return db.adapter.exec<JournalRow>(
    "SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, created_at FROM _changes ORDER BY hlc_wall_ms, hlc_counter, change_id",
    [],
  );
}

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
}

describe("engine change journal", () => {
  it("local tx() writes one journal row with the engine's HLC and serialised ops", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    expect(await journalRows(db)).toHaveLength(0);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "hello", done: 0 });
    });

    const rows = await journalRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hlc_node_id).toBe(db.nodeId);
    const parsed = JSON.parse(rows[0]?.ops ?? "[]") as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ op: "insert", table: "tasks", row_id: "t1" });
  });

  it("multi-op tx() journals exactly one row carrying all ops in order", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "a", done: 0 });
      t.insert("tasks", { id: "t2", name: "b", done: 0 });
      t.update("tasks", "t1", { done: 1 });
    });

    const rows = await journalRows(db);
    expect(rows).toHaveLength(1);
    const parsed = JSON.parse(rows[0]?.ops ?? "[]") as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(3);
    expect(parsed.map((o) => o.row_id)).toEqual(["t1", "t2", "t1"]);
    expect(parsed[2]).toMatchObject({ op: "update", col: "done", value: 1 });
  });

  it("two consecutive tx() calls produce two journal rows in order", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.tx((t) => {
      t.insert("tasks", { id: "t1", name: "a", done: 0 });
    });
    await db.tx((t) => {
      t.insert("tasks", { id: "t2", name: "b", done: 0 });
    });

    const rows = await journalRows(db);
    expect(rows).toHaveLength(2);
    const a = JSON.parse(rows[0]?.ops ?? "[]") as Array<{ row_id: string }>;
    const b = JSON.parse(rows[1]?.ops ?? "[]") as Array<{ row_id: string }>;
    expect(a[0]?.row_id).toBe("t1");
    expect(b[0]?.row_id).toBe("t2");
  });

  it("applyRemote() does NOT journal — remote changes are not uploads", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.applyRemote({ wallMs: 1_700_000_000_000, counter: 0, nodeId: "ff" }, [
      {
        type: "insert",
        table: "tasks",
        id: "t1",
        data: { id: "t1", name: "from server", done: 0 },
      },
    ]);

    expect(await journalRows(db)).toHaveLength(0);
    // …but the data still landed locally.
    const rows = await db.exec<{ id: string }>(sql`SELECT id FROM tasks`);
    expect(rows).toHaveLength(1);
  });

  it("consecutive tx() calls advance the HLC counter", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    // Freeze the wall clock so both txs land in the same millisecond and
    // the counter must strictly advance. (Without the freeze, an OS-level
    // tick between the two awaits would reset the counter to 0 and make
    // the test flakey.)
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      await db.tx((t) => {
        t.insert("tasks", { id: "t1", name: "a", done: 0 });
      });
      await db.tx((t) => {
        t.insert("tasks", { id: "t2", name: "b", done: 0 });
      });

      const rows = await journalRows(db);
      expect(rows).toHaveLength(2);
      const [first, second] = rows;
      expect(second?.hlc_counter).toBeGreaterThan(first?.hlc_counter ?? -1);
      expect(second?.hlc_wall_ms).toBeGreaterThanOrEqual(first?.hlc_wall_ms ?? -1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("a failed tx() rolls back BOTH the data writes and the journal row", async () => {
    // Wrap the real SQLite adapter in one whose `put` throws — the data
    // write fails inside the storage transaction, the journal INSERT must
    // not commit alongside it.
    class FailingPutAdapter extends NodeSqliteAdapter {
      override async put(): Promise<void> {
        throw new Error("boom");
      }
    }
    const failing = new FailingPutAdapter({ vfs: { type: "memory" } });
    const db = createEngine<Schema>(failing);
    await db.init(SCHEMA);

    await expect(
      db.tx((t) => {
        t.insert("tasks", { id: "t1", name: "x", done: 0 });
      }),
    ).rejects.toThrow("boom");

    expect(await journalRows(db)).toHaveLength(0);
  });

  it("a synchronous tx() with an empty builder journals nothing", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.tx(() => {
      // build nothing
    });

    expect(await journalRows(db)).toHaveLength(0);
  });
});
