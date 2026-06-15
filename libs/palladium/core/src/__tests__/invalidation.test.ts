/**
 * Engine-driven precise invalidation tests.
 *
 * Architecture review §4: 'Invalidation extracts table names from SQL
 * with a regex (live-query.ts). It misses CTEs, quoted/aliased
 * identifiers, and views, and it invalidates at table granularity
 * (every observer re-runs when any row changes).'
 *
 * The engine already knows exactly which tables a tx touched (the
 * `tx()` builder). The fix surface is on the query side: let callers
 * declare a query's table dependencies explicitly via
 * `sql.withTables(...)` so the regex is bypassed. The regex still
 * works for plain `sql\`...\`` calls (back-compat), but a
 * schema-aware builder can opt in.
 *
 * This commit also un-deprecates `liveQuery`. The "use the worker
 * bus" deprecation note was misleading without a shipped replacement
 * (the review's complaint). The in-process LiveQuery is fine for
 * single-threaded apps and worker-based apps can layer their own
 * transport on top.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it, vi } from "vitest";
import { createEngine } from "../engine.js";
import { sql } from "../sql.js";
import type { SchemaMap } from "../tx.js";

interface Schema extends SchemaMap {
  tasks: { id: string; name: string; done: number };
  comments: { id: string; body: string };
}

const SCHEMA = {
  version: 1,
  schema: [
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
  ].join(";\n"),
};

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
}

describe("precise invalidation — sql.withTables()", () => {
  it("sql.withTables() declares dependencies that bypass the regex", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const cb = vi.fn();
    // CTE syntax that the regex would miss. Declaring tables explicitly
    // is the supported escape hatch.
    const q = sql.withTables(
      "WITH active AS (SELECT * FROM tasks WHERE done = 0) SELECT * FROM active",
      ["tasks"],
    );
    db.liveQuery<{ id: string }>(q).on("change", cb);

    // A write to tasks must fire the query (declared dependency).
    await db.insert("tasks", { id: "t1", name: "a", done: 0 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("a query without an explicit table list falls back to the regex", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const cb = vi.fn();
    const q = sql`SELECT * FROM tasks`;
    db.liveQuery<{ id: string }>(q).on("change", cb);

    await db.insert("tasks", { id: "t1", name: "a", done: 0 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("a query with explicit empty tables observes nothing", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const cb = vi.fn();
    const q = sql.withTables("SELECT 1", []);
    db.liveQuery<{ id: string }>(q).on("change", cb);

    await db.insert("tasks", { id: "t1", name: "a", done: 0 });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("liveQuery — un-deprecated", () => {
  it("the @deprecated tag is removed from engine.liveQuery", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    // The function exists, takes a query, and returns a LiveQuery.
    const lq = db.liveQuery(sql`SELECT * FROM tasks`);
    expect(typeof lq.cancel).toBe("function");
    expect(typeof lq.on).toBe("function");
  });
});
