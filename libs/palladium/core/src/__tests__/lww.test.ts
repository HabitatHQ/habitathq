/**
 * Column-level LWW tests.
 *
 * Architecture review §2: "no conflict resolution — not even LWW". The fix
 * is per-column HLC metadata; on `applyRemote`, only apply a remote op
 * if its HLC is strictly greater than the stored HLC for that (table,
 * row_id, col). Equal HLCs on the same node are idempotent.
 *
 * HLC metadata is stored in a shadow table:
 *   _row_versions (table_name, row_id, col, hlc_wall_ms, hlc_counter, hlc_node_id)
 *
 * Local writes update the shadow table in the same transaction as the
 * data write. The engine owns the table; `applyRemote` consults it.
 *
 * Decisions
 * ---------
 * - Column-level LWW (not row-level). The wire format is already per-column
 *   and the journal fan-out matches it. Per-column is the most precise
 *   LWW without a CRDT.
 * - "Strictly greater" — equal HLCs from the same node are skipped (we
 *   already have that HLC). Equal HLCs from different nodes are accepted
 *   (peer saw the same causality and made its own decision).
 * - Delete always wins over an equal HLC update from another node.
 * - A row's HLC is the max of its columns' HLCs; a missing column is
 *   considered "no data, very old HLC".
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { createEngine, type PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";
import type { SchemaMap } from "../tx.js";

interface Schema extends SchemaMap {
  tasks: { id: string; name: string; done: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
};

interface VersionRow {
  table_name: string;
  row_id: string;
  col: string;
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
}

async function versions(
  db: PalladiumEngine<Schema>,
  table: string,
  rowId: string,
): Promise<VersionRow[]> {
  return db.adapter.exec<VersionRow>(
    `SELECT table_name, row_id, col, hlc_wall_ms, hlc_counter, hlc_node_id
     FROM _row_versions WHERE table_name = ? AND row_id = ? ORDER BY col`,
    [table, rowId],
  );
}

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
}

describe("column-level LWW — local writes stamp _row_versions", () => {
  it("local insert stamps a version row for every column", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.insert("tasks", { id: "t1", name: "hi", done: 0 });

    const rows = await versions(db, "tasks", "t1");
    expect(rows.map((r) => r.col).sort()).toEqual(["done", "id", "name"]);
    // Every column shares the engine's HLC for that tx.
    const walls = new Set(rows.map((r) => r.hlc_wall_ms));
    expect(walls.size).toBe(1);
  });

  it("local update bumps only the patched column's HLC", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.insert("tasks", { id: "t1", name: "hi", done: 0 });
    const before = await versions(db, "tasks", "t1");
    const doneBefore = before.find((r) => r.col === "done");

    // Wait one millisecond so the HLC wallMs advances.
    await new Promise((r) => setTimeout(r, 5));
    await db.update("tasks", "t1", { done: 1 });

    const after = await versions(db, "tasks", "t1");
    const doneAfter = after.find((r) => r.col === "done");
    const nameAfter = after.find((r) => r.col === "name");

    expect(doneAfter?.hlc_wall_ms).toBeGreaterThan(doneBefore?.hlc_wall_ms ?? 0);
    // Untouched columns keep their original HLC.
    expect(nameAfter?.hlc_wall_ms).toBe(before.find((r) => r.col === "name")?.hlc_wall_ms);
  });

  it("local delete removes the row AND the version rows", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.insert("tasks", { id: "t1", name: "hi", done: 0 });
    await db.delete("tasks", "t1");
    expect(await versions(db, "tasks", "t1")).toHaveLength(0);
  });
});

describe("column-level LWW — applyRemote skips stale ops", () => {
  it("a remote op with a stale HLC is rejected wholesale (data + version unchanged)", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    await db.insert("tasks", { id: "t1", name: "newer", done: 0 });
    const local = (await versions(db, "tasks", "t1")).find((r) => r.col === "name");
    const localHlc = {
      wallMs: local!.hlc_wall_ms,
      counter: local!.hlc_counter,
      nodeId: local!.hlc_node_id,
    };

    // Remote op with a strictly older HLC.
    const older = { wallMs: localHlc.wallMs - 100, counter: 0, nodeId: "ff" };
    await db.applyRemote(older, [
      { type: "update", table: "tasks", id: "t1", patch: { name: "older" } },
    ]);

    // Version row was NOT bumped.
    const after = (await versions(db, "tasks", "t1")).find((r) => r.col === "name");
    expect(after?.hlc_wall_ms).toBe(localHlc.wallMs);
    // Data write was skipped.
    const rows = await db.exec<{ name: string }>(sql`SELECT name FROM tasks WHERE id = 't1'`);
    expect(rows[0]?.name).toBe("newer");
  });

  it("a remote op with a strictly newer HLC is accepted (data + version bump)", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.insert("tasks", { id: "t1", name: "old", done: 0 });
    const before = (await versions(db, "tasks", "t1")).find((r) => r.col === "name");

    const newer = { wallMs: before!.hlc_wall_ms + 100, counter: 0, nodeId: "ff" };
    await db.applyRemote(newer, [
      { type: "update", table: "tasks", id: "t1", patch: { name: "new" } },
    ]);

    const rows = await db.exec<{ name: string }>(sql`SELECT name FROM tasks WHERE id = 't1'`);
    expect(rows[0]?.name).toBe("new");
    const after = (await versions(db, "tasks", "t1")).find((r) => r.col === "name");
    expect(after?.hlc_wall_ms).toBe(newer.wallMs);
  });

  it("a remote update of column A does not affect the HLC of column B", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.insert("tasks", { id: "t1", name: "a", done: 0 });
    const nameBefore = (await versions(db, "tasks", "t1")).find((r) => r.col === "name");
    const doneBefore = (await versions(db, "tasks", "t1")).find((r) => r.col === "done");

    const newer = { wallMs: nameBefore!.hlc_wall_ms + 50, counter: 0, nodeId: "ff" };
    await db.applyRemote(newer, [
      { type: "update", table: "tasks", id: "t1", patch: { name: "b" } },
    ]);

    const after = await versions(db, "tasks", "t1");
    const nameAfter = after.find((r) => r.col === "name");
    const doneAfter = after.find((r) => r.col === "done");
    expect(nameAfter?.hlc_wall_ms).toBe(newer.wallMs);
    expect(doneAfter?.hlc_wall_ms).toBe(doneBefore?.hlc_wall_ms);
    void nameBefore;
  });
});
