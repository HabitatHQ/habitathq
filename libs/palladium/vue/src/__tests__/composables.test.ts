import type { SchemaConfig, SqlQuery } from "@palladium/core";
import { createEngine, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, nextTick } from "vue";
import { type LiveQueryResult, useLiveQuery, useSyncStatus } from "../index.js";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("useLiveQuery", () => {
  it("returns empty rows initially", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const Comp = defineComponent({
      setup() {
        const { rows, loading } = useLiveQuery<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);
        return { rows, loading };
      },
      template: `<div data-testid="count">{{ loading ? 'loading' : rows.length }}</div>`,
    });

    const wrapper = mount(Comp, { attachTo: document.body });
    await flushPromises();
    await nextTick();
    expect(wrapper.find("[data-testid=count]").text()).toBe("0");
    wrapper.unmount();
  });

  it("updates when a row is inserted", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const Comp = defineComponent({
      setup() {
        const { rows } = useLiveQuery<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);
        return { rows };
      },
      template: `<ul><li v-for="r in rows" :key="r.id">{{ r.name }}</li></ul>`,
    });

    const wrapper = mount(Comp, { attachTo: document.body });
    await nextTick();
    expect(wrapper.findAll("li")).toHaveLength(0);

    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "Buy milk",
      done: 0,
    });
    await nextTick();

    expect(wrapper.findAll("li")).toHaveLength(1);
    expect(wrapper.find("li").text()).toBe("Buy milk");
    wrapper.unmount();
  });
  it("does not publish an initial result after unmount", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "Pending",
      done: 0,
    });
    const pending = deferred<void>();
    const started = deferred<void>();
    const liveQuery = db.liveQuery.bind(db);
    db.liveQuery = <T>(query: SqlQuery) => {
      const instance = liveQuery<T>(query);
      const exec = instance.exec.bind(instance);
      instance.exec = async () => {
        const result = await exec();
        started.resolve();
        await pending.promise;
        return result;
      };
      return instance;
    };

    let state: LiveQueryResult<Schema["tasks"]> | undefined;
    const Comp = defineComponent({
      setup() {
        state = useLiveQuery<Schema["tasks"]>(db, sql`SELECT * FROM tasks`);
        return state;
      },
      template: "<div />",
    });

    const wrapper = mount(Comp);
    await started.promise;
    wrapper.unmount();
    pending.resolve();
    await flushPromises();
    expect(state?.rows.value).toEqual([]);
    expect(state?.loading.value).toBe(true);
  });

  it.each(["result", "error"])(
    "keeps newer change rows when the initial %s completes later",
    async (initialOutcome) => {
      const db = makeDb();
      await db.init(SCHEMA);
      const pending = deferred<void>();
      const started = deferred<void>();
      const liveQuery = db.liveQuery.bind(db);
      db.liveQuery = <T>(query: SqlQuery) => {
        const instance = liveQuery<T>(query);
        const exec = instance.exec.bind(instance);
        instance.exec = async () => {
          const outcome = await exec().then(
            (rows) => ({ ok: true as const, rows }),
            (error: unknown) => ({ ok: false as const, error }),
          );
          started.resolve();
          await pending.promise;
          if (!outcome.ok) throw outcome.error;
          return outcome.rows;
        };
        return instance;
      };

      const query =
        initialOutcome === "error"
          ? sql`SELECT name, unavailable FROM tasks`
          : sql`SELECT * FROM tasks`;
      let state: LiveQueryResult<Schema["tasks"]> | undefined;
      const Comp = defineComponent({
        setup() {
          state = useLiveQuery<Schema["tasks"]>(db, query);
        },
        template: "<div />",
      });

      const wrapper = mount(Comp);
      await started.promise;
      if (initialOutcome === "error") {
        await db.exec(sql`ALTER TABLE tasks ADD COLUMN unavailable INTEGER`);
      }
      await db.insert("tasks", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
        name: "Newer",
        done: 0,
      });
      await nextTick();
      expect(state?.rows.value.map(({ name }) => name)).toEqual(["Newer"]);
      expect(state?.loading.value).toBe(false);
      expect(state?.error.value).toBeNull();
      pending.resolve();
      await flushPromises();
      expect(state?.rows.value.map(({ name }) => name)).toEqual(["Newer"]);
      expect(state?.loading.value).toBe(false);
      expect(state?.error.value).toBeNull();
      wrapper.unmount();
    },
  );
});

describe("useSyncStatus", () => {
  it("updates on status change", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    const Comp = defineComponent({
      setup() {
        const status = useSyncStatus(db);
        return { status };
      },
      template: `<div data-testid="status">{{ status }}</div>`,
    });

    const wrapper = mount(Comp, { attachTo: document.body });
    await nextTick();
    db.setStatus("syncing");
    await nextTick();
    expect(wrapper.find("[data-testid=status]").text()).toBe("syncing");
    wrapper.unmount();
  });
});
