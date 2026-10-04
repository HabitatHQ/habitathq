import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it, vi } from "vitest";
import { resetOwnedTables } from "../storage-reset.js";

function makeAdapter(): NodeSqliteAdapter {
  return new NodeSqliteAdapter({ vfs: { type: "memory" } });
}

async function scalar(adapter: NodeSqliteAdapter, table: string): Promise<number> {
  const rows = await adapter.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM "${table}"`);
  return rows[0]?.count ?? 0;
}

describe("resetOwnedTables", () => {
  it("deletes only explicit owned tables and preserves reserved metadata", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.exec("PRAGMA foreign_keys = ON");
    await adapter.runMigrations([
      "CREATE TABLE projects (id TEXT PRIMARY KEY)",
      "CREATE TABLE entries (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE)",
      "CREATE TABLE notes (id TEXT PRIMARY KEY)",
      "CREATE TABLE _palladium_seeds (key TEXT PRIMARY KEY)",
    ]);
    await adapter.exec("INSERT INTO projects VALUES ('p')");
    await adapter.exec("INSERT INTO entries VALUES ('e', 'p')");
    await adapter.exec("INSERT INTO notes VALUES ('n')");
    await adapter.exec("INSERT INTO _palladium_seeds VALUES ('seed')");

    const result = await resetOwnedTables(adapter, {
      ownedTables: ["projects", "entries", "notes"],
      preserveTables: ["notes"],
    });

    expect(result.deletedTables).toEqual(["projects", "entries"]);
    expect(result.preservedTables).toEqual(["notes"]);
    expect(await scalar(adapter, "projects")).toBe(0);
    expect(await scalar(adapter, "entries")).toBe(0);
    expect(await scalar(adapter, "notes")).toBe(1);
    expect(await scalar(adapter, "_palladium_seeds")).toBe(1);
    await adapter.close();
  });

  it("rolls back all parent and child deletions when a later delete fails", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.exec("PRAGMA foreign_keys = ON");
    await adapter.runMigrations([
      "CREATE TABLE parents (id TEXT PRIMARY KEY)",
      "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id))",
      "CREATE TABLE fail_table (id TEXT PRIMARY KEY)",
      "CREATE TRIGGER reject_reset BEFORE DELETE ON fail_table BEGIN SELECT RAISE(ABORT, 'injected'); END",
    ]);
    await adapter.exec("INSERT INTO parents VALUES ('p')");
    await adapter.exec("INSERT INTO children VALUES ('c', 'p')");
    await adapter.exec("INSERT INTO fail_table VALUES ('f')");

    await expect(
      resetOwnedTables(adapter, {
        ownedTables: ["parents", "children", "fail_table"],
      }),
    ).rejects.toThrow("injected");

    expect(await scalar(adapter, "parents")).toBe(1);
    expect(await scalar(adapter, "children")).toBe(1);
    expect(await scalar(adapter, "fail_table")).toBe(1);
    await adapter.close();
  });

  it("rejects unsafe, reserved, and non-owned preservation identifiers before transaction", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    const transaction = vi.spyOn(adapter, "transaction");

    await expect(
      resetOwnedTables(adapter, { ownedTables: ["safe; DROP TABLE x"] }),
    ).rejects.toThrow("Invalid owned table identifier");
    await expect(resetOwnedTables(adapter, { ownedTables: ["_sync_state"] })).rejects.toThrow(
      "Reserved metadata table",
    );
    await expect(
      resetOwnedTables(adapter, { ownedTables: ["safe"], preserveTables: ["other"] }),
    ).rejects.toThrow("is not an owned table");
    expect(transaction).not.toHaveBeenCalled();
    await adapter.close();
  });
});
