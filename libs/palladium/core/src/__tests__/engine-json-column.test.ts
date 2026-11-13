import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { createEngine } from "../engine.js";
import type { JsonValue, SyncRow } from "../tx.js";

type Schema = Record<string, SyncRow> & {
  notes: { id: string; title: string; payload: JsonValue };
};

const ID = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
const REMOTE_NODE = "00000000-0000-4000-8000-00000000a11c";
const NESTED = { labels: ["one", "two"], archived: false };

describe("replicated SQLite column values", () => {
  it("rejects nested values before row, metadata, or local checkpoint writes", async () => {
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    const engine = createEngine<Schema>(adapter);
    await engine.init({
      version: 1,
      schema:
        "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE probe_outbox (payload TEXT NOT NULL)",
    });
    const unregister = engine.registerLocalChangeCheckpoint(async (change, tx) => {
      await tx.exec("INSERT INTO probe_outbox(payload) VALUES (?)", [JSON.stringify(change)]);
    });

    await engine.tx((tx) => {
      tx.insert("notes", { id: ID, title: "original", payload: JSON.stringify({ kept: true }) });
    });
    const beforeRows = await adapter.exec("SELECT * FROM notes");
    const beforeMetadata = await adapter.exec(
      "SELECT * FROM _sync_row_meta ORDER BY tbl, row_id, col",
    );
    const beforeOutbox = await adapter.exec("SELECT * FROM probe_outbox");

    await expect(
      engine.tx((tx) => {
        tx.insert("notes", {
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890aa",
          title: "valid first",
          payload: "text",
        });
        tx.update("notes", ID, { title: "changed", payload: NESTED });
      }),
    ).rejects.toThrow("Replicated SQLite row columns must be scalar");
    await expect(
      engine.tx((tx) =>
        tx.insert("notes", {
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
          title: "new",
          payload: NESTED,
        }),
      ),
    ).rejects.toThrow("Replicated SQLite row columns must be scalar");
    await expect(
      engine.applyRemote({
        hlc: { wallMs: 2_000, counter: 0, nodeId: REMOTE_NODE },
        ops: [
          {
            type: "insert",
            table: "notes",
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890aa",
            data: {
              id: "018f0f50-7b8d-7a1c-8e2f-1234567890aa",
              title: "valid first",
              payload: "text",
            },
          },
          { type: "update", table: "notes", id: ID, patch: { title: "remote", payload: NESTED } },
        ],
      }),
    ).rejects.toThrow("Replicated SQLite row columns must be scalar");

    expect(await adapter.exec("SELECT * FROM notes")).toEqual(beforeRows);
    expect(await adapter.exec("SELECT * FROM _sync_row_meta ORDER BY tbl, row_id, col")).toEqual(
      beforeMetadata,
    );
    expect(await adapter.exec("SELECT * FROM probe_outbox")).toEqual(beforeOutbox);

    unregister();
    await adapter.close();
  });

  it("discards a legacy nested pending value when the arriving insert already wins", async () => {
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    const engine = createEngine<Schema>(adapter);
    await engine.init({
      version: 1,
      schema:
        "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, payload TEXT NOT NULL)",
    });
    await adapter.exec(
      "INSERT INTO _sync_pending_remote_updates (pending_id, tbl, row_id, patch, hlc_wall_ms, hlc_counter, hlc_node_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["legacy-losing", "notes", ID, JSON.stringify({ payload: NESTED }), 2_000, 0, REMOTE_NODE],
    );

    await engine.applyRemote({
      hlc: { wallMs: 3_000, counter: 0, nodeId: REMOTE_NODE },
      ops: [
        {
          type: "insert",
          table: "notes",
          id: ID,
          data: { id: ID, title: "inserted", payload: JSON.stringify({ kept: true }) },
        },
      ],
    });

    expect(await adapter.exec("SELECT * FROM notes WHERE id = ?", [ID])).toEqual([
      { id: ID, title: "inserted", payload: JSON.stringify({ kept: true }) },
    ]);
    expect(
      await adapter.exec("SELECT * FROM _sync_pending_remote_updates WHERE row_id = ?", [ID]),
    ).toEqual([]);
    expect(
      await adapter.exec(
        "SELECT * FROM _sync_pending_remote_update_quarantine WHERE pending_id = ?",
        ["legacy-losing"],
      ),
    ).toEqual([]);
    await adapter.close();
  });

  it("archives a legacy nested pending winner without aborting row arrival", async () => {
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    const engine = createEngine<Schema>(adapter);
    await engine.init({
      version: 1,
      schema:
        "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, payload TEXT NOT NULL)",
    });
    await adapter.exec(
      "INSERT INTO _sync_pending_remote_updates (pending_id, tbl, row_id, patch, hlc_wall_ms, hlc_counter, hlc_node_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "legacy-winning",
        "notes",
        ID,
        JSON.stringify({ title: "legacy", payload: NESTED }),
        4_000,
        0,
        REMOTE_NODE,
      ],
    );

    await engine.applyRemote({
      hlc: { wallMs: 3_000, counter: 0, nodeId: REMOTE_NODE },
      ops: [
        {
          type: "insert",
          table: "notes",
          id: ID,
          data: { id: ID, title: "inserted", payload: JSON.stringify({ kept: true }) },
        },
      ],
    });

    expect(await adapter.exec("SELECT * FROM notes WHERE id = ?", [ID])).toEqual([
      { id: ID, title: "legacy", payload: JSON.stringify({ kept: true }) },
    ]);
    expect(
      await adapter.exec("SELECT * FROM _sync_pending_remote_updates WHERE row_id = ?", [ID]),
    ).toEqual([]);
    const quarantined = await adapter.exec<{
      pending_id: string;
      patch: string;
      reason: string;
    }>("SELECT pending_id, patch, reason FROM _sync_pending_remote_update_quarantine");
    expect(quarantined).toEqual([
      {
        pending_id: "legacy-winning",
        patch: JSON.stringify({ payload: NESTED }),
        reason: "unsupported_nested_column_value",
      },
    ]);
    await adapter.exec(
      "UPDATE _sync_pending_remote_update_quarantine SET tbl = 'Notes' WHERE pending_id = ?",
      ["legacy-winning"],
    );
    await adapter.exec(
      `INSERT INTO _sync_pending_remote_update_quarantine
       SELECT 'other-row', tbl, '018f0f50-7b8d-7a1c-8e2f-1234567890ac', patch,
              hlc_wall_ms, hlc_counter, hlc_node_id, reason, quarantined_at
       FROM _sync_pending_remote_update_quarantine WHERE pending_id = ?`,
      ["legacy-winning"],
    );
    await engine.purgeLocal("notes", ID);
    expect(await adapter.exec("SELECT * FROM notes WHERE id = ?", [ID])).toEqual([]);
    expect(
      await adapter.exec("SELECT pending_id FROM _sync_pending_remote_update_quarantine"),
    ).toEqual([{ pending_id: "other-row" }]);
    await adapter.close();
  });
});
