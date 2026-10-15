import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type * as SqliteModule from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof SqliteModule;

/** Compatible connection backed by SQLite, not canned query responses. */
function createSqliteDb(sqlite: SqliteModule.DatabaseSync): SQLiteDBConnection {
  return {
    async open() {},
    async query(sql, values = []) {
      return { values: sqlite.prepare(sql).all(...(values as SqliteModule.SQLInputValue[])) };
    },
    async run(sql, values, _transaction, returnMode) {
      const wantsReturning = Boolean(returnMode) && /\bRETURNING\b/i.test(sql);
      const stmt = sqlite.prepare(sql);
      const params = (values ?? []) as SqliteModule.SQLInputValue[];
      if (wantsReturning) {
        // node:sqlite's Statement.all() executes the statement and returns
        // rows in a single call. For INSERT/UPDATE/DELETE ... RETURNING this
        // performs the write exactly once and yields the RETURNING rows.
        const returned = stmt.all(...params);
        return {
          changes: {
            values: returned,
          },
        };
      }
      const result = stmt.run(...params);
      return {
        changes: {
          changes: Number(result.changes),
          lastId: Number(result.lastInsertRowid),
        },
      };
    },
    async execute(sql) {
      sqlite.exec(sql);
      return {};
    },
    async beginTransaction() {
      sqlite.exec("BEGIN");
      return {};
    },
    async commitTransaction() {
      sqlite.exec("COMMIT");
      return {};
    },
    async rollbackTransaction() {
      sqlite.exec("ROLLBACK");
      return {};
    },
  };
}

