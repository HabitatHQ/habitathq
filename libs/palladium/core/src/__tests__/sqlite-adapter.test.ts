/**
 * SqliteAdapter unit tests.
 *
 * Tests the coerce() behaviour (via adapter methods), the early-return in
 * _patch for empty patches, and general CRUD round-trips.
 */
import { describe, expect, it } from "vitest";
import { SqliteAdapter } from "../sqlite-adapter.js";

const MIGRATION = "CREATE TABLE items (id TEXT PRIMARY KEY, val ANY, flag INTEGER)";

function makeAdapter(): SqliteAdapter {
  const adapter = new SqliteAdapter();
  void adapter.runMigrations([MIGRATION]);
  return adapter;
}

describe("SqliteAdapter", () => {
  it("stores and retrieves a plain string value", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: "hello", flag: 0 });
    const rows = await adapter.exec<{ id: string; val: string }>("SELECT * FROM items");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.val).toBe("hello");
  });

  it("coerces boolean true to integer 1", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: 0, flag: true });
    const rows = await adapter.exec<{ id: string; flag: number }>("SELECT * FROM items");
    expect(rows[0]?.flag).toBe(1);
  });

  it("coerces boolean false to integer 0", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: 0, flag: false });
    const rows = await adapter.exec<{ id: string; flag: number }>("SELECT * FROM items");
    expect(rows[0]?.flag).toBe(0);
  });

  it("coerces null to SQL NULL", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: null, flag: 0 });
    const rows = await adapter.exec<{ id: string; val: null }>("SELECT * FROM items");
    expect(rows[0]?.val).toBeNull();
  });

  it("coerces undefined to SQL NULL", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: undefined, flag: 0 });
    const rows = await adapter.exec<{ id: string; val: null }>("SELECT * FROM items");
    expect(rows[0]?.val).toBeNull();
  });

  it("passes numbers through unchanged", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: 42, flag: 0 });
    const rows = await adapter.exec<{ id: string; val: number }>("SELECT * FROM items");
    expect(rows[0]?.val).toBe(42);
  });

  it("passes bigint through unchanged", async () => {
    const adapter = new SqliteAdapter();
    await adapter.runMigrations(["CREATE TABLE nums (id TEXT PRIMARY KEY, val INTEGER)"]);
    adapter._put("nums", "n1", { id: "n1", val: BigInt(42) });
    const rows = await adapter.exec<{ id: string; val: number }>("SELECT * FROM nums");
    expect(rows[0]?.val).toBe(42);
  });

  it("coerces plain objects to their string representation", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: { nested: true }, flag: 0 });
    const rows = await adapter.exec<{ id: string; val: string }>("SELECT * FROM items");
    expect(typeof rows[0]?.val).toBe("string");
  });

  it("_patch with an empty object is a no-op (no SQL error)", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: "original", flag: 0 });
    // Must not throw even though there are no SET clauses.
    expect(() => adapter._patch("items", "i1", {})).not.toThrow();
    const rows = await adapter.exec<{ val: string }>("SELECT * FROM items");
    expect(rows[0]?.val).toBe("original");
  });

  it("_patch updates only specified fields", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: "old", flag: 0 });
    adapter._patch("items", "i1", { val: "new" });
    const rows = await adapter.exec<{ val: string; flag: number }>("SELECT * FROM items");
    expect(rows[0]?.val).toBe("new");
    expect(rows[0]?.flag).toBe(0); // unchanged
  });

  it("_patch updates multiple fields at once (comma-separated SET clauses)", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: "old", flag: 0 });
    adapter._patch("items", "i1", { val: "new", flag: 1 });
    const rows = await adapter.exec<{ val: string; flag: number }>("SELECT * FROM items");
    expect(rows[0]?.val).toBe("new");
    expect(rows[0]?.flag).toBe(1);
  });

  it("_patch coerces boolean values (e.g. flag: true → 1)", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: "v", flag: 0 });
    adapter._patch("items", "i1", { flag: true });
    const rows = await adapter.exec<{ flag: number }>("SELECT * FROM items");
    expect(rows[0]?.flag).toBe(1);
  });

  it("_remove deletes the row", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: "x", flag: 0 });
    adapter._remove("items", "i1");
    const rows = await adapter.exec("SELECT * FROM items");
    expect(rows).toHaveLength(0);
  });

  it("exec with parameterised WHERE returns only matching row", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: "a", flag: 0 });
    adapter._put("items", "i2", { id: "i2", val: "b", flag: 0 });
    const rows = await adapter.exec<{ id: string }>("SELECT * FROM items WHERE id = ?", ["i1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("i1");
  });

  it("_put uses INSERT OR REPLACE (upsert behaviour)", async () => {
    const adapter = makeAdapter();
    adapter._put("items", "i1", { id: "i1", val: "old", flag: 0 });
    adapter._put("items", "i1", { id: "i1", val: "new", flag: 1 });
    const rows = await adapter.exec<{ val: string }>("SELECT * FROM items");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.val).toBe("new");
  });

  it("close() resolves without error", async () => {
    const adapter = makeAdapter();
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it("exec() throws after close()", async () => {
    const adapter = makeAdapter();
    await adapter.close();
    await expect(adapter.exec("SELECT * FROM items")).rejects.toThrow();
  });

  it("runMigrations runs multiple migrations in order", async () => {
    const adapter = new SqliteAdapter();
    await adapter.runMigrations([
      "CREATE TABLE a (id TEXT PRIMARY KEY)",
      "CREATE TABLE b (id TEXT PRIMARY KEY)",
    ]);
    adapter._put("a", "x", { id: "x" });
    adapter._put("b", "y", { id: "y" });
    const ra = await adapter.exec<{ id: string }>("SELECT * FROM a");
    const rb = await adapter.exec<{ id: string }>("SELECT * FROM b");
    expect(ra[0]?.id).toBe("x");
    expect(rb[0]?.id).toBe("y");
  });
});
