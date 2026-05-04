import type { SchemaConfig } from "@palladium/core";
import { createEngine, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { PalladiumDialect } from "../index.js";

interface DB {
  tasks: { id: string; name: string; done: number };
}

interface Schema {
  tasks: { id: string; name: string; done: number };
}

const SCHEMA: SchemaConfig = {
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
  version: 1,
};

function makeEngine() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
}

function makeKysely(engine: ReturnType<typeof makeEngine>) {
  return new Kysely<DB>({ dialect: new PalladiumDialect(engine) });
}

describe("PalladiumDialect", () => {
  it("executes a raw SQL query via the engine", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    await engine.insert("tasks", { id: "t1", name: "Buy milk", done: 0 });

    const db = makeKysely(engine);
    const result = await db.executeQuery(db.selectFrom("tasks").selectAll().compile());

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "t1", name: "Buy milk" });
  });

  it("executes a raw sql template via exec()", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    await engine.insert("tasks", { id: "t1", name: "hello", done: 0 });

    const rows = await engine.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
  });

  it("compiles a WHERE clause correctly", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    await engine.insert("tasks", { id: "t1", name: "A", done: 0 });
    await engine.insert("tasks", { id: "t2", name: "B", done: 0 });

    const db = makeKysely(engine);
    const result = await db.executeQuery(
      db.selectFrom("tasks").selectAll().where("id", "=", "t1").compile(),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "t1" });
  });
});
