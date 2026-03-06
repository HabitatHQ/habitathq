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

  it("exposes tables mentioned in a FROM/JOIN clause via parseTables", () => {
    const q = sql`SELECT t.id, u.name FROM tasks t JOIN users u ON t.user_id = u.id WHERE t.done = ${false}`;
    expect(q.tables).toContain("tasks");
    expect(q.tables).toContain("users");
  });
});
