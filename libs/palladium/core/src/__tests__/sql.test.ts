import { describe, expect, it } from "vitest";
import { sql } from "../sql.js";

describe("sql tag", () => {
  it("returns a SqlQuery with text and params", () => {
    const q = sql`SELECT * FROM tasks WHERE id = ${"abc"} AND done = ${true}`;
    expect(q.text).toBe("SELECT * FROM tasks WHERE id = ? AND done = ?");
    expect(q.params).toEqual(["abc", true]);
  });

  it("handles no params", () => {
    const q = sql`SELECT 1`;
    expect(q.text).toBe("SELECT 1");
    expect(q.params).toEqual([]);
  });

  it("can be composed via sql.join", () => {
    const clauses = [sql`a = ${1}`, sql`b = ${2}`];
    const q = sql.join(clauses, " AND ");
    expect(q.text).toBe("a = ? AND b = ?");
    expect(q.params).toEqual([1, 2]);
  });

  it("sql.join with a single query returns that query unchanged", () => {
    const q = sql.join([sql`x = ${99}`], " AND ");
    expect(q.text).toBe("x = ?");
    expect(q.params).toEqual([99]);
  });

  it("sql.join with an empty array returns empty text and params", () => {
    const q = sql.join([], " OR ");
    expect(q.text).toBe("");
    expect(q.params).toEqual([]);
  });

  it("extracts table from FROM clause", () => {
    const q = sql`SELECT * FROM tasks WHERE done = ${false}`;
    expect(q.tables).toContain("tasks");
  });

  it("extracts tables from both FROM and JOIN clauses", () => {
    const q = sql`SELECT t.id, u.name FROM tasks t JOIN users u ON t.user_id = u.id WHERE t.done = ${false}`;
    expect(q.tables).toContain("tasks");
    expect(q.tables).toContain("users");
  });

  it("extracts tables from LEFT JOIN and INNER JOIN", () => {
    const q = sql`SELECT * FROM orders o LEFT JOIN customers c ON o.cid = c.id INNER JOIN products p ON o.pid = p.id`;
    expect(q.tables).toContain("orders");
    expect(q.tables).toContain("customers");
    expect(q.tables).toContain("products");
  });

  it("deduplicates repeated table names", () => {
    const q = sql`SELECT * FROM tasks JOIN tasks t2 ON tasks.parent_id = t2.id`;
    const count = q.tables.filter((t) => t === "tasks").length;
    expect(count).toBe(1);
  });

  it("tables are lowercase", () => {
    const q = sql`SELECT * FROM Tasks`;
    expect(q.tables).toContain("tasks");
  });

  it("params are passed through in order with correct types", () => {
    const q = sql`INSERT INTO tasks VALUES (${42}, ${"hello"}, ${null}, ${true})`;
    expect(q.params).toEqual([42, "hello", null, true]);
  });
});
