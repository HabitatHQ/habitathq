import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapacitorSqliteAdapter } from "../adapter.js";
import type { SQLiteConnection, SQLiteDBConnection } from "../types.js";

function createMockDb(): SQLiteDBConnection {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ values: [] }),
    run: vi.fn().mockResolvedValue({ changes: { changes: 0, lastId: 0 } }),
    execute: vi.fn().mockResolvedValue({ changes: { changes: 0, lastId: 0 } }),
    beginTransaction: vi.fn().mockResolvedValue({ changes: { changes: 0 } }),
    commitTransaction: vi.fn().mockResolvedValue({ changes: { changes: 0 } }),
    rollbackTransaction: vi.fn().mockResolvedValue({ changes: { changes: 0 } }),
  };
}

function createMockConn(db: SQLiteDBConnection): SQLiteConnection {
  return {
    checkConnectionsConsistency: vi.fn().mockResolvedValue({ result: true }),
    isConnection: vi.fn().mockResolvedValue({ result: false }),
    createConnection: vi.fn().mockResolvedValue(db),
    retrieveConnection: vi.fn().mockResolvedValue(db),
    closeConnection: vi.fn().mockResolvedValue(undefined),
  };
}

describe("CapacitorSqliteAdapter", () => {
  let mockDb: SQLiteDBConnection;
  let mockConn: SQLiteConnection;
  let adapter: CapacitorSqliteAdapter;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockConn = createMockConn(mockDb);
    adapter = new CapacitorSqliteAdapter(mockConn, { dbName: "test" });
    await adapter.open();
  });

  describe("open", () => {
    it("creates a new connection when none exists", () => {
      expect(mockConn.createConnection).toHaveBeenCalledWith(
        "test",
        false,
        "no-encryption",
        1,
        false,
      );
      expect(mockDb.open).toHaveBeenCalled();
    });

    it("retrieves existing connection when available", async () => {
      const db2 = createMockDb();
      const conn2 = createMockConn(db2);
      (conn2.isConnection as ReturnType<typeof vi.fn>).mockResolvedValue({ result: true });

      const adapter2 = new CapacitorSqliteAdapter(conn2, { dbName: "existing" });
      await adapter2.open();

      expect(conn2.retrieveConnection).toHaveBeenCalledWith("existing", false);
      expect(conn2.createConnection).not.toHaveBeenCalled();
    });

    it("throws when used before open", async () => {
      const closed = new CapacitorSqliteAdapter(mockConn, { dbName: "nope" });
      await expect(() => closed.exec("SELECT 1")).rejects.toThrow("call open()");
    });
  });

  describe("exec — SQL routing", () => {
    it("routes SELECT to query()", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        values: [{ id: "1", name: "test" }],
      });

      const rows = await adapter.exec("SELECT * FROM tasks");
      expect(mockDb.query).toHaveBeenCalledWith("SELECT * FROM tasks", []);
      expect(rows).toEqual([{ id: "1", name: "test" }]);
      expect(mockDb.run).not.toHaveBeenCalled();
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("routes PRAGMA to query()", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        values: [{ user_version: 5 }],
      });

      const rows = await adapter.exec("PRAGMA user_version");
      expect(mockDb.query).toHaveBeenCalledWith("PRAGMA user_version", []);
      expect(rows).toEqual([{ user_version: 5 }]);
    });

    it("routes SELECT with leading whitespace to query()", async () => {
      await adapter.exec("  SELECT 1");
      expect(mockDb.query).toHaveBeenCalled();
    });

    it("routes EXPLAIN to query()", async () => {
      await adapter.exec("EXPLAIN SELECT 1");
      expect(mockDb.query).toHaveBeenCalled();
    });

    it("routes DML with params to run()", async () => {
      await adapter.exec("INSERT INTO tasks (id, name) VALUES (?, ?)", ["1", "test"]);
      expect(mockDb.run).toHaveBeenCalledWith(
        "INSERT INTO tasks (id, name) VALUES (?, ?)",
        ["1", "test"],
        false,
      );
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("routes UPDATE with params to run()", async () => {
      await adapter.exec("UPDATE tasks SET name = ? WHERE id = ?", ["new", "1"]);
      expect(mockDb.run).toHaveBeenCalledWith(
        "UPDATE tasks SET name = ? WHERE id = ?",
        ["new", "1"],
        false,
      );
    });

    it("routes DDL without params to execute()", async () => {
      await adapter.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY)");
      expect(mockDb.execute).toHaveBeenCalledWith(
        "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY)",
        false,
      );
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockDb.run).not.toHaveBeenCalled();
    });

    it("routes DML without params to execute()", async () => {
      await adapter.exec("DELETE FROM tasks");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM tasks", false);
    });

    it("routes PRAGMA SET without params to query()", async () => {
      await adapter.exec("PRAGMA user_version = 5");
      expect(mockDb.query).toHaveBeenCalled();
    });

    it("returns empty array for non-read statements", async () => {
      const result = await adapter.exec("INSERT INTO tasks (id) VALUES (?)", ["1"]);
      expect(result).toEqual([]);
    });
  });

  describe("put", () => {
    it("generates INSERT OR REPLACE via run()", async () => {
      await adapter.put("tasks", "1", { id: "1", name: "test" });
      expect(mockDb.run).toHaveBeenCalledWith(
        "INSERT OR REPLACE INTO tasks (id, name) VALUES (?, ?)",
        ["1", "test"],
        false,
      );
    });

    it("rejects invalid table names", async () => {
      await expect(adapter.put("bad table", "1", { id: "1" })).rejects.toThrow(
        "Invalid SQL identifier",
      );
    });

    it("no-ops for empty data", async () => {
      await adapter.put("tasks", "1", {});
      expect(mockDb.run).not.toHaveBeenCalled();
    });
  });

  describe("patch", () => {
    it("generates UPDATE via run()", async () => {
      await adapter.patch("tasks", "1", { name: "updated" });
      expect(mockDb.run).toHaveBeenCalledWith(
        "UPDATE tasks SET name = ? WHERE id = ?",
        ["updated", "1"],
        false,
      );
    });

    it("no-ops for empty patch", async () => {
      await adapter.patch("tasks", "1", {});
      expect(mockDb.run).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("generates DELETE via run()", async () => {
      await adapter.remove("tasks", "1");
      expect(mockDb.run).toHaveBeenCalledWith("DELETE FROM tasks WHERE id = ?", ["1"], false);
    });
  });

  describe("runMigrations", () => {
    it("executes each migration via execute()", async () => {
      await adapter.runMigrations(["CREATE TABLE a (id TEXT)", "CREATE TABLE b (id TEXT)"]);
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
      expect(mockDb.execute).toHaveBeenCalledWith("CREATE TABLE a (id TEXT)", false);
      expect(mockDb.execute).toHaveBeenCalledWith("CREATE TABLE b (id TEXT)", false);
    });
  });

  describe("transaction", () => {
    it("calls begin/commit on success", async () => {
      const result = await adapter.transaction(async (_tx) => "ok");
      expect(result).toBe("ok");
      expect(mockDb.beginTransaction).toHaveBeenCalled();
      expect(mockDb.commitTransaction).toHaveBeenCalled();
      expect(mockDb.rollbackTransaction).not.toHaveBeenCalled();
    });

    it("calls begin/rollback on error", async () => {
      await expect(
        adapter.transaction(async () => {
          throw new Error("fail");
        }),
      ).rejects.toThrow("fail");
      expect(mockDb.beginTransaction).toHaveBeenCalled();
      expect(mockDb.rollbackTransaction).toHaveBeenCalled();
      expect(mockDb.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe("public transaction methods", () => {
    it("exposes beginTransaction", async () => {
      await adapter.beginTransaction();
      expect(mockDb.beginTransaction).toHaveBeenCalled();
    });

    it("exposes commitTransaction", async () => {
      await adapter.commitTransaction();
      expect(mockDb.commitTransaction).toHaveBeenCalled();
    });

    it("exposes rollbackTransaction", async () => {
      await adapter.rollbackTransaction();
      expect(mockDb.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe("close", () => {
    it("closes connection", async () => {
      await adapter.close();
      expect(mockConn.closeConnection).toHaveBeenCalledWith("test", false);
    });

    it("no-ops on double close", async () => {
      await adapter.close();
      await adapter.close();
      expect(mockConn.closeConnection).toHaveBeenCalledTimes(1);
    });
  });
});
