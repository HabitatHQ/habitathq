import { createEngine, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { liveQueryStore, syncStatusStore } from "../index.js";

interface Schema {
  tasks: { id: string; name: string; done: number };
}

const MIGRATIONS = [
  "CREATE TABLE tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
];

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), MIGRATIONS);
}

/** Drain all pending microtasks (works across multiple promise levels). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("liveQueryStore", () => {
  it("starts with loading=true", () => {
    const db = makeDb();
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);
    // Subscribe to activate the store's start function.
    const unsub = store.subscribe(() => {});
    const value = get(store);
    expect(value.loading).toBe(true);
    expect(value.rows).toEqual([]);
    unsub();
  });

  it("resolves to empty rows after init", async () => {
    const db = makeDb();
    await db.init();
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
    await db.init();
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);

    const unsub = store.subscribe(() => {});
    await flush();

    await db.insert("tasks", { id: "t1", name: "Buy milk", done: 0 });

    const value = get(store);
    expect(value.rows).toHaveLength(1);
    expect(value.rows[0]?.name).toBe("Buy milk");
    unsub();
  });

  it("unsubscribe cancels the live query", async () => {
    const db = makeDb();
    await db.init();
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);

    const unsub = store.subscribe(() => {});
    await flush();
    unsub();

    // Insert after unsubscribe — store is inactive, no further updates.
    await db.insert("tasks", { id: "t1", name: "A", done: 0 });

    expect(get(store).rows).toEqual([]);
  });
});

describe("syncStatusStore", () => {
  it("starts with idle status", async () => {
    const db = makeDb();
    await db.init();
    const store = syncStatusStore(db);
    const unsub = store.subscribe(() => {});
    expect(get(store)).toBe("idle");
    unsub();
  });

  it("updates when engine status changes", async () => {
    const db = makeDb();
    await db.init();
    const store = syncStatusStore(db);

    const unsub = store.subscribe(() => {});
    db.setStatus("syncing");
    expect(get(store)).toBe("syncing");
    unsub();
  });
});
