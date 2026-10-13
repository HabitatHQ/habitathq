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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

async function makeSeededEngine(
  nodeId: string,
  seed: (adapter: NodeSqliteAdapter) => Promise<void>,
): Promise<{ readonly db: PalladiumEngine<Schema>; readonly cleanup: () => Promise<void> }> {
  // Use a real on-disk file so the engine's init() can reopen the same
  // database after the seed. `:memory:` is per-DatabaseSync and would be
  // replaced when init() calls open() again.
  const dir = mkdtempSync(join(tmpdir(), "palladium-issue-77-"));
  const filename = join(dir, "db.sqlite");
  const adapter = new NodeSqliteAdapter({ vfs: { type: "file", filename } });
  await adapter.open();
  await adapter.exec(SCHEMA.schema);
  await adapter.exec(
    "CREATE TABLE IF NOT EXISTS _sync_row_meta (tbl TEXT NOT NULL, row_id TEXT NOT NULL, col TEXT NOT NULL, hlc_wall_ms INTEGER NOT NULL, hlc_counter INTEGER NOT NULL, hlc_node_id TEXT NOT NULL, PRIMARY KEY (tbl, row_id, col))",
  );
  await adapter.exec(
    "CREATE TABLE IF NOT EXISTS _sync_pending_remote_updates (pending_id TEXT PRIMARY KEY, tbl TEXT NOT NULL, row_id TEXT NOT NULL, patch TEXT NOT NULL, hlc_wall_ms INTEGER NOT NULL, hlc_counter INTEGER NOT NULL, hlc_node_id TEXT NOT NULL)",
  );
  await adapter.exec(
    "CREATE TABLE IF NOT EXISTS _sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  await seed(adapter);
  await adapter.close();
  const db = new PalladiumEngine<Schema>(adapter, { nodeId });
  await db.init(SCHEMA);
  return {
    db,
    cleanup: async () => {
      await db.adapter.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
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
  it("uses one LWW register for SQLite case aliases in either arrival order", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
    const newer = {
      hlc: hlc(2_000),
      ops: [
        {
          type: "insert" as const,
          table: "notes" as const,
          id,
          data: { id, title: "newer", body: "body", updated_at: 1 },
        },
      ],
    };
    const olderAlias = {
      hlc: hlc(1_000),
      ops: [
        {
          type: "update" as const,
          table: "NOTES" as never,
          id,
          patch: { TITLE: "stale" } as never,
        },
      ],
    };
    const newerFirst = await makeEngine(BOB);
    await newerFirst.applyRemote(newer);
    await newerFirst.applyRemote(olderAlias);
    const staleFirst = await makeEngine(BOB);
    await staleFirst.applyRemote(olderAlias);
    await staleFirst.applyRemote(newer);

    for (const replica of [newerFirst, staleFirst]) {
      const rows = await replica.exec<Schema["notes"]>(sql`SELECT * FROM notes WHERE id = ${id}`);
      expect(rows[0]?.title).toBe("newer");
      expect(
        await replica.exec(
          sql`SELECT tbl, col FROM _sync_row_meta WHERE row_id = ${id} AND col IN ('title', 'TITLE') ORDER BY tbl, col`,
        ),
      ).toEqual([{ tbl: "notes", col: "title" }]);
      await replica.adapter.close();
    }
  });

  it("shares a tombstone across case aliases and does not buffer stale updates after deletion", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";
    await db.applyRemote({
      hlc: hlc(2_000),
      ops: [
        {
          type: "insert",
          table: "notes",
          id,
          data: { id, title: "live", body: "b", updated_at: 1 },
        },
      ],
    });
    await db.applyRemote({
      hlc: hlc(3_000),
      ops: [{ type: "delete", table: "NOTES" as never, id }],
    });
    await db.applyRemote({
      hlc: hlc(1_000),
      ops: [{ type: "update", table: "Notes" as never, id, patch: { TITLE: "stale" } as never }],
    });
    expect(await db.exec(sql`SELECT * FROM notes WHERE id = ${id}`)).toEqual([]);
    // The ordinary column metadata written by the insert is retained by the
    // existing delete contract. The alias write is rejected (lower HLC) and
    // does not leave an alias row; only the canonical tombstone is added.
    const meta = await db.exec<{ tbl: string; col: string }>(
      sql`SELECT tbl, col FROM _sync_row_meta WHERE row_id = ${id} ORDER BY tbl, col`,
    );
    expect(meta).toEqual(
      expect.arrayContaining([
        { tbl: "notes", col: "__palladium_deleted__" },
        { tbl: "notes", col: "id" },
        { tbl: "notes", col: "title" },
        { tbl: "notes", col: "body" },
        { tbl: "notes", col: "updated_at" },
      ]),
    );
    expect(meta.every((row) => row.tbl === "notes")).toBe(true);
    const tombstoneCount = meta.filter((row) => row.col === "__palladium_deleted__").length;
    expect(tombstoneCount).toBe(1);
    expect(
      await db.exec<{ hlc_wall_ms: number }>(
        sql`SELECT hlc_wall_ms FROM _sync_row_meta WHERE row_id = ${id} AND col = '__palladium_deleted__'`,
      ),
    ).toEqual([{ hlc_wall_ms: 3_000 }]);
    expect(
      await db.exec(sql`SELECT * FROM _sync_pending_remote_updates WHERE row_id = ${id}`),
    ).toEqual([]);
  });

  it("applyRemotePage purges clear all LWW registers and pending rows for the same SQL cell", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ad";
    await db.applyRemote({
      hlc: hlc(1_000),
      ops: [
        {
          type: "insert",
          table: "notes",
          id,
          data: { id, title: "live", body: "b", updated_at: 1 },
        },
      ],
    });
    // pre-create a stale alias metadata row that the pre-#77 bug would leave
    // behind; we do this by writing the metadata directly with the canonical
    // spellings so the migration doesn't undo it.
    await db.adapter.exec(
      `INSERT INTO _sync_row_meta (tbl, row_id, col, hlc_wall_ms, hlc_counter, hlc_node_id)
       VALUES ('notes', ?, '__palladium_deleted__', 500, 0, ?),
              ('NOTES', ?, '__palladium_deleted__', 500, 0, ?),
              ('NOTES', ?, 'title', 500, 0, ?)`,
      [id, BOB, id, BOB, id, BOB],
    );
    const before = await db.exec<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM _sync_row_meta WHERE row_id = ${id}`,
    );
    expect(before[0]?.count).toBeGreaterThan(1);

    const ok = await db.applyRemotePage([], [{ table: "Notes" as never, id }], async () => {});
    expect(ok).toBe(true);
    expect(await db.exec(sql`SELECT * FROM notes WHERE id = ${id}`)).toEqual([]);
    expect(
      await db.exec<{ count: number }>(
        sql`SELECT COUNT(*) as count FROM _sync_row_meta WHERE row_id = ${id}`,
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      await db.exec<{ count: number }>(
        sql`SELECT COUNT(*) as count FROM _sync_pending_remote_updates WHERE row_id = ${id}`,
      ),
    ).toEqual([{ count: 0 }]);
  });

  it("init migration merges pre-existing tbl+col alias metadata and pending rows with diverging HLCs", async () => {
    const id = "018f0f50-7b8d-7a1c-8e2f-1234567890ae";
    // The alias has the strictly higher HLC for `title`; the canonical row
    // has the strictly higher HLC for `body`; both aliases have the same HLC
    // for `updated_at` (ties broken deterministically by nodeId).
    // The pending alias has a strictly higher HLC than the canonical pending.
    const { db, cleanup } = await makeSeededEngine(BOB, async (adapter) => {
      await adapter.exec(
        `INSERT INTO _sync_row_meta (tbl, row_id, col, hlc_wall_ms, hlc_counter, hlc_node_id) VALUES
          ('notes', ?, 'id',         1000, 0, ?),
          ('NOTES', ?, 'id',         1000, 0, ?),
          ('notes', ?, 'title',      2000, 0, ?),
          ('NOTES', ?, 'title',      3000, 0, ?),
          ('notes', ?, 'body',       4000, 0, ?),
          ('NOTES', ?, 'body',       3500, 0, ?),
          ('notes', ?, 'updated_at', 5000, 0, ?),
          ('NOTES', ?, 'updated_at', 5000, 0, ?),
          ('NOTES', ?, '__palladium_deleted__', 6000, 0, ?)`,
        [id, BOB, id, BOB, id, BOB, id, BOB, id, BOB, id, BOB, id, BOB, id, BOB, id, BOB],
      );
      await adapter.exec(
        `INSERT INTO _sync_pending_remote_updates (pending_id, tbl, row_id, patch, hlc_wall_ms, hlc_counter, hlc_node_id) VALUES
          ('canonical', 'notes', ?, '{"title":"canon"}', 7000, 0, ?),
          ('alias',     'NOTES', ?, '{"title":"alias"}', 8000, 0, ?),
          ('canon-body','notes', ?, '{"body":"canon"}',  9000, 0, ?),
          ('alias-body','NOTES', ?, '{"body":"alias"}',  6500, 0, ?)`,
        [id, BOB, id, BOB, id, BOB, id, BOB],
      );
    });
    try {
      // All _sync_row_meta rows must be keyed by canonical `tbl = notes`
      // and one row per (tbl, row_id, col) — no alias `tbl` or `col` remains.
      const tables = await db.exec<{ tbl: string }>(
        sql`SELECT DISTINCT tbl FROM _sync_row_meta WHERE row_id = ${id}`,
      );
      expect(tables).toEqual([{ tbl: "notes" }]);
      const cols = await db.exec<{ col: string }>(
        sql`SELECT DISTINCT col FROM _sync_row_meta WHERE row_id = ${id} ORDER BY col`,
      );
      expect(cols).toEqual([
        { col: "__palladium_deleted__" },
        { col: "body" },
        { col: "id" },
        { col: "title" },
        { col: "updated_at" },
      ]);
      // Highest HLC wins per column. `title` keeps the alias's 3000,
      // `body` keeps the canonical's 4000, `updated_at` is a tie at 5000.
      // HLC tie-break compares wallMs, then counter, then nodeId — both rows
      // are equal so the canonical node is the one that exists in the
      // canonical row (the alias UPDATE was skipped because canonical row
      // already exists with equal HLC). Tombstone keeps the alias 6000.
      const meta = await db.exec<{ col: string; hlc_wall_ms: number; hlc_node_id: string }>(
        sql`SELECT col, hlc_wall_ms, hlc_node_id FROM _sync_row_meta WHERE row_id = ${id}`,
      );
      const byCol = new Map(meta.map((row) => [row.col, row]));
      expect(byCol.get("id")?.hlc_wall_ms).toBe(1000);
      expect(byCol.get("title")?.hlc_wall_ms).toBe(3000);
      expect(byCol.get("body")?.hlc_wall_ms).toBe(4000);
      expect(byCol.get("updated_at")?.hlc_wall_ms).toBe(5000);
      expect(byCol.get("__palladium_deleted__")?.hlc_wall_ms).toBe(6000);
      // Pending rows must be canonical `tbl = notes` and all distinct
      // logical updates preserved. Each row carries a unique `pending_id`
      // and a distinct patch payload, so no coalescing is permitted — only
      // a `tbl` rewrite from alias to canonical.
      const pending = await db.exec<{
        pending_id: string;
        tbl: string;
        row_id: string;
        patch: string;
        hlc_wall_ms: number;
      }>(
        sql`SELECT pending_id, tbl, row_id, patch, hlc_wall_ms FROM _sync_pending_remote_updates WHERE row_id = ${id} ORDER BY pending_id`,
      );
      expect(pending).toHaveLength(4);
      for (const row of pending) expect(row.tbl).toBe("notes");
      const byId = new Map(pending.map((row) => [row.pending_id, row]));
      expect(byId.get("canonical")).toEqual({
        pending_id: "canonical",
        tbl: "notes",
        row_id: id,
        patch: '{"title":"canon"}',
        hlc_wall_ms: 7000,
      });
      expect(byId.get("alias")).toEqual({
        pending_id: "alias",
        tbl: "notes",
        row_id: id,
        patch: '{"title":"alias"}',
        hlc_wall_ms: 8000,
      });
      expect(byId.get("canon-body")).toEqual({
        pending_id: "canon-body",
        tbl: "notes",
        row_id: id,
        patch: '{"body":"canon"}',
        hlc_wall_ms: 9000,
      });
      expect(byId.get("alias-body")).toEqual({
        pending_id: "alias-body",
        tbl: "notes",
        row_id: id,
        patch: '{"body":"alias"}',
        hlc_wall_ms: 6500,
      });
    } finally {
      await cleanup();
    }
  });
});
