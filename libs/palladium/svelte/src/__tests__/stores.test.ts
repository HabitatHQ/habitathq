import type { PalladiumEngine, SchemaConfig, SqlQuery } from "@palladium/core";
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function gateInitialExecutions(db: PalladiumEngine<Schema>, gates: Deferred<void>[]) {
  const originalLiveQuery = db.liveQuery.bind(db);
  let execution = 0;
  db.liveQuery = <T>(query: SqlQuery) => {
    const liveQuery = originalLiveQuery<T>(query);
    const originalExec = liveQuery.exec.bind(liveQuery);
    const gate = gates[execution++];
    liveQuery.exec = async () => {
      const outcome = await originalExec().then(
        (rows) => ({ ok: true as const, rows }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await gate?.promise;
      if (!outcome.ok) throw outcome.error;
      return outcome.rows;
    };
    return liveQuery;
  };
}

/** Drain pending query/store promise continuations. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("liveQueryStore", () => {
  it("does not publish a previous lifetime's initial result after resubscription", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "Initial",
      done: 0,
    });
    const oldExecution = deferred<void>();
    const newExecution = deferred<void>();
    gateInitialExecutions(db, [oldExecution, newExecution]);
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);
    const first = store.subscribe(() => {});
    await flush();
    first();

    const second = store.subscribe(() => {});
    await flush();

    oldExecution.resolve();
    await flush();
    expect(get(store).rows).toEqual([]);
    expect(get(store).loading).toBe(true);

    newExecution.resolve();
    await flush();
    expect(get(store).rows.map(({ name }) => name)).toEqual(["Initial"]);
    second();
  });

  it("does not publish a previous lifetime's initial error after resubscription", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const oldExecution = deferred<void>();
    const newExecution = deferred<void>();
    gateInitialExecutions(db, [oldExecution, newExecution]);
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM missing_tasks`);
    const first = store.subscribe(() => {});
    await flush();
    first();
    await db.exec(sql`CREATE TABLE missing_tasks (id TEXT PRIMARY KEY, name TEXT, done INTEGER)`);

    const second = store.subscribe(() => {});
    await flush();
    newExecution.resolve();
    await flush();
    expect(get(store).error).toBeNull();

    oldExecution.resolve();
    await flush();
    expect(get(store).error).toBeNull();
    second();
  });

  it.each(["result", "error"])(
    "keeps a newer change notification when its initial %s completes later",
    async (initialOutcome) => {
      const db = makeDb();
      await db.init(SCHEMA);
      const initialExecution = deferred<void>();
      gateInitialExecutions(db, [initialExecution]);
      const query =
        initialOutcome === "error"
          ? sql`SELECT name, unavailable FROM tasks`
          : sql`SELECT * FROM tasks`;
      const store = liveQueryStore<Schema["tasks"]>(db, query);
      const unsubscribe = store.subscribe(() => {});
      await flush();
      if (initialOutcome === "error") {
        await db.exec(sql`ALTER TABLE tasks ADD COLUMN unavailable INTEGER`);
      }
      await db.insert("tasks", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
        name: "Newer",
        done: 0,
      });
      expect(get(store).rows.map(({ name }) => name)).toEqual(["Newer"]);
      expect(get(store).loading).toBe(false);
      expect(get(store).error).toBeNull();

      initialExecution.resolve();
      await flush();
      expect(get(store).rows.map(({ name }) => name)).toEqual(["Newer"]);
      expect(get(store).loading).toBe(false);
      expect(get(store).error).toBeNull();
      unsubscribe();
    },
  );

  it("publishes an active query's initial error", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const store = liveQueryStore<Schema["tasks"]>(db, sql`SELECT * FROM missing_tasks`);
    const unsubscribe = store.subscribe(() => {});
    await flush();
    expect(get(store).loading).toBe(false);
    expect(get(store).error?.message).toContain("missing_tasks");
    unsubscribe();
  });

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
  it("starts with current status on first and renewed subscriptions", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    const store = syncStatusStore(db);

    db.setStatus("offline");
    const firstValues: string[] = [];
    const unsubscribeFirst = store.subscribe((status) => firstValues.push(status));
    expect(firstValues).toEqual(["offline"]);
    db.setStatus("syncing");
    expect(firstValues).toEqual(["offline", "syncing"]);
    unsubscribeFirst();

    db.setStatus("offline");
    const renewedValues: string[] = [];
    const unsubscribeRenewed = store.subscribe((status) => renewedValues.push(status));
    expect(renewedValues).toEqual(["offline"]);
    db.setStatus("caught_up");
    expect(renewedValues).toEqual(["offline", "caught_up"]);
    unsubscribeRenewed();
  });
});
