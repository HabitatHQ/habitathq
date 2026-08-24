/**
 * Two-client sync E2E.
 *
 * Boots two independent `PalladiumEngine` + `SyncTransport` pairs (each with
 * its own in-memory SQLite and distinct `nodeId`) against the single live Rust
 * server from `globalSetup`. Exercises the real uplink → server → downlink
 * path that the browser examples rely on, but headless and assertable.
 *
 * This is the tight bug-finding loop for the sync engine: no browser, no Vue,
 * just the transport talking to `palladium-axum`.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { createEngine, type PalladiumEngine, SyncTransport, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { E2E_BASE_URL } from "../setup/server.js";

// A `type` (not `interface`): object-literal type aliases get an implicit
// index signature, so they satisfy SchemaMap's `Record<string, unknown>`
// constraint — an interface would not. Matches example-vue's `TodoRow`.
type TaskRow = {
  id: string;
  text: string;
  done: number;
};
type TasksSchema = { tasks: TaskRow };

const SCHEMA = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL)",
};

const POLL_MS = 200;

interface Client {
  engine: PalladiumEngine<TasksSchema>;
  transport: SyncTransport<TasksSchema>;
  stop(): Promise<void>;
}

async function makeClient(nodeId: string): Promise<Client> {
  const engine = createEngine<TasksSchema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId,
  });
  await engine.init(SCHEMA);
  const transport = new SyncTransport(engine, {
    serverUrl: E2E_BASE_URL,
    pollIntervalMs: POLL_MS,
  });
  await transport.start();
  return { engine, transport, stop: () => transport.stop() };
}

/** Poll a client's local DB until `predicate` holds, or throw after `timeoutMs`. */
async function waitFor(
  client: Client,
  predicate: (rows: TaskRow[]) => boolean,
  timeoutMs = 5_000,
): Promise<TaskRow[]> {
  const deadline = Date.now() + timeoutMs;
  let last: TaskRow[] = [];
  while (Date.now() < deadline) {
    last = await client.engine.exec<TaskRow>(sql`SELECT id, text, done FROM tasks ORDER BY id`);
    if (predicate(last)) return last;
    await sleep(POLL_MS / 2);
  }
  throw new Error(`waitFor timed out. Last rows: ${JSON.stringify(last)}`);
}

describe("two-client sync", () => {
  let a: Client;
  let b: Client;

  beforeEach(async () => {
    // Distinct, deterministic-ish node ids per test run.
    a = await makeClient(crypto.randomUUID());
    b = await makeClient(crypto.randomUUID());
  });

  afterEach(async () => {
    await a?.stop();
    await b?.stop();
  });

  it("insert on A propagates to B", async () => {
    const id = crypto.randomUUID();
    await a.engine.insert("tasks", { id, text: "hello from A", done: 0 });

    const rows = await waitFor(b, (r) => r.some((t) => t.id === id));
    const row = rows.find((t) => t.id === id);
    expect(row?.text).toBe("hello from A");
    expect(row?.done).toBe(0);
  });

  it("update on A propagates to B", async () => {
    const id = crypto.randomUUID();
    await a.engine.insert("tasks", { id, text: "todo", done: 0 });
    await waitFor(b, (r) => r.some((t) => t.id === id));

    await a.engine.update("tasks", id, { done: 1, text: "done" });
    const rows = await waitFor(b, (r) => r.find((t) => t.id === id)?.done === 1);
    const row = rows.find((t) => t.id === id);
    expect(row?.text).toBe("done");
  });

  it("delete on A propagates to B", async () => {
    const id = crypto.randomUUID();
    await a.engine.insert("tasks", { id, text: "ephemeral", done: 0 });
    await waitFor(b, (r) => r.some((t) => t.id === id));

    await a.engine.delete("tasks", id);
    await waitFor(b, (r) => !r.some((t) => t.id === id));
  });

  it("bidirectional: writes from both clients converge", async () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    await a.engine.insert("tasks", { id: idA, text: "from A", done: 0 });
    await b.engine.insert("tasks", { id: idB, text: "from B", done: 0 });

    const seen = (r: TaskRow[]) => r.some((t) => t.id === idA) && r.some((t) => t.id === idB);
    await waitFor(a, seen);
    await waitFor(b, seen);
  });

  // Column-level LWW (Phase 1b, fixes F1): concurrent writes to the SAME column
  // on both clients converge deterministically to the higher-HLC value — the
  // winner is the same on both sides, regardless of arrival order.
  it("concurrent update to the same column converges (LWW)", async () => {
    const id = crypto.randomUUID();
    await a.engine.insert("tasks", { id, text: "seed", done: 0 });
    await waitFor(b, (r) => r.some((t) => t.id === id));

    // Both clients patch the same column at ~the same time.
    await Promise.all([
      a.engine.update("tasks", id, { text: "A-wins?" }),
      b.engine.update("tasks", id, { text: "B-wins?" }),
    ]);

    // Wait until both clients AGREE on the text (each starts at its own value,
    // then adopts the higher-HLC winner once it applies the other's change).
    const textOf = async (c: Client): Promise<string | undefined> =>
      (await c.engine.exec<TaskRow>(sql`SELECT text FROM tasks WHERE id = ${id}`))[0]?.text;
    const deadline = Date.now() + 5_000;
    let textA: string | undefined;
    let textB: string | undefined;
    while (Date.now() < deadline) {
      [textA, textB] = await Promise.all([textOf(a), textOf(b)]);
      if (textA !== undefined && textA === textB) break;
      await sleep(POLL_MS / 2);
    }
    expect(textA).toBe(textB); // converged to the same winner on both clients
    expect(["A-wins?", "B-wins?"]).toContain(textA); // and it's one of the two
  });

  // Column-level granularity: concurrent writes to DIFFERENT columns of the same
  // row both survive on both clients (neither clobbers the other).
  it("concurrent writes to different columns both survive", async () => {
    const id = crypto.randomUUID();
    await a.engine.insert("tasks", { id, text: "base", done: 0 });
    await waitFor(b, (r) => r.some((t) => t.id === id));

    await Promise.all([
      a.engine.update("tasks", id, { text: "edited-by-A" }),
      b.engine.update("tasks", id, { done: 1 }),
    ]);

    const merged = (r: TaskRow[]) => {
      const row = r.find((t) => t.id === id);
      return row?.text === "edited-by-A" && row?.done === 1;
    };
    await waitFor(a, merged);
    await waitFor(b, merged);
  });
});
