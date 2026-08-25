/**
 * Column-level LWW (Phase 1b, fixes F1) — the engine must reconcile concurrent
 * edits by HLC, per column, so that:
 *   - the higher-HLC write to a column wins *regardless of arrival order*;
 *   - concurrent writes to *different* columns of a row both survive;
 *   - a delete and an update reconcile by HLC (tombstone), and a lower-HLC
 *     update cannot resurrect a deleted row.
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

  it("delete tombstone: a higher-HLC insert resurrects the row", async () => {
    await db.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "T",
      body: "B",
      updated_at: 1,
    });
    const base = db.currentHlc?.wallMs ?? 0;

    await db.applyRemote({
      hlc: hlc(base + 500),
      ops: [{ type: "delete", table: "notes", id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab" }],
    });
    expect(await db.exec(sql`SELECT * FROM notes`)).toHaveLength(0);

    await db.applyRemote({
      hlc: hlc(base + 1000),
      ops: [
        {
          type: "insert",
          table: "notes",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: {
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
            title: "reborn",
            body: "B2",
            updated_at: 3,
          },
        },
      ],
    });
    const rows = await db.exec<Schema["notes"]>(sql`SELECT * FROM notes`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("reborn");
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
