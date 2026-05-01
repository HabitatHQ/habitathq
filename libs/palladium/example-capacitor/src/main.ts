/**
 * Renderer entry point — runs a suite of smoke tests against CapacitorSqliteAdapter
 * using the Electron shim, then writes the results to the DOM so that the
 * Playwright test can inspect them.
 *
 * Result convention:
 *   document.body.dataset.status  = "done" | "done-with-failures"
 *   <li data-status="passed|failed" [data-error="..."]>test name</li>
 */

import { SQLiteConnection } from "@capacitor-community/sqlite";
import { createEngine } from "@palladium/core";
import { CapacitorSqliteAdapter } from "@palladium/sqlite-capacitor";

interface Schema {
  tasks: { id: string; name: string; done: number };
}

const MIGRATIONS = [
  "CREATE TABLE tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
];

interface TestResult {
  name: string;
  status: "passed" | "failed";
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, status: "passed" });
  } catch (err) {
    results.push({ name, status: "failed", error: String(err) });
  }
}

async function runTests(): Promise<void> {
  const conn = new SQLiteConnection();
  const adapter = new CapacitorSqliteAdapter(conn, { dbName: "smoke-test" });
  const db = createEngine<Schema>(adapter, MIGRATIONS);
  await db.init();

  await test("returns empty rows initially", async () => {
    const rows = await adapter.exec<Schema["tasks"]>("SELECT * FROM tasks");
    if (rows.length !== 0) throw new Error(`Expected 0 rows, got ${rows.length}`);
  });

  await test("inserts a row and retrieves it", async () => {
    await db.insert("tasks", { id: "t1", name: "Buy milk", done: 0 });
    const rows = await adapter.exec<Schema["tasks"]>("SELECT * FROM tasks WHERE id = ?", ["t1"]);
    if (rows.length !== 1) throw new Error(`Expected 1 row, got ${rows.length}`);
    if (rows[0]?.name !== "Buy milk") {
      throw new Error(`Expected name "Buy milk", got "${rows[0]?.name}"`);
    }
  });

  await test("updates a row", async () => {
    await db.update("tasks", "t1", { done: 1 });
    const rows = await adapter.exec<Schema["tasks"]>("SELECT done FROM tasks WHERE id = ?", ["t1"]);
    if (rows[0]?.done !== 1) throw new Error(`Expected done=1, got ${rows[0]?.done}`);
  });

  await test("batch insert via tx()", async () => {
    await db.tx((t) => {
      t.insert("tasks", { id: "ta", name: "Alpha", done: 0 });
      t.insert("tasks", { id: "tb", name: "Beta", done: 0 });
    });
    const rows = await adapter.exec<Schema["tasks"]>(
      "SELECT id FROM tasks WHERE id IN ('ta','tb') ORDER BY id",
    );
    if (rows.length !== 2) throw new Error(`Expected 2 rows from tx, got ${rows.length}`);
  });

  await test("transaction rolls back on error", async () => {
    let threw = false;
    try {
      await adapter.transaction(async (tx) => {
        await tx.put("tasks", "t99", { id: "t99", name: "Rollback me", done: 0 });
        throw new Error("deliberate rollback");
      });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("Expected transaction to throw");
    const rows = await adapter.exec<Schema["tasks"]>("SELECT * FROM tasks WHERE id = ?", ["t99"]);
    if (rows.length !== 0) {
      throw new Error(`Row should have been rolled back, got ${rows.length} rows`);
    }
  });

  await test("deletes a row", async () => {
    await db.delete("tasks", "t1");
    const rows = await adapter.exec<Schema["tasks"]>("SELECT * FROM tasks WHERE id = ?", ["t1"]);
    if (rows.length !== 0) {
      throw new Error(`Expected 0 rows after delete, got ${rows.length}`);
    }
  });

  await db.adapter.close();

  // Render results into the DOM for Playwright to inspect.
  const ul = document.createElement("ul");
  for (const r of results) {
    const li = document.createElement("li");
    li.textContent = r.name;
    li.dataset.status = r.status;
    if (r.error !== undefined) li.dataset.error = r.error;
    ul.appendChild(li);
  }
  document.body.appendChild(ul);

  const allPassed = results.every((r) => r.status === "passed");
  document.body.dataset.status = allPassed ? "done" : "done-with-failures";
}

void runTests().catch((err: unknown) => {
  document.body.dataset.status = "done-with-failures";
  document.body.dataset.error = String(err);
});
