import type { SchemaConfig } from "@palladium/core";
import { createEngine, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { liveQueryStore, syncStatusStore } from "../index.js";

type Schema = {
  tasks: { id: string; name: string; done: number };
};

const SCHEMA: SchemaConfig = {
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
  version: 1,
};

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
}

/** Drain all pending microtasks (works across multiple promise levels). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("liveQueryStore", () => {
  it("resolves to empty rows after init", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);

    const unsub = store.subscribe(() => {});
    await flush();
    const value = get(store);
    expect(value.loading).toBe(false);
    expect(value.rows).toEqual([]);
    unsub();
  });

  it("emits updated rows on insert", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);

    const unsub = store.subscribe(() => {});
    await flush();

    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "Buy milk",
      done: 0,
    });

    const value = get(store);
    expect(value.rows).toHaveLength(1);
    expect(value.rows[0]?.name).toBe("Buy milk");
    unsub();
  });

  it("unsubscribe cancels the live query", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);

    const unsub = store.subscribe(() => {});
    await flush();
    unsub();

    // Insert after unsubscribe — store is inactive, no further updates.
    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "A",
      done: 0,
    });

    expect(get(store).rows).toEqual([]);
  });
});

describe("syncStatusStore", () => {
  it("updates when engine status changes", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const store = syncStatusStore(db);

    const unsub = store.subscribe(() => {});
    db.setStatus("syncing");
    expect(get(store)).toBe("syncing");
    unsub();
  });
});
