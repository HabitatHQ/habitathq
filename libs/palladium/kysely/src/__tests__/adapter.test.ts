import type { SchemaConfig } from "@palladium/core";
import { createEngine, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { PalladiumDialect } from "../index.js";

interface DB {
  tasks: { id: string; name: string; done: number };
  parents: { id: string };
  children: { id: string; parent_id: string };
}

type Schema = {
  tasks: { id: string; name: string; done: number };
  parents: { id: string };
  children: { id: string; parent_id: string };
};

const SCHEMA: SchemaConfig = {
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id) DEFERRABLE INITIALLY DEFERRED)",
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
    await engine.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "Buy milk",
      done: 0,
    });

    const db = makeKysely(engine);
    const result = await db.executeQuery(db.selectFrom("tasks").selectAll().compile());

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "Buy milk",
    });
  });

  it("executes a raw sql template via exec()", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    await engine.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
      name: "hello",
      done: 0,
    });
    const rows = await engine.exec<Schema["tasks"]>(sql`SELECT * FROM tasks`);
    expect(rows).toHaveLength(1);
  });

  it("compiles a WHERE clause correctly", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    await engine.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad",
      name: "A",
      done: 0,
    });
    await engine.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae",
      name: "B",
      done: 0,
    });

    const db = makeKysely(engine);
    const result = await db.executeQuery(
      db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "018f0f50-7b8d-7a1c-8e2f-1234567890ad")
        .compile(),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad" });
  });

  it("rolls back prior writes when a transaction callback rejects", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    const db = makeKysely(engine);

    await expect(
      db.transaction().execute(async (tx) => {
        await tx
          .insertInto("tasks")
          .values({
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890af",
            name: "Rolled back",
            done: 0,
          })
          .execute();
        throw new Error("reject transaction");
      }),
    ).rejects.toThrow("reject transaction");

    const rows = await db.selectFrom("tasks").selectAll().execute();
    expect(rows).toEqual([]);
    await db.destroy();
  });

  it("commits writes and isolates concurrent Kysely calls until transaction completion", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    const db = makeKysely(engine);
    let unrelatedRows!: Promise<Schema["tasks"][]>;
    let unrelatedFinished = false;

    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto("tasks")
        .values({
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890b0",
          name: "Committed",
          done: 0,
        })
        .execute();
      unrelatedRows = db.selectFrom("tasks").selectAll().execute();
      void unrelatedRows.then(() => {
        unrelatedFinished = true;
      });

      expect(await tx.selectFrom("tasks").selectAll().execute()).toHaveLength(1);
      expect(unrelatedFinished).toBe(false);
    });
    expect(await unrelatedRows).toHaveLength(1);

    const rows = await db.selectFrom("tasks").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Committed");
    await db.destroy();
  });

  it("rejects transaction startup when the engine adapter is not transactable", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    Object.defineProperty(engine.adapter, "transaction", { value: undefined });
    const db = makeKysely(engine);

    await expect(db.transaction().execute(async () => undefined)).rejects.toThrow(
      "PalladiumDialect requires transaction support",
    );
    await db.destroy();
  });

  it("preserves a deferred constraint commit error through rollback cleanup", async () => {
    const engine = makeEngine();
    await engine.init(SCHEMA);
    await engine.adapter.exec("PRAGMA foreign_keys = ON");
    const db = makeKysely(engine);

    await expect(
      db.transaction().execute(async (tx) => {
        await tx
          .insertInto("children")
          .values({
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890b1",
            parent_id: "018f0f50-7b8d-7a1c-8e2f-1234567890b2",
          })
          .execute();
      }),
    ).rejects.toThrow("FOREIGN KEY constraint failed");

    expect(await db.selectFrom("children").selectAll().execute()).toEqual([]);
    await db.destroy();
  });
});
