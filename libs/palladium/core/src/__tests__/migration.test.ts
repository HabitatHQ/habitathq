import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it, vi } from "vitest";
import type { Seed } from "../migration.js";
import { applySchema, applySeeds } from "../migration.js";

function makeAdapter() {
  return new NodeSqliteAdapter({ vfs: { type: "memory" } });
}

async function getVersion(adapter: NodeSqliteAdapter): Promise<number> {
  const rows = await adapter.exec<{ user_version: number }>("PRAGMA user_version");
  return rows[0]?.user_version ?? 0;
}

const BASE_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0);",
  "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, body TEXT NOT NULL);",
].join("\n");

describe("applySchema", () => {
  it("runs baseline DDL on fresh database", async () => {
    const adapter = makeAdapter();
    await adapter.open();

    await applySchema(adapter, { schema: BASE_SCHEMA, version: 1 });

    const rows = await adapter.exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const tables = rows.map((r) => r.name);
    expect(tables).toContain("tasks");
    expect(tables).toContain("comments");
  });

  it("stamps target version on fresh install", async () => {
    const adapter = makeAdapter();
    await adapter.open();

    await applySchema(adapter, { schema: BASE_SCHEMA, version: 5 });

    expect(await getVersion(adapter)).toBe(5);
  });

  it("does not run migrations on fresh install", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    const callback = vi.fn();

    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 2,
      migrations: { 2: [callback] },
    });

    expect(callback).not.toHaveBeenCalled();
    expect(await getVersion(adapter)).toBe(2);
  });

  it("applies pending SQL migrations to existing database", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);
    await adapter.exec("PRAGMA user_version = 1");

    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 2,
      migrations: {
        2: ["ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'"],
      },
    });

    expect(await getVersion(adapter)).toBe(2);
    await adapter.exec(
      "INSERT INTO tasks (id, name, done, priority) VALUES ('t1', 'test', 0, 'high')",
    );
    const rows = await adapter.exec<{ priority: string }>(
      "SELECT priority FROM tasks WHERE id = 't1'",
    );
    expect(rows[0]?.priority).toBe("high");
  });

  it("runs callback migration steps", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);
    await adapter.exec("PRAGMA user_version = 1");
    await adapter.exec("INSERT INTO tasks (id, name, done) VALUES ('t1', 'old-name', 0)");

    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 2,
      migrations: {
        2: [
          async (exec) => {
            await exec("UPDATE tasks SET name = 'new-name' WHERE id = ?", ["t1"]);
          },
        ],
      },
    });

    const rows = await adapter.exec<{ name: string }>("SELECT name FROM tasks WHERE id = 't1'");
    expect(rows[0]?.name).toBe("new-name");
  });

  it("applies migrations in version order with gaps", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);
    await adapter.exec("PRAGMA user_version = 1");

    const order: number[] = [];

    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 5,
      migrations: {
        3: [
          async () => {
            order.push(3);
          },
        ],
        5: [
          async () => {
            order.push(5);
          },
        ],
      },
    });

    expect(order).toEqual([3, 5]);
    expect(await getVersion(adapter)).toBe(5);
  });

  it("skips migrations at or below current version", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);
    await adapter.exec("PRAGMA user_version = 3");

    const callback = vi.fn();

    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 5,
      migrations: {
        2: [callback],
        3: [callback],
        5: [async () => {}],
      },
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("stamps target version even without migration at that exact version", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);
    await adapter.exec("PRAGMA user_version = 1");

    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 5,
      migrations: { 3: ["SELECT 1"] },
    });

    expect(await getVersion(adapter)).toBe(5);
  });

  it("mixes string and callback steps in a single migration", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);
    await adapter.exec("PRAGMA user_version = 1");
    await adapter.exec("INSERT INTO tasks (id, name, done) VALUES ('t1', 'hello', 0)");

    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 2,
      migrations: {
        2: [
          "ALTER TABLE tasks ADD COLUMN tag TEXT NOT NULL DEFAULT ''",
          async (exec) => {
            await exec("UPDATE tasks SET tag = 'migrated'");
          },
        ],
      },
    });

    const rows = await adapter.exec<{ tag: string }>("SELECT tag FROM tasks WHERE id = 't1'");
    expect(rows[0]?.tag).toBe("migrated");
  });

  it("handles no migrations config gracefully", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);
    await adapter.exec("PRAGMA user_version = 1");

    await applySchema(adapter, { schema: BASE_SCHEMA, version: 3 });

    expect(await getVersion(adapter)).toBe(3);
  });
});

describe("applySeeds", () => {
  it("creates tracking table and applies seeds", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);

    await applySeeds(adapter, [
      {
        key: "seed:hello",
        apply: async (exec) => {
          await exec("INSERT INTO tasks (id, name, done) VALUES ('s1', 'seeded', 0)");
        },
      },
    ]);

    const rows = await adapter.exec<{ name: string }>("SELECT name FROM tasks WHERE id = 's1'");
    expect(rows[0]?.name).toBe("seeded");
  });

  it("skips already-applied seeds", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);

    const apply = vi.fn<
      (exec: <T>(s: string, p?: readonly unknown[]) => Promise<T[]>) => Promise<void>
    >(async (exec) => {
      await exec("INSERT INTO tasks (id, name, done) VALUES ('s1', 'seeded', 0)");
    });

    const seeds: Seed[] = [{ key: "seed:once", apply }];

    await applySeeds(adapter, seeds);
    await applySeeds(adapter, seeds);

    expect(apply).toHaveBeenCalledOnce();
  });

  it("tracks seed keys in _palladium_seeds", async () => {
    const adapter = makeAdapter();
    await adapter.open();
    await adapter.runMigrations([BASE_SCHEMA]);

    await applySeeds(adapter, [
      { key: "seed:a", apply: async () => {} },
      { key: "seed:b", apply: async () => {} },
    ]);

    const rows = await adapter.exec<{ key: string }>(
      "SELECT key FROM _palladium_seeds ORDER BY key",
    );
    expect(rows.map((r) => r.key)).toEqual(["seed:a", "seed:b"]);
  });
});

describe("applySchema with seeds", () => {
  it("runs seeds on fresh install", async () => {
    const adapter = makeAdapter();
    await adapter.open();

    const apply = vi.fn();

    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 1,
      seeds: [{ key: "seed:init", apply }],
    });

    expect(apply).toHaveBeenCalledOnce();
  });

  it("runs new seeds on existing database without re-running old ones", async () => {
    const adapter = makeAdapter();
    await adapter.open();

    const firstApply = vi.fn();
    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 1,
      seeds: [{ key: "seed:v1", apply: firstApply }],
    });
    expect(firstApply).toHaveBeenCalledOnce();

    const secondApply = vi.fn();
    await applySchema(adapter, {
      schema: BASE_SCHEMA,
      version: 1,
      seeds: [
        { key: "seed:v1", apply: firstApply },
        { key: "seed:v2", apply: secondApply },
      ],
    });

    // Old seed not re-run, new seed applied
    expect(firstApply).toHaveBeenCalledOnce();
    expect(secondApply).toHaveBeenCalledOnce();
  });
});
