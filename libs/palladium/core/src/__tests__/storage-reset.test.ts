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

  it("matches mixed-case preservation references to owned tables and reports the owned spelling", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    try {
      await adapter.exec("PRAGMA foreign_keys = ON");
      await adapter.runMigrations(["CREATE TABLE notes (id TEXT PRIMARY KEY)"]);
      await adapter.exec("INSERT INTO notes VALUES ('n')");

      const result = await resetOwnedTables(adapter, {
        ownedTables: ["notes"],
        preserveTables: ["NoTeS"],
      });

      expect(result.deletedTables).toEqual([]);
      expect(result.preservedTables).toEqual(["notes"]);
      expect(await adapter.exec("SELECT * FROM notes")).toEqual([{ id: "n" }]);
    } finally {
      await adapter.close();
    }
  });

  it.each([
    ["notes", "NOTES"],
    ["notes", "notes"],
  ])(
    "rejects duplicate owned identities %s/%s without deleting preserved rows",
    async (first, second) => {
      const adapter = makeAdapter();
      await adapter.open();
      try {
        await adapter.exec("PRAGMA foreign_keys = ON");
        await adapter.runMigrations([
          "CREATE TABLE notes (id TEXT PRIMARY KEY)",
          "CREATE TABLE note_children (id TEXT PRIMARY KEY, note_id TEXT REFERENCES notes(id) ON DELETE CASCADE)",
        ]);
        await adapter.exec("INSERT INTO notes VALUES ('n')");
        await adapter.exec("INSERT INTO note_children VALUES ('c', 'n')");
        const transaction = vi.spyOn(adapter, "transaction");

        await expect(
          resetOwnedTables(adapter, {
            ownedTables: [first, second],
            preserveTables: ["notes"],
          }),
        ).rejects.toThrow(TypeError);

        expect(transaction).not.toHaveBeenCalled();
        expect(await adapter.exec("SELECT * FROM notes")).toEqual([{ id: "n" }]);
        expect(await adapter.exec("SELECT * FROM note_children")).toEqual([
          { id: "c", note_id: "n" },
        ]);
      } finally {
        await adapter.close();
      }
    },
  );

  it.each(["preserved", "unowned"] as const)(
    "rejects cascading deletion into a %s child without changing either table",
    async (ownership) => {
      const adapter = makeAdapter();
      await adapter.open();
      try {
        await adapter.exec("PRAGMA foreign_keys = ON");
        await adapter.runMigrations([
          "CREATE TABLE parents (id TEXT PRIMARY KEY)",
          "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE)",
        ]);
        await adapter.exec("INSERT INTO parents VALUES ('p')");
        await adapter.exec("INSERT INTO children VALUES ('c', 'p')");

        await expect(
          resetOwnedTables(adapter, {
            ownedTables: ownership === "preserved" ? ["parents", "children"] : ["parents"],
            preserveTables: ownership === "preserved" ? ["children"] : [],
          }),
        ).rejects.toThrow();

        expect(await adapter.exec("SELECT * FROM parents")).toEqual([{ id: "p" }]);
        expect(await adapter.exec("SELECT * FROM children")).toEqual([{ id: "c", parent_id: "p" }]);
      } finally {
        await adapter.close();
      }
    },
  );

  it.each(["preserved", "unowned"] as const)(
    "rejects recursive cascades reaching a %s grandchild without changing the chain",
    async (ownership) => {
      const adapter = makeAdapter();
      await adapter.open();
      try {
        await adapter.exec("PRAGMA foreign_keys = ON");
        await adapter.runMigrations([
          "CREATE TABLE parents (id TEXT PRIMARY KEY)",
          "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE)",
          "CREATE TABLE grandchildren (id TEXT PRIMARY KEY, child_id TEXT REFERENCES children(id) ON DELETE CASCADE)",
        ]);
        await adapter.exec("INSERT INTO parents VALUES ('p')");
        await adapter.exec("INSERT INTO children VALUES ('c', 'p')");
        await adapter.exec("INSERT INTO grandchildren VALUES ('g', 'c')");

        await expect(
          resetOwnedTables(adapter, {
            ownedTables:
              ownership === "preserved"
                ? ["parents", "children", "grandchildren"]
                : ["parents", "children"],
            preserveTables: ownership === "preserved" ? ["grandchildren"] : [],
          }),
        ).rejects.toThrow();

        expect(await adapter.exec("SELECT * FROM parents")).toEqual([{ id: "p" }]);
        expect(await adapter.exec("SELECT * FROM children")).toEqual([{ id: "c", parent_id: "p" }]);
        expect(await adapter.exec("SELECT * FROM grandchildren")).toEqual([
          { id: "g", child_id: "c" },
        ]);
      } finally {
        await adapter.close();
      }
    },
  );

  it.each([
    ["preserved", "SET NULL"],
    ["unowned", "SET NULL"],
    ["preserved", "SET DEFAULT"],
    ["unowned", "SET DEFAULT"],
  ] as const)(
    "rejects %s child mutation through ON DELETE %s and retains the original foreign key",
    async (ownership, action) => {
      const adapter = makeAdapter();
      await adapter.open();
      try {
        await adapter.exec("PRAGMA foreign_keys = ON");
        await adapter.runMigrations([
          "CREATE TABLE parents (id TEXT PRIMARY KEY)",
          `CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT DEFAULT NULL REFERENCES parents(id) ON DELETE ${action})`,
        ]);
        await adapter.exec("INSERT INTO parents VALUES ('p')");
        await adapter.exec("INSERT INTO children VALUES ('c', 'p')");

        await expect(
          resetOwnedTables(adapter, {
            ownedTables: ownership === "preserved" ? ["parents", "children"] : ["parents"],
            preserveTables: ownership === "preserved" ? ["children"] : [],
          }),
        ).rejects.toThrow();

        expect(await adapter.exec("SELECT * FROM parents")).toEqual([{ id: "p" }]);
        expect(await adapter.exec("SELECT * FROM children")).toEqual([{ id: "c", parent_id: "p" }]);
      } finally {
        await adapter.close();
      }
    },
  );

  it.each(["preserved", "unowned"] as const)(
    "rejects a DELETE trigger updating a %s table and rolls back earlier deletes",
    async (ownership) => {
      const adapter = makeAdapter();
      await adapter.open();
      try {
        await adapter.exec("PRAGMA foreign_keys = ON");
        await adapter.runMigrations([
          "CREATE TABLE earlier (id TEXT PRIMARY KEY)",
          "CREATE TABLE parents (id TEXT PRIMARY KEY)",
          "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
          "CREATE TRIGGER rewrite_notes AFTER DELETE ON parents BEGIN UPDATE notes SET body = 'changed'; END",
        ]);
        await adapter.exec("INSERT INTO earlier VALUES ('e')");
        await adapter.exec("INSERT INTO parents VALUES ('p')");
        await adapter.exec("INSERT INTO notes VALUES ('n', 'original')");

        await expect(
          resetOwnedTables(adapter, {
            ownedTables:
              ownership === "preserved" ? ["earlier", "parents", "notes"] : ["earlier", "parents"],
            preserveTables: ownership === "preserved" ? ["notes"] : [],
          }),
        ).rejects.toThrow();

        expect(await adapter.exec("SELECT * FROM earlier")).toEqual([{ id: "e" }]);
        expect(await adapter.exec("SELECT * FROM parents")).toEqual([{ id: "p" }]);
        expect(await adapter.exec("SELECT * FROM notes")).toEqual([{ id: "n", body: "original" }]);
      } finally {
        await adapter.close();
      }
    },
  );

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
    await expect(resetOwnedTables(adapter, { ownedTables: ["_SYNC_state"] })).rejects.toThrow(
      "Reserved metadata table",
    );
    await expect(
      resetOwnedTables(adapter, {
        ownedTables: ["notes"],
        preserveTables: ["notes", "NOTES"],
      }),
    ).rejects.toThrow("duplicate table");
    await expect(
      resetOwnedTables(adapter, { ownedTables: ["safe"], preserveTables: ["other"] }),
    ).rejects.toThrow("is not an owned table");
    expect(transaction).not.toHaveBeenCalled();
    await adapter.close();
  });
});