describe("CapacitorSqliteAdapter SQL results", () => {
  let sqlite: SqliteModule.DatabaseSync;
  let adapter: CapacitorSqliteAdapter;

  beforeEach(async () => {
    sqlite = new DatabaseSync(":memory:");
    adapter = new CapacitorSqliteAdapter(createMockConn(createSqliteDb(sqlite)), {
      dbName: "sql-results",
    });
    await adapter.open();
    sqlite.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");
  });

  afterEach(async () => {
    await adapter.close();
    sqlite.close();
  });

  it.each([
    ["plain SELECT", "SELECT 7 AS n", []],
    ["block comment", "/* report SELECT RETURNING */ SELECT 7 AS n", []],
    ["line comment", "-- report\r\nSELECT ? AS n", [7]],
    ["consecutive comments", " \n/* report */ -- details\n SELECT ? AS n", [7]],
    ["CTE", "WITH c AS (SELECT 7 AS n) SELECT n FROM c", []],
    ["bound CTE", "WITH c AS (SELECT ? AS n) SELECT n FROM c", [7]],
    [
      "multiple quoted CTEs",
      'WITH "select"(n) AS (SELECT ?), [update] AS (SELECT n FROM "select") SELECT n FROM [update]',
      [7],
    ],
    [
      "recursive CTE",
      "WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM c WHERE n < ?) SELECT sum(n) + 1 AS n FROM c",
      [3],
    ],
    [
      "materialized CTE with nested expressions",
      "/* CTE */ WITH c AS NOT MATERIALIZED (SELECT (SELECT ?) AS n) SELECT n FROM c",
      [7],
    ],
    ["VALUES", "VALUES (7)", []],
    ["bound VALUES", "/* result */ VALUES (?)", [7]],
  ] as const)("returns actual rows for %s", async (_name, sql, params) => {
    const expected = sqlite.prepare(sql).all(...params);
    expect(expected).toEqual([
      sql.includes("VALUES (") || sql.includes("VALUES (?)") ? { column1: 7 } : { n: 7 },
    ]);
    expect(await adapter.exec(sql, params)).toEqual(expected);
  });

  it("returns rows for lowercase WITH", async () => {
    expect(await adapter.exec("with c as (select ? as n) select n from c", [7])).toEqual([
      { n: 7 },
    ]);
  });

  it("handles CTE strings ending in backslash and escaped quoted identifiers", async () => {
    expect(
      await adapter.exec(
        `WITH "c""name" AS (SELECT 'ends\\' AS value) SELECT value FROM "c""name"`,
      ),
    ).toEqual([{ value: "ends\\" }]);
  });

  it("executes a complete CTE command script whose last statement is a SELECT", async () => {
    expect(
      await adapter.exec(
        "WITH c AS (SELECT 1 AS id) INSERT INTO items SELECT id, 'saved' FROM c; SELECT 42 AS n",
      ),
    ).toEqual([]);
    expect(sqlite.prepare("SELECT id, value FROM items").all()).toEqual([
      { id: 1, value: "saved" },
    ]);
  });

  it.each([
    ["INSERT", "INSERT INTO items(id, value) VALUES (1, 'new') RETURNING id, value", []],
    ["bound INSERT", "INSERT INTO items(id, value) VALUES (?, ?) RETURNING id, value", [1, "new"]],
    ["UPDATE", "UPDATE items SET value = 'new' WHERE id = 1 RETURNING id, value", []],
    ["bound UPDATE", "UPDATE items SET value = ? WHERE id = ? RETURNING id, value", ["new", 1]],
    ["DELETE", "DELETE FROM items WHERE id = 1 RETURNING id, value", []],
    ["bound DELETE", "DELETE FROM items WHERE id = ? RETURNING id, value", [1]],
    [
      "CTE INSERT",
      "WITH c AS (SELECT ? AS id, ? AS value) INSERT INTO items SELECT id, value FROM c RETURNING id, value",
      [1, "new"],
    ],
    [
      "CTE UPDATE",
      "WITH c AS (SELECT ? AS value) UPDATE items SET value = (SELECT value FROM c) WHERE id = ? RETURNING id, value",
      ["new", 1],
    ],
    [
      "CTE DELETE",
      "-- delete selected\nWITH c AS (SELECT ? AS id) DELETE FROM items WHERE id IN (SELECT id FROM c) RETURNING id, value",
      [1],
    ],
  ] as const)("preserves %s RETURNING rows and the mutation", async (name, sql, params) => {
    const isInsert = name.includes("INSERT");
    const isDelete = name.includes("DELETE");
    if (!isInsert) sqlite.exec("INSERT INTO items VALUES (1, 'old')");

    expect(await adapter.exec(sql, params)).toEqual([{ id: 1, value: isDelete ? "old" : "new" }]);
    expect(sqlite.prepare("SELECT id, value FROM items").all()).toEqual(
      isDelete ? [] : [{ id: 1, value: "new" }],
    );
  });

  it.each([false, true])("executes CTE commands with bindings=%s", async (bound) => {
    const value = "'RETURNING SELECT ( ) -- /* ''quoted'''";
    const select = bound ? "SELECT ? AS value" : `SELECT ${value} AS value`;
    const params = bound ? ["RETURNING SELECT ( ) -- /* 'quoted'"] : [];
    expect(
      await adapter.exec(`WITH c AS (${select}) INSERT INTO items SELECT 1, value FROM c`, params),
    ).toEqual([]);
    expect(
      await adapter.exec(
        "WITH c AS (SELECT 1 AS id) UPDATE items SET value = 'updated' WHERE id IN (SELECT id FROM c)",
      ),
    ).toEqual([]);
    expect(sqlite.prepare("SELECT id, value FROM items").all()).toEqual([
      { id: 1, value: "updated" },
    ]);
    expect(
      await adapter.exec(
        "WITH c AS (SELECT 1 AS id) DELETE FROM items WHERE id IN (SELECT id FROM c)",
      ),
    ).toEqual([]);
    expect(sqlite.prepare("SELECT id, value FROM items").all()).toEqual([]);
  });

  it("executes the whole command script after a leading CTE", async () => {
    expect(
      await adapter.exec(`
        WITH c AS (SELECT 1 AS id) INSERT INTO items SELECT id, 'first' FROM c;
        UPDATE items SET value = 'second' WHERE id = 1;
        INSERT INTO items VALUES (2, 'third');
      `),
    ).toEqual([]);
    expect(sqlite.prepare("SELECT id, value FROM items ORDER BY id").all()).toEqual([
      { id: 1, value: "second" },
      { id: 2, value: "third" },
    ]);
  });

  it("does not mistake quoted identifiers or comments for RETURNING", async () => {
    sqlite.exec('CREATE TABLE keywords ("returning" TEXT, [select] TEXT, `update` TEXT)');
    expect(
      await adapter.exec(
        '/* RETURNING */ INSERT INTO keywords ("returning", [select], `update`) VALUES (?, ?, ?)',
        ["RETURNING", "SELECT", "UPDATE"],
      ),
    ).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM keywords").all()).toEqual([
      { returning: "RETURNING", select: "SELECT", update: "UPDATE" },
    ]);
  });

  it("rolls back row-producing writes with their transaction", async () => {
    await expect(
      adapter.transaction(async (tx) => {
        expect(
          await tx.exec(
            "WITH c AS (SELECT ? AS value) INSERT INTO items SELECT 1, value FROM c RETURNING id, value",
            ["transient"],
          ),
        ).toEqual([{ id: 1, value: "transient" }]);
        throw new Error("abort SQL result transaction");
      }),
    ).rejects.toThrow("abort SQL result transaction");
    expect(sqlite.prepare("SELECT id, value FROM items").all()).toEqual([]);
  });
});

