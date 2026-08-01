/**
 * Durable sync state (Phase 1c, D2b). `nodeId`, the engine HLC, and the poll
 * cursor survive a "restart" (a new engine/transport over the same database),
 * so a leader-worker failover resumes from the persisted checkpoint instead of
 * re-hydrating from full history or churning the node identity.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import { compareHlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";
import { hlcToAfterCursor, SyncTransport, type WireChange } from "../sync.js";

interface Schema {
  notes: { id: string; title: string; updated_at: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const ALICE = "00000000-0000-0000-0000-0000000a11ce";
const BOB = "00000000-0000-0000-0000-00000000b0b0";
const SERVER_URL = "http://localhost:13742";

describe("durable sync state — nodeId + HLC across restart", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "palladium-durable-"));
    file = join(dir, "db.sqlite");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adopts the persisted nodeId and resumes the HLC after a restart", async () => {
    const engine1 = new PalladiumEngine<Schema>(
      new NodeSqliteAdapter({ vfs: { type: "file", filename: file } }),
      {
        nodeId: BOB,
      },
    );
    await engine1.init(SCHEMA);
    await engine1.insert("notes", { id: "n1", title: "hi", updated_at: 1 });
    const nodeId1 = engine1.nodeId;
    const hlc1 = engine1.currentHlc;
    expect(nodeId1).toBe(BOB);
    expect(hlc1).not.toBeNull();
    await engine1.adapter.close();

    // "Restart": a brand-new engine over the same file, seeded with a DIFFERENT
    // nodeId — the persisted one must win, and the HLC must resume.
    const engine2 = new PalladiumEngine<Schema>(
      new NodeSqliteAdapter({ vfs: { type: "file", filename: file } }),
      {
        nodeId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      },
    );
    await engine2.init(SCHEMA);

    expect(engine2.nodeId).toBe(nodeId1); // adopted, not the constructor value
    expect(engine2.currentHlc).not.toBeNull();
    // Resumed at (or after) the persisted HLC — never reset to zero.
    expect(
      compareHlc(engine2.currentHlc as NonNullable<typeof hlc1>, hlc1 as NonNullable<typeof hlc1>),
    ).toBeGreaterThanOrEqual(0);
    // The next send is strictly greater than the pre-restart HLC (no reuse).
    const next = engine2.nextSendHlc();
    expect(compareHlc(next, hlc1 as NonNullable<typeof hlc1>)).toBe(1);
    await engine2.adapter.close();
  });
});

describe("durable sync state — poll cursor across transport restart", () => {
  async function makeEngine(nodeId: string): Promise<PalladiumEngine<Schema>> {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId,
    });
    await db.init(SCHEMA);
    return db;
  }

  it("persists the cursor and resumes from it (no full re-hydration)", async () => {
    const db = await makeEngine(BOB);
    const c1: WireChange = {
      id: "c1",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "n1",
          data: { id: "n1", title: "x", updated_at: 1 },
        },
      ],
    };

    // First transport session: apply c1, which persists the cursor.
    let served = false;
    const fetch1: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") return new Response("{}", { status: 201 });
      if (!served) {
        served = true;
        return new Response(JSON.stringify([c1]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const t1 = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fetch1 });
    await t1.start();
    await t1.stop();

    const cursor = hlcToAfterCursor(c1.hlc);
    expect(await db.getSyncState("cursor")).toBe(cursor);

    // Second transport session over the same store: it must resume from the
    // persisted cursor — the very first GET carries ?after=<cursor>.
    const seenUrls: string[] = [];
    const fetch2: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "POST") return new Response("{}", { status: 201 });
      seenUrls.push(typeof input === "string" ? input : (input as URL | Request).toString());
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const t2 = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fetch2 });
    await t2.start();
    await t2.stop();

    expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes?after=${cursor}`);
  });
});
