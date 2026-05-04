import type { SchemaConfig } from "@palladium/core";
import { createEngine, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, nextTick } from "vue";
import { useLiveQuery, useSyncStatus } from "../index.js";

interface Schema {
  tasks: { id: string; name: string; done: number };
}

const SCHEMA: SchemaConfig = {
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
  version: 1,
};

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
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

    await db.insert("tasks", { id: "t1", name: "Buy milk", done: 0 });
    await nextTick();

    expect(wrapper.findAll("li")).toHaveLength(1);
    expect(wrapper.find("li").text()).toBe("Buy milk");
    wrapper.unmount();
  });
});

describe("useSyncStatus", () => {
  it("returns idle initially", async () => {
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
    expect(wrapper.find("[data-testid=status]").text()).toBe("idle");
    wrapper.unmount();
  });

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