interface DeferredSignal {
  promise: Promise<void>;
  resolve: () => void;
}

interface OpeningGate {
  entered: DeferredSignal;
  released: DeferredSignal;
}

interface LifecycleFixture {
  connection: SQLiteConnection;
  db: SQLiteDBConnection;
  readonly activeHandles: number;
  closePhysical(): void;
  failOpening(): void;
  holdOpening(): { entered: Promise<void>; release: () => void };
  dispose(): void;
}

function deferredSignal(): DeferredSignal {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Each physical open allocates a real SQLite handle; replacing it leaks the old one. */
function createLifecycleFixture(withOpenState = true): LifecycleFixture {
  const directory = mkdtempSync(join(import.meta.dirname, ".open-lifecycle-"));
  const databasePath = join(directory, "database.sqlite");
  const handles = new Set<SqliteModule.DatabaseSync>();
  let current: SqliteModule.DatabaseSync | null = null;
  let registered = false;
  let failNextOpen = false;
  let gate: OpeningGate | null = null;

  const db: SQLiteDBConnection & { isDBOpen?: () => Promise<{ result: boolean }> } = {
    async open() {
      const pendingGate = gate;
      gate = null;
      if (pendingGate !== null) {
        pendingGate.entered.resolve();
        await pendingGate.released.promise;
      }
      if (failNextOpen) {
        failNextOpen = false;
        throw new Error("Physical SQLite open failed");
      }
      current = new DatabaseSync(databasePath);
      handles.add(current);
    },
    async delete() {
      rmSync(databasePath, { force: true });
    },
    async query(sql, values = []) {
      if (current === null) throw new Error("Physical SQLite handle is closed");
      return { values: current.prepare(sql).all(...(values as SqliteModule.SQLInputValue[])) };
    },
    async run(sql, values, _transaction, returnMode) {
      if (current === null) throw new Error("Physical SQLite handle is closed");
      const wantsReturning = Boolean(returnMode) && /\bRETURNING\b/i.test(sql);
      const stmt = current.prepare(sql);
      const params = (values ?? []) as SqliteModule.SQLInputValue[];
      if (wantsReturning) return { changes: { values: stmt.all(...params) } };
      const result = stmt.run(...params);
      return {
        changes: {
          changes: Number(result.changes),
          lastId: Number(result.lastInsertRowid),
        },
      };
    },
    async execute(sql) {
      if (current === null) throw new Error("Physical SQLite handle is closed");
      current.exec(sql);
      return {};
    },
    async beginTransaction() {
      if (current === null) throw new Error("Physical SQLite handle is closed");
      current.exec("BEGIN");
      return {};
    },
    async commitTransaction() {
      if (current === null) throw new Error("Physical SQLite handle is closed");
      current.exec("COMMIT");
      return {};
    },
    async rollbackTransaction() {
      if (current === null) throw new Error("Physical SQLite handle is closed");
      current.exec("ROLLBACK");
      return {};
    },
  };
  if (withOpenState) db.isDBOpen = async () => ({ result: current !== null });
  const closePhysical = () => {
    if (current !== null) {
      current.close();
      handles.delete(current);
      current = null;
    }
  };
  const connection: SQLiteConnection = {
    async checkConnectionsConsistency() {
      return { result: true };
    },
    async isConnection() {
      return { result: registered };
    },
    async createConnection() {
      registered = true;
      return db;
    },
    async retrieveConnection() {
      return db;
    },
    async closeConnection() {
      closePhysical();
      registered = false;
    },
  };
  return {
    connection,
    db,
    get activeHandles() {
      return handles.size;
    },
    closePhysical,
    failOpening() {
      failNextOpen = true;
    },
    holdOpening() {
      const pendingGate: OpeningGate = { entered: deferredSignal(), released: deferredSignal() };
      gate = pendingGate;
      return { entered: pendingGate.entered.promise, release: pendingGate.released.resolve };
    },
    dispose() {
      for (const handle of handles) handle.close();
      handles.clear();
      current = null;
      rmSync(directory, { recursive: true });
    },
  };
}

describe("CapacitorSqliteAdapter physical open lifecycle", () => {
  let fixture: LifecycleFixture;
  let adapter: CapacitorSqliteAdapter;

  beforeEach(() => {
    fixture = createLifecycleFixture();
    adapter = new CapacitorSqliteAdapter(fixture.connection, { dbName: "lifecycle" });
  });

  afterEach(() => {
    fixture.dispose();
  });

  const createItems = async () => {
    await adapter.exec("CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT)");
  };

  it.each([true, false])(
    "keeps one handle through reset/reseed/open with state API=%s",
    async (state) => {
      if (!state) {
        fixture.dispose();
        fixture = createLifecycleFixture(false);
        adapter = new CapacitorSqliteAdapter(fixture.connection, { dbName: "lifecycle" });
      }
      await adapter.open();
      await createItems();
      for (let cycle = 0; cycle < 3; cycle++) {
        await adapter.put("items", "old", { id: "old", value: `before-${cycle}` });
        await adapter.resetStorage();
        expect(fixture.activeHandles).toBe(1);
        expect(await adapter.exec("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual(
          [],
        );
        await createItems();
        expect(await adapter.exec("SELECT * FROM items")).toEqual([]);
        await adapter.put("items", "seed", { id: "seed", value: `seed-${cycle}` });
        await Promise.all([adapter.open(), adapter.open(), adapter.open()]);
        expect(fixture.activeHandles).toBe(1);
        await adapter.put("items", "written", { id: "written", value: `written-${cycle}` });
        expect(await adapter.exec("SELECT * FROM items ORDER BY id")).toEqual([
          { id: "seed", value: `seed-${cycle}` },
          { id: "written", value: `written-${cycle}` },
        ]);
      }
      await adapter.close();
      expect(fixture.activeHandles).toBe(0);
      await adapter.open();
      expect(fixture.activeHandles).toBe(1);
      expect(await adapter.exec("SELECT * FROM items ORDER BY id")).toEqual([
        { id: "seed", value: "seed-2" },
        { id: "written", value: "written-2" },
      ]);
    },
  );

  it("shares overlapping initial and repeated opens without allocating handles", async () => {
    const held = fixture.holdOpening();
    const opening = adapter.open();
    await held.entered;
    const overlap = Promise.all([adapter.open(), adapter.open()]);
    held.release();
    await Promise.all([opening, overlap]);
    expect(fixture.activeHandles).toBe(1);
    await createItems();
    await adapter.put("items", "one", { id: "one", value: "persisted" });
    await Promise.all([adapter.open(), adapter.open(), adapter.open()]);
    expect(fixture.activeHandles).toBe(1);
    expect(await adapter.exec("SELECT * FROM items")).toEqual([{ id: "one", value: "persisted" }]);
  });

  it("adopts an already-open retrieved connection without replacing its handle", async () => {
    await fixture.connection.createConnection("lifecycle", false, "no-encryption", 1, false);
    await fixture.db.open();
    await fixture.db.execute("CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT)");
    await fixture.db.run("INSERT INTO items VALUES (?, ?)", ["existing", "startup"]);
    await adapter.open();
    expect(fixture.activeHandles).toBe(1);
    expect(await adapter.exec("SELECT * FROM items")).toEqual([
      { id: "existing", value: "startup" },
    ]);
  });

  it("reopens an externally closed handle and retains persisted data", async () => {
    await adapter.open();
    await createItems();
    await adapter.put("items", "one", { id: "one", value: "persisted" });
    fixture.closePhysical();
    expect(fixture.activeHandles).toBe(0);
    await Promise.all([adapter.open(), adapter.open()]);
    expect(fixture.activeHandles).toBe(1);
    expect(await adapter.exec("SELECT * FROM items")).toEqual([{ id: "one", value: "persisted" }]);
  });

  it("does not publish a failed opening and allows concurrent retry", async () => {
    fixture.failOpening();
    await expect(adapter.open()).rejects.toThrow("Physical SQLite open failed");
    expect(fixture.activeHandles).toBe(0);
    await expect(adapter.exec("SELECT 1")).rejects.toThrow();
    await Promise.all([adapter.open(), adapter.open()]);
    expect(fixture.activeHandles).toBe(1);
    await createItems();
    await adapter.put("items", "retry", { id: "retry", value: "ready" });
    expect(await adapter.exec("SELECT * FROM items")).toEqual([{ id: "retry", value: "ready" }]);
  });

  it("waits for an opening before close releases its handle", async () => {
    const held = fixture.holdOpening();
    const opening = adapter.open();
    await held.entered;
    const closing = adapter.close();
    held.release();
    await Promise.all([opening, closing]);
    expect(fixture.activeHandles).toBe(0);
    await expect(adapter.exec("SELECT 1")).rejects.toThrow();
    await adapter.open();
    expect(fixture.activeHandles).toBe(1);
    expect(await adapter.exec("SELECT 42 AS value")).toEqual([{ value: 42 }]);
  });
});

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
function decodeNativeBlob(value: unknown, format: "android-buffer" | "byte-array"): Uint8Array {
  if (format === "byte-array") {
    if (
      Array.isArray(value) &&
      value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ) {
      return Uint8Array.from(value);
    }
    throw new TypeError("Expected native byte array");
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "Buffer" &&
    "data" in value &&
    Array.isArray(value.data) &&
    value.data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return Uint8Array.from(value.data);
  }
  throw new TypeError("Expected native Buffer object");
}

describe("CapacitorSqliteAdapter BLOB bindings", () => {
  it.each(["android-buffer", "byte-array"] as const)(
    "preserves binary content through %s bindings",
    async (blobBindingFormat) => {
      const mockDb = createMockDb();
      let persisted: Uint8Array | null = null;
      vi.mocked(mockDb.run).mockImplementation(async (_sql, values) => {
        persisted = decodeNativeBlob(values?.[0], blobBindingFormat);
        return { changes: { changes: 1 } };
      });
      vi.mocked(mockDb.query).mockImplementation(async () => ({
        values: [{ data: Array.from(persisted ?? []) }],
      }));

      const storage = new CapacitorSqliteAdapter(createMockConn(mockDb), {
        dbName: "binary",
        blobBindingFormat,
      });
      await storage.open();
      const expected = new Uint8Array([0, 127, 128, 255, 1]);
      await storage.exec("INSERT INTO media(data) VALUES (?)", [expected]);
      const [row] = await storage.exec<{ data: number[] }>("SELECT data FROM media");

      expect(row?.data).toEqual(Array.from(expected));
      expect(Uint8Array.from(row?.data ?? [])).toEqual(expected);
    },
  );
});
