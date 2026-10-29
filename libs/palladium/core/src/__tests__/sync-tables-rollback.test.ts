/**
 * Shadow-table readiness across a rolled-back transaction. The first `tx()`
 * against a store that hasn't run `init()` creates the `_sync_*` shadow
 * tables inside its own transaction. If that transaction rolls back, the DDL
 * rolls back with it — the engine must not remember the shadow tables as
 * ready in that case, or every later write fails with
 * "no such table: _sync_row_meta".
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import { sql } from "../sql.js";

interface Schema {
  notes: { id: string; title: string; body: string };
}

const APP_SCHEMA =
  "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL)";

const BOB = "00000000-0000-4000-8000-00000000b0b0";

describe("shadow-table readiness does not latch across a rolled-back transaction", () => {
  it("recreates the shadow tables on the next tx() after the first one rolls back", async () => {
    // Bypass `init()` so the `_sync_*` tables only get created inside the
    // first `tx()` transaction, not against the engine's own adapter ahead of
    // any transaction.
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    await adapter.open();
    await adapter.runMigrations([APP_SCHEMA]);
    const db = new PalladiumEngine<Schema>(adapter, { nodeId: BOB });

    const id1 = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    // `body` is NOT NULL; omitting it (cast through `as never` to bypass the
    // type checker) makes the underlying INSERT fail and roll back the whole
    // transaction, including the shadow-table DDL that ran inside it.
    await expect(
      db.tx((t) => {
        t.insert("notes", { id: id1, title: "x" } as never);
      }),
    ).rejects.toThrow();

    const id2 = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";
    await db.tx((t) => {
      t.insert("notes", { id: id2, title: "ok", body: "b" });
    });

    const rows = await db.exec<{ row_id: string }>(
      sql`SELECT row_id FROM _sync_row_meta WHERE row_id = ${id2}`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
