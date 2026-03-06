import { createMockEngine, sql } from "@palladium/core";
import { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { PalladiumDialect } from "../index.js";

interface DB {
  tasks: { id: string; name: string; done: boolean };
}

interface Schema {
  tasks: { id: string; name: string; done: boolean };
}

function makeKysely(engine: ReturnType<typeof createMockEngine<Schema>>) {
  return new Kysely<DB>({ dialect: new PalladiumDialect(engine) });
}

describe("PalladiumDialect", () => {
  it("executes a raw SQL query via the engine", async () => {
    const engine = createMockEngine<Schema>();
    await engine.init();
    await engine.insert("tasks", { id: "t1", name: "Buy milk", done: false });

    const db = makeKysely(engine);
    // selectAll() compiles to SELECT * FROM `tasks` in MySQL dialect;
    // we adapt backtick-quoted table names in the MemoryAdapter.
    const result = await db.executeQuery(db.selectFrom("tasks").selectAll().compile());

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "t1", name: "Buy milk" });
  });

  it("executes a raw sql template via exec()", async () => {
    const engine = createMockEngine<Schema>();
    await engine.init();
    await engine.insert("tasks", { id: "t1", name: "hello", done: false });

    const rows = await engine.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
  });

  it("compiles a WHERE clause correctly", async () => {
    const engine = createMockEngine<Schema>();
    await engine.init();
    await engine.insert("tasks", { id: "t1", name: "A", done: false });
    await engine.insert("tasks", { id: "t2", name: "B", done: false });

    const db = makeKysely(engine);
    const result = await db.executeQuery(
      db.selectFrom("tasks").selectAll().where("id", "=", "t1").compile(),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "t1" });
  });
});
