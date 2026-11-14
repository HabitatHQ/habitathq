/**
 * NodeSqliteAdapter unit tests.
 *
 * Tests the coerce() behaviour (via adapter methods), the early-return in
 * patch for empty patches, transactions, and general CRUD round-trips.
 */

import type { StorageAdapter } from "@palladium/core";
import { describe, expect, it } from "vitest";
import { NodeSqliteAdapter } from "../adapter.js";

const MIGRATION = "CREATE TABLE items (id TEXT PRIMARY KEY, val ANY, flag INTEGER)";

async function makeAdapter(): Promise<NodeSqliteAdapter> {
  const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
  await adapter.open();
  await adapter.runMigrations([MIGRATION]);
  return adapter;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("NodeSqliteAdapter", () => {
  it("stores and retrieves a plain string value", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: "hello", flag: 0 });
    const rows = await adapter.exec<{ id: string; val: string }>("SELECT * FROM items");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.val).toBe("hello");
  });

  it("coerces boolean true to integer 1", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: 0, flag: true });
    const rows = await adapter.exec<{ id: string; flag: number }>("SELECT * FROM items");
    expect(rows[0]?.flag).toBe(1);
  });

  it("coerces boolean false to integer 0", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: 0, flag: false });
    const rows = await adapter.exec<{ id: string; flag: number }>("SELECT * FROM items");
    expect(rows[0]?.flag).toBe(0);
  });

  it("coerces null to SQL NULL", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: null, flag: 0 });
    const rows = await adapter.exec<{ id: string; val: null }>("SELECT * FROM items");
    expect(rows[0]?.val).toBeNull();
  });

  it("coerces undefined to SQL NULL", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: undefined, flag: 0 });
    const rows = await adapter.exec<{ id: string; val: null }>("SELECT * FROM items");
    expect(rows[0]?.val).toBeNull();
  });

  it("passes numbers through unchanged", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: 42, flag: 0 });
    const rows = await adapter.exec<{ id: string; val: number }>("SELECT * FROM items");
    expect(rows[0]?.val).toBe(42);
  });

  it("passes bigint through unchanged", async () => {
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    await adapter.open();
    await adapter.runMigrations(["CREATE TABLE nums (id TEXT PRIMARY KEY, val INTEGER)"]);
    await adapter.put("nums", "n1", { id: "n1", val: BigInt(42) });
    const rows = await adapter.exec<{ id: string; val: number }>("SELECT * FROM nums");
    expect(rows[0]?.val).toBe(42);
  });

  it("rejects nested values before writing", async () => {
    const adapter = await makeAdapter();
    await expect(
      adapter.put("items", "i1", { id: "i1", val: { nested: true }, flag: 0 }),
    ).rejects.toThrow("SQLite column values must be scalar");
    const rows = await adapter.exec<{ id: string }>("SELECT * FROM items");
    expect(rows).toEqual([]);

    await adapter.put("items", "i1", { id: "i1", val: "original", flag: 0 });
    await expect(adapter.patch("items", "i1", { val: { nested: true } })).rejects.toThrow(
      "SQLite column values must be scalar",
    );
    expect(await adapter.exec<{ val: string }>("SELECT val FROM items")).toEqual([
      { val: "original" },
    ]);
  });

  it("patch with an empty object is a no-op (no SQL error)", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: "original", flag: 0 });
    await expect(adapter.patch("items", "i1", {})).resolves.toBeUndefined();
    const rows = await adapter.exec<{ val: string }>("SELECT * FROM items");
    expect(rows[0]?.val).toBe("original");
  });

  it("patch updates only specified fields", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: "old", flag: 0 });
    await adapter.patch("items", "i1", { val: "new" });
    const rows = await adapter.exec<{ val: string; flag: number }>("SELECT * FROM items");
    expect(rows[0]?.val).toBe("new");
    expect(rows[0]?.flag).toBe(0); // unchanged
  });

  it("patch updates multiple fields at once", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: "old", flag: 0 });
    await adapter.patch("items", "i1", { val: "new", flag: 1 });
    const rows = await adapter.exec<{ val: string; flag: number }>("SELECT * FROM items");
    expect(rows[0]?.val).toBe("new");
    expect(rows[0]?.flag).toBe(1);
  });

  it("patch coerces boolean values (e.g. flag: true → 1)", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: "v", flag: 0 });
    await adapter.patch("items", "i1", { flag: true });
    const rows = await adapter.exec<{ flag: number }>("SELECT * FROM items");
    expect(rows[0]?.flag).toBe(1);
  });

  it("remove deletes the row", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: "x", flag: 0 });
    await adapter.remove("items", "i1");
    const rows = await adapter.exec("SELECT * FROM items");
    expect(rows).toHaveLength(0);
  });

  it("exec with parameterised WHERE returns only matching row", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: "a", flag: 0 });
    await adapter.put("items", "i2", { id: "i2", val: "b", flag: 0 });
    const rows = await adapter.exec<{ id: string }>("SELECT * FROM items WHERE id = ?", ["i1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("i1");
  });

  it("put uses INSERT OR REPLACE (upsert behaviour)", async () => {
    const adapter = await makeAdapter();
    await adapter.put("items", "i1", { id: "i1", val: "old", flag: 0 });
    await adapter.put("items", "i1", { id: "i1", val: "new", flag: 1 });
    const rows = await adapter.exec<{ val: string }>("SELECT * FROM items");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.val).toBe("new");
  });

  it("preserves the active database on repeated opens and opens fresh after close", async () => {
    const adapter = await makeAdapter();
    try {
      await adapter.put("items", "i1", { id: "i1", val: "retained", flag: 1 });
      await Promise.all([adapter.open(), adapter.open()]);
      expect(await adapter.exec("SELECT * FROM items")).toEqual([
        { id: "i1", val: "retained", flag: 1 },
      ]);

      await adapter.close();
      await adapter.open();
      expect(
        await adapter.exec(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'",
        ),
      ).toEqual([]);
    } finally {
      await adapter.close();
    }
  });

  it("close() resolves without error", async () => {
    const adapter = await makeAdapter();
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it("exec() throws after close()", async () => {
    const adapter = await makeAdapter();
    await adapter.close();
    await expect(adapter.exec("SELECT * FROM items")).rejects.toThrow();
  });

  it("runMigrations runs multiple migrations in order", async () => {
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    await adapter.open();
    await adapter.runMigrations([
      "CREATE TABLE a (id TEXT PRIMARY KEY)",
      "CREATE TABLE b (id TEXT PRIMARY KEY)",
    ]);
    await adapter.put("a", "x", { id: "x" });
    await adapter.put("b", "y", { id: "y" });
    const ra = await adapter.exec<{ id: string }>("SELECT * FROM a");
    const rb = await adapter.exec<{ id: string }>("SELECT * FROM b");
    expect(ra[0]?.id).toBe("x");
    expect(rb[0]?.id).toBe("y");
  });

  it("transaction commits on success", async () => {
    const adapter = await makeAdapter();
    await adapter.transaction(async (tx) => {
      await tx.put("items", "i1", { id: "i1", val: "a", flag: 0 });
      await tx.put("items", "i2", { id: "i2", val: "b", flag: 0 });
    });
    const rows = await adapter.exec("SELECT * FROM items");
    expect(rows).toHaveLength(2);
  });

  it("transaction rolls back on error", async () => {
    const adapter = await makeAdapter();
    await expect(
      adapter.transaction(async (tx) => {
        await tx.put("items", "i1", { id: "i1", val: "a", flag: 0 });
        throw new Error("oops");
      }),
    ).rejects.toThrow("oops");
    const rows = await adapter.exec("SELECT * FROM items");
    expect(rows).toHaveLength(0);
  });

  it("keeps concurrent direct writes out of a rolled-back transaction", async () => {
    const adapter = await makeAdapter();
    const entered = deferred();
    const release = deferred();
    const transaction = adapter.transaction(async (tx) => {
      await tx.put("items", "inside", { id: "inside", val: "rollback", flag: 0 });
      entered.resolve();
      await release.promise;
      throw new Error("rollback");
    });
    const rejected = expect(transaction).rejects.toThrow("rollback");
    await entered.promise;
    const outside = adapter.put("items", "outside", { id: "outside", val: "keep", flag: 1 });
    release.resolve();
    await rejected;
    await outside;
    expect(await adapter.exec("SELECT * FROM items")).toEqual([
      { id: "outside", val: "keep", flag: 1 },
    ]);
    await adapter.close();
  });

  it("serializes overlapping transactions and expires their scoped handles", async () => {
    const adapter = await makeAdapter();
    const entered = deferred();
    const release = deferred();
    let escaped: StorageAdapter | undefined;
    const first = adapter.transaction(async (tx) => {
      escaped = tx;
      await tx.put("items", "i1", { id: "i1", val: "first", flag: 0 });
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const second = adapter.transaction(async (tx) => {
      expect(await tx.exec("SELECT val FROM items WHERE id = 'i1'")).toEqual([{ val: "first" }]);
      await tx.patch("items", "i1", { val: "second" });
    });
    release.resolve();
    await Promise.all([first, second]);
    expect(await adapter.exec("SELECT val FROM items")).toEqual([{ val: "second" }]);
    if (escaped === undefined) throw new Error("transaction callback did not run");
    await expect(escaped.remove("items", "i1")).rejects.toThrow("already settled");
    expect(await adapter.exec("SELECT val FROM items")).toEqual([{ val: "second" }]);
    await adapter.close();
  });

  it("throws on open() before exec()", async () => {
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    // Not calling open() — should throw
    await expect(adapter.exec("SELECT 1")).rejects.toThrow("open()");
  });
});

it("upserts a parent without cascading deletion of its children", async () => {
  const adapter = new NodeSqliteAdapter();
  await adapter.open();
  await adapter.exec("PRAGMA foreign_keys = ON");
  await adapter.runMigrations([
    "CREATE TABLE parents (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
    "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE)",
  ]);
  await adapter.put("parents", "p", { id: "p", name: "old" });
  await adapter.put("children", "c", { id: "c", parent_id: "p" });
  await adapter.put("parents", "p", { id: "p", name: "new" });
  expect(await adapter.exec("SELECT id FROM children")).toEqual([{ id: "c" }]);
  expect(await adapter.exec("SELECT name FROM parents")).toEqual([{ name: "new" }]);
  await adapter.close();
});
