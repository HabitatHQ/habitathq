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
      "SELECT col, hlc_wall_ms, hlc_counter, hlc_node_id FROM _sync_row_meta WHERE tbl = ? AND row_id = ? ORDER BY col",
      ["notes", ID],
    );
    const beforeOutbox = await adapter.exec("SELECT COUNT(*) AS count FROM probe_outbox");

    await expect(
      engine.tx((tx) => tx.update("notes", ID, { title: "changed", payload: NESTED })),
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
          { type: "update", table: "notes", id: ID, patch: { title: "remote", payload: NESTED } },
        ],
      }),
    ).rejects.toThrow("Replicated SQLite row columns must be scalar");

    expect(await adapter.exec("SELECT * FROM notes")).toEqual(beforeRows);
    expect(
      await adapter.exec(
        "SELECT col, hlc_wall_ms, hlc_counter, hlc_node_id FROM _sync_row_meta WHERE tbl = ? AND row_id = ? ORDER BY col",
        ["notes", ID],
      ),
    ).toEqual(beforeMetadata);
    expect(await adapter.exec("SELECT COUNT(*) AS count FROM probe_outbox")).toEqual(beforeOutbox);

    unregister();
    await adapter.close();
  });
});
