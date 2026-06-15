/**
 * engine.close() + idempotent init() tests.
 *
 * The engine has had no close() method despite BlobRegistry.revokeAll()
 * being documented as called on close. init() has also not been
 * idempotent: a second call re-runs applySchema (which is fine for
 * idempotent DDL but wasteful and surprising for migrations).
 *
 * After the fix:
 *   - close() releases the adapter and resets internal state.
 *   - init() is idempotent: a second call after init() does nothing
 *     (no re-apply, no extra open()).
 *   - close() followed by init() re-opens cleanly.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { createEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";

interface Schema {
  notes: { id: string; title: string };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema: "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
};

describe("engine.close() and idempotent init()", () => {
  it("close() releases the underlying adapter", async () => {
    const db = createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
    await db.init(SCHEMA);
    // No public close is the bug.
    expect(typeof db.close).toBe("function");
    await db.close();
  });

  it("close() is idempotent", async () => {
    const db = createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
    await db.init(SCHEMA);
    await db.close();
    await db.close(); // second call must not throw
  });

  it("init() is idempotent — second call is a no-op", async () => {
    let openCount = 0;
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    const realOpen = adapter.open.bind(adapter);
    adapter.open = async () => {
      openCount += 1;
      return realOpen();
    };
    const db = createEngine<Schema>(adapter);
    await db.init(SCHEMA);
    await db.init(SCHEMA);
    await db.init(SCHEMA);
    // open() should have been called exactly once across the three inits.
    expect(openCount).toBe(1);
  });

  it("close() then init() re-opens cleanly", async () => {
    // Use a file so the SQLite handle survives the close.
    const { unlinkSync } = await import("node:fs");
    const path = `/tmp/palladium-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    try {
      const db = createEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename: path } }),
      );
      await db.init(SCHEMA);
      await db.insert("notes", { id: "n1", title: "before" });
      await db.close();

      await db.init(SCHEMA);
      // Data survives across close+init on a file-backed DB.
      const rows = await db.exec<{ id: string }>(sql`SELECT id FROM notes`);
      expect(rows).toHaveLength(1);
    } finally {
      try {
        unlinkSync(path);
      } catch {
        // best-effort
      }
    }
  });
});
