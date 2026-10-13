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

  it.each([
    ["bare", sql`SELECT * FROM tasks`],
    ["double-quoted", sql`SELECT * FROM "tasks"`],
    ["bracketed", sql`SELECT * FROM [tasks]`],
    ["backtick-quoted", sql`SELECT * FROM \`tasks\``],
    ["schema-qualified", sql`SELECT * FROM main.tasks`],
    ["quoted schema", sql`SELECT * FROM "main".tasks`],
    ["quoted table", sql`SELECT * FROM main."tasks"`],
    ["double-quoted schema and table", sql`SELECT * FROM "main"."Tasks"`],
    ["bracketed schema and table", sql`SELECT * FROM [main].[tasks]`],
    ["backtick-quoted schema and table", sql`SELECT * FROM \`main\`.\`tasks\``],
    ["spaced qualification", sql`SELECT * FROM "main" . [tasks] AS t`],
  ])("extracts the table dependency for %s identifiers", (_label, query) => {
    expect(query.tables).toEqual(["tasks"]);
  });

  it("unescapes quoted identifier dependencies without losing embedded dots", () => {
    const query = sql`SELECT * FROM "main"."task""items" JOIN \`task\`\`items\` ON 1 = 1 JOIN [task.items] ON 1 = 1`;
    expect(query.tables).toEqual(['task"items', "task`items", "task.items"]);
  });

  it("extracts quoted JOIN tables without treating schema names or aliases as tables", () => {
    const query = sql`SELECT t.id FROM "main"."tasks" AS t LEFT JOIN [main].[comments] AS c ON c.id = t.id JOIN \`main\`.\`tasks\` AS sibling ON sibling.id = t.id`;
    expect(query.tables).toEqual(["tasks", "comments"]);
  });

  it("sql.join re-extracts quoted dependencies across fragment boundaries", () => {
    const query = sql.join(
      [
        sql`SELECT t.id FROM`,
        sql`"main"."tasks" AS t JOIN`,
        sql`[main].[comments] AS c ON c.id = t.id WHERE t.done = ${0}`,
      ],
      " ",
    );
    expect(query.tables).toEqual(["tasks", "comments"]);
    expect(query.params).toEqual([0]);
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

  it("SQL with no FROM or JOIN has an empty tables array", () => {
    const q = sql`SELECT 1`;
    expect(q.tables).toEqual([]);
  });

  it("JOIN-only keywords without FROM are still extracted", () => {
    const q = sql`SELECT t.id FROM orders JOIN customers ON orders.cid = customers.id`;
    expect(q.tables).toContain("orders");
    expect(q.tables).toContain("customers");
  });

  it("sql.join merges tables from all sub-queries", () => {
    const a = sql`SELECT * FROM tasks WHERE id = ${1}`;
    const b = sql`SELECT * FROM users WHERE id = ${2}`;
    const q = sql.join([a, b], " UNION ");
    expect(q.tables).toContain("tasks");
    expect(q.tables).toContain("users");
  });

  it("string template with only a trailing value gets exactly one placeholder", () => {
    // If `i < values.length` were mutated to `i <= values.length`,
    // an extra '?' would appear at the end.
    const q = sql`SELECT * FROM tasks WHERE id = ${"t1"}`;
    expect(q.text).toBe("SELECT * FROM tasks WHERE id = ?");
    expect(q.text.split("?")).toHaveLength(2); // exactly one '?'
  });
});
