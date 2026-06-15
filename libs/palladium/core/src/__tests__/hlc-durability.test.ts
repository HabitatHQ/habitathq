/**
 * HLC durability tests.
 *
 * The currentHlc lives in-memory on the engine instance. After a
 * reload — even a process restart — it is reset, and a wall-clock
 * that went backwards in the meantime can issue HLCs that are not
 * strictly greater than ones we issued before the restart.
 *
 * The fix: persist currentHlc in _sync_state on every send/receive,
 * restore on init(). Also persist nodeId so apps don't have to
 * remember to pass it on every construction.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it, vi } from "vitest";
import { PalladiumEngine } from "../engine.js";
import { compareHlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";
import type { SchemaMap } from "../tx.js";

interface Schema extends SchemaMap {
  notes: { id: string; title: string };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema: "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
};

const NODE_ID = "00000000-0000-0000-0000-000000aaaaaa";

describe("HLC durability", () => {
  it("nodeId is persisted to _sync_state on init()", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: NODE_ID,
    });
    await db.init(SCHEMA);

    const rows = await db.adapter.exec<{ key: string; value: string }>(
      "SELECT key, value FROM _sync_state WHERE key = 'node_id'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(NODE_ID);
  });

  it("currentHlc is persisted after nextSendHlc and restored on a new engine", async () => {
    // Use a real file so two PalladiumEngine instances can share state
    // across the simulated "reload".
    const { unlinkSync } = await import("node:fs");
    const path = `/tmp/palladium-hlc-durability-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    try {
      // Engine 1: send one HLC at a known wallMs.
      vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
      const db1 = new PalladiumEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename: path } }),
        { nodeId: NODE_ID },
      );
      await db1.init(SCHEMA);
      const sent1 = db1.nextSendHlc();
      await db1.adapter.close();

      // Simulate reload: a wall-clock that went backwards.
      vi.spyOn(Date, "now").mockReturnValue(1_699_999_000_000);

      // Engine 2 on the same file: currentHlc must be restored, not
      // (re)createHlc'd from the backwards wall clock.
      const db2 = new PalladiumEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename: path } }),
        { nodeId: NODE_ID },
      );
      await db2.init(SCHEMA);
      const sent2 = db2.nextSendHlc();

      // sent2 must be > sent1 even though the wall clock went backwards,
      // because db2 rehydrated the persisted currentHlc and then
      // advanced it.
      expect(compareHlc(sent2, sent1)).toBeGreaterThan(0);
      await db2.adapter.close();
    } finally {
      try {
        unlinkSync(path);
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("a fresh engine with a different nodeId gets a new ULID, not the persisted one", async () => {
    // First engine persists nodeId.
    const db1 = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: NODE_ID,
    });
    await db1.init(SCHEMA);

    // Second engine on the same db but with a different nodeId: the
    // constructor option wins (explicit override).
    const override = "00000000-0000-0000-0000-0000bbbbbbbb";
    const db2 = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: override,
    });
    await db2.init(SCHEMA);

    expect(db2.nodeId).toBe(override);

    // The persisted row was updated to the override.
    const rows = await db2.adapter.exec<{ value: string }>(
      "SELECT value FROM _sync_state WHERE key = 'node_id'",
    );
    expect(rows[0]?.value).toBe(override);
  });
});
