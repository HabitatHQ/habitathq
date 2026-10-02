/**
 * Column-level LWW (Phase 1b, fixes F1) — the engine must reconcile concurrent
 * edits by HLC, per column, so that:
 *   - the higher-HLC write to a column wins *regardless of arrival order*;
 *   - concurrent writes to *different* columns of a row both survive;
 *   - a delete permanently retires its UUID regardless of insert/update HLC;
 *     restoration is a new insert with a fresh UUID.
 *
 * These exercise `applyRemote({ hlc, ops })` directly (the remote-apply path)
 * against a local write, which is exactly the two-client concurrency F1
 * describes without needing a live server.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { beforeEach, describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { Hlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";

interface Schema {
  notes: { id: string; title: string; body: string; updated_at: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const ALICE = "00000000-0000-4000-8000-0000000a11ce";
const BOB = "00000000-0000-4000-8000-00000000b0b0";

function hlc(wallMs: number, counter = 0, nodeId = ALICE): Hlc {
  return { wallMs, counter, nodeId };
}

async function makeEngine(nodeId: string): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId,
  });
  await db.init(SCHEMA);
  return db;
}

describe("column-level LWW", () => {
  let db: PalladiumEngine<Schema>;

  beforeEach(async () => {
    db = await makeEngine(BOB);
  });

  it("higher-HLC remote column wins over an older local write", async () => {
    // Local write at a low HLC (mint by writing, then overwrite meta via a
    // remote change with a strictly higher HLC).
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "local",
      body: "b",
      updated_at: 1,
    });
    const localHlc = db.currentHlc;
    expect(localHlc).not.toBeNull();

    // Remote update to `title` with an HLC strictly greater than the local one.
    await db.applyRemote({
      hlc: hlc((localHlc?.wallMs ?? 0) + 1000),
      ops: [
        {
          type: "update",
          table: "notes",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          patch: { title: "remote-new" },
        },
      ],
    });

    const rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows[0]?.title).toBe("remote-new");
  });

  it("lower-HLC remote column loses to a newer local write (regardless of arrival order)", async () => {
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "local-new",
      body: "b",
      updated_at: 2,
    });
    const localHlc = db.currentHlc;

    // Remote update arrives LATER in wall-clock but carries a LOWER HLC.
    await db.applyRemote({
      hlc: hlc((localHlc?.wallMs ?? 0) - 1000),
      ops: [
        {
          type: "update",
          table: "notes",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          patch: { title: "remote-stale" },
        },
      ],
    });

    const rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows[0]?.title).toBe("local-new");
  });

  it("concurrent writes to different columns both survive", async () => {
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "T",
      body: "B",
      updated_at: 1,
    });
    const base = db.currentHlc?.wallMs ?? 0;

    // Remote edits only `body` at a higher HLC; local `title` must remain.
    await db.applyRemote({
      hlc: hlc(base + 500),
      ops: [
        {
          type: "update",
          table: "notes",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          patch: { body: "B-remote" },
        },
      ],
    });

    const rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows[0]?.title).toBe("T");
    expect(rows[0]?.body).toBe("B-remote");
  });

  it("delete tombstone: a lower-HLC update does not resurrect the row", async () => {
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "T",
      body: "B",
      updated_at: 1,
    });
    const base = db.currentHlc?.wallMs ?? 0;

    // Remote delete at a high HLC.
    await db.applyRemote({
      hlc: hlc(base + 1000),
      ops: [{ type: "delete", table: "notes", id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab" }],
    });
    expect(await db.exec(sql`SELECT * FROM notes`)).toHaveLength(0);

    // A stale (lower-HLC) update must NOT bring the row back.
    await db.applyRemote({
      hlc: hlc(base + 500),
      ops: [
        {
          type: "update",
          table: "notes",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          patch: { title: "zombie" },
        },
      ],
    });
    expect(await db.exec(sql`SELECT * FROM notes`)).toHaveLength(0);
  });

  it("deletion permanently retires a UUID across every insert/delete/update delivery order", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const operations = [
      {
        hlc: hlc(1_000),
        ops: [
          {
            type: "insert" as const,
            table: "notes" as const,
            id,
            data: { id, title: "insert", body: "body", updated_at: 1 },
          },
        ],
      },
      {
        hlc: hlc(2_000),
        ops: [{ type: "delete" as const, table: "notes" as const, id }],
      },
      {
        hlc: hlc(3_000),
        ops: [{ type: "update" as const, table: "notes" as const, id, patch: { title: "update" } }],
      },
    ];
    const permutations = (items: typeof operations): Array<typeof operations> =>
      items.length === 0
        ? [[]]
        : items.flatMap((item, index) =>
            permutations(items.filter((_, itemIndex) => itemIndex !== index)).map((rest) => [
              item,
              ...rest,
            ]),
          );
    for (const schedule of permutations(operations)) {
      const replica = await makeEngine(BOB);
      for (const change of schedule) {
        await replica.applyRemote(change);
        await replica.applyRemote(change);
      }
      expect(await replica.exec(sql`SELECT * FROM notes WHERE id = ${id}`)).toEqual([]);
      const tombstones = await replica.exec<{ hlc_wall_ms: number }>(
        sql`SELECT hlc_wall_ms FROM _sync_row_meta WHERE tbl = 'notes' AND row_id = ${id} AND col = '__palladium_deleted__'`,
      );
      expect(tombstones).toEqual([{ hlc_wall_ms: 2_000 }]);
      const pending = await replica.exec(
        sql`SELECT * FROM _sync_pending_remote_updates WHERE tbl = 'notes' AND row_id = ${id}`,
      );
      expect(pending).toEqual([]);
      await replica.adapter.close();
    }
  });

  it("delete-before-insert rejects even a higher-HLC insert and later updates", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await db.applyRemote({
      hlc: hlc(2_000),
      ops: [{ type: "delete", table: "notes", id }],
    });
    await db.applyRemote({
      hlc: hlc(9_000),
      ops: [
        {
          type: "insert",
          table: "notes",
          id,
          data: { id, title: "reborn", body: "body", updated_at: 1 },
        },
      ],
    });
    await db.applyRemote({
      hlc: hlc(10_000),
      ops: [{ type: "update", table: "notes", id, patch: { title: "zombie" } }],
    });
    expect(await db.exec(sql`SELECT * FROM notes WHERE id = ${id}`)).toEqual([]);
  });

  it("local deletion clears buffered updates for an absent row and retires its UUID", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await db.applyRemote({
      hlc: hlc(2_000),
      ops: [{ type: "update", table: "notes", id, patch: { title: "buffered" } }],
    });
    expect(
      await db.exec(
        sql`SELECT * FROM _sync_pending_remote_updates WHERE tbl = 'notes' AND row_id = ${id}`,
      ),
    ).toHaveLength(1);
    await db.delete("notes", id);
    expect(
      await db.exec(
        sql`SELECT * FROM _sync_pending_remote_updates WHERE tbl = 'notes' AND row_id = ${id}`,
      ),
    ).toEqual([]);
    await db.applyRemote({
      hlc: hlc(3_000),
      ops: [
        {
          type: "insert",
          table: "notes",
          id,
          data: { id, title: "revived", body: "body", updated_at: 1 },
        },
      ],
    });
    expect(await db.exec(sql`SELECT * FROM notes WHERE id = ${id}`)).toEqual([]);
  });

  it("rejects local insert and update of a retired UUID and restores using a new UUID", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const restoredId = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";
    await db.applyRemote({
      hlc: hlc(2_000),
      ops: [{ type: "delete", table: "notes", id }],
    });
    await expect(
      db.insert("notes", { id, title: "reuse", body: "body", updated_at: 1 }),
    ).rejects.toThrow("restore with a new UUID");
    await expect(db.update("notes", id, { title: "reuse" })).rejects.toThrow(
      "restore with a new UUID",
    );
    await db.insert("notes", { id: restoredId, title: "restored", body: "body", updated_at: 2 });
    expect(await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`)).toEqual([
      { id: restoredId, title: "restored", body: "body", updated_at: 2 },
    ]);
  });

  it("retains the newest tombstone when delayed deletes and inserts interleave", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    await db.insert("notes", { id, title: "live", body: "body", updated_at: 1 });
    const base = db.currentHlc?.wallMs ?? 0;

    await db.applyRemote({
      hlc: hlc(base + 3_000),
      ops: [{ type: "delete", table: "notes", id }],
    });
    await db.applyRemote({
      hlc: hlc(base + 1_000),
      ops: [{ type: "delete", table: "notes", id }],
    });
    await db.applyRemote({
      hlc: hlc(base + 2_000),
      ops: [
        {
          type: "insert",
          table: "notes",
          id,
          data: { id, title: "stale resurrection", body: "body", updated_at: 2 },
        },
      ],
    });

    expect(await db.exec(sql`SELECT * FROM notes WHERE id = ${id}`)).toEqual([]);
  });

  it("apply is idempotent — replaying the same remote change is a no-op", async () => {
    const h = hlc(1_700_000_000_000);
    const change = {
      hlc: h,
      ops: [
        {
          type: "insert" as const,
          table: "notes" as const,
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: {
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
            title: "once",
            body: "b",
            updated_at: 1,
          },
        },
      ],
    };
    await db.applyRemote(change);
    await db.applyRemote(change); // replay

    const rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("once");
  });
});
