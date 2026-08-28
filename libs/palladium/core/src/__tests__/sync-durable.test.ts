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
import { sql } from "../sql.js";
import { SyncTransport, type WireChange } from "../sync.js";

interface Schema {
  notes: { id: string; title: string; updated_at: number };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const ALICE = "00000000-0000-4000-8000-0000000a11ce";
const BOB = "00000000-0000-4000-8000-00000000b0b0";
const SERVER_URL = "http://localhost:13742";

const ALTERNATE_SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0)",
};

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
    await engine1.insert("notes", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      title: "hi",
      updated_at: 1,
    });
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
    const resumed = engine2.currentHlc;
    expect(resumed).not.toBeNull();
    expect(hlc1).not.toBeNull();
    if (resumed === null || hlc1 === null) throw new Error("expected non-null HLCs after restart");
    // Resumed at (or after) the persisted HLC — never reset to zero.
    expect(compareHlc(resumed, hlc1)).toBeGreaterThanOrEqual(0);
    // The next send is strictly greater than the pre-restart HLC (no reuse).
    const next = engine2.nextSendHlc();
    expect(compareHlc(next, hlc1)).toBe(1);
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
      id: "00000000-0000-4000-8000-0000000000c1",
      hlc: { wallMs: 1_700_000_000_000, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: "x", updated_at: 1 },
        },
      ],
    };

    // First transport session: apply c1, which persists the cursor.
    let served = false;
    const fetch1: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") return new Response("{}", { status: 201 });
      if (!served) {
        served = true;
        return new Response(
          JSON.stringify({
            version: 1,
            changes: [c1],
            cursor: "1",
            upperBound: "1",
            purges: [],
            events: [],
            caughtUp: true,
            control: { mustRefetch: false },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          version: 1,
          changes: [],
          purges: [],
          events: [],
          cursor: "1",
          upperBound: "1",
          caughtUp: true,
          control: { mustRefetch: false },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const t1 = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fetch1 });
    await t1.start();
    await t1.dispose();

    const cursor = "1";
    expect(await db.getSyncState("append_cursor_v1")).toBe(cursor);

    // Second transport session over the same store: it must resume from the
    // persisted cursor — the first GET carries ?limit=100&cursor=<cursor>.
    const seenUrls: string[] = [];
    const fetch2: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "POST") return new Response("{}", { status: 201 });
      seenUrls.push(
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href,
      );
      return new Response(
        JSON.stringify({
          version: 1,
          changes: [],
          purges: [],
          events: [],
          cursor: "1",
          upperBound: "1",
          caughtUp: true,
          control: { mustRefetch: false },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const t2 = new SyncTransport(db, { serverUrl: SERVER_URL, fetch: fetch2 });
    await t2.start();
    await t2.dispose();

    expect(seenUrls[0]).toBe(`${SERVER_URL}/v1/changes?limit=100&cursor=${cursor}`);
  });

  it("quarantines an atomic remote change without committing its valid prefix", async () => {
    const db = await makeEngine(BOB);
    const change: WireChange = {
      id: "00000000-0000-4000-8000-0000000000c2",
      hlc: { wallMs: 1_700_000_000_001, counter: 0, nodeId: ALICE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad",
          data: {
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad",
            title: "must roll back",
            updated_at: 1,
          },
        },
        {
          // The second operation fails after the first has mutated the row.
          op: "insert",
          table: "notes",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae", updated_at: 1 },
        },
      ],
    };
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") return new Response("{}", { status: 201 });
      return new Response(
        JSON.stringify({
          version: 1,
          changes: [change],
          purges: [],
          events: [],
          cursor: "2",
          upperBound: "2",
          caughtUp: true,
          control: { mustRefetch: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "block",
    });

    await expect(transport.poll()).resolves.toBeUndefined();

    const notes = await db.exec<Schema["notes"]>(
      sql`SELECT id FROM notes WHERE id = ${"018f0f50-7b8d-7a1c-8e2f-1234567890ad"}`,
    );
    expect(notes).toEqual([]);
    expect(await transport.inspectQuarantine()).toEqual([
      expect.objectContaining({
        phase: "downlink",
        changeId: change.id,
        attempts: 1,
        permanent: false,
      }),
    ]);
    expect(await db.getSyncState("append_cursor_v1")).toBeNull();
    expect(db.getSyncStatus()).toBe("degraded");
    await transport.dispose();
  });
});

describe("durable sync state — schema identity", () => {
  it("persists the initialized fingerprint in sync state", async () => {
    const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
      nodeId: ALICE,
    });
    await db.init(SCHEMA);
    const identity = db.initializedSchemaIdentity;
    expect(identity).toMatch(/^v1-1-[0-9a-f]{8}$/u);
    expect(await db.getSyncState("schema_identity_v1")).toBe(identity);
    await db.adapter.close();
  });

  it("rejects a different schema identity for an existing database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "palladium-schema-identity-"));
    const file = join(dir, "db.sqlite");
    try {
      const first = new PalladiumEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename: file } }),
        { nodeId: ALICE },
      );
      await first.init(SCHEMA);
      const originalIdentity = first.initializedSchemaIdentity;
      await first.adapter.close();

      const second = new PalladiumEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename: file } }),
        { nodeId: ALICE },
      );
      await expect(second.init(ALTERNATE_SCHEMA)).rejects.toMatchObject({
        name: "SchemaIdentityMismatchError",
        actual: originalIdentity,
      });
      await second.adapter.close();

      const reopened = new PalladiumEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename: file } }),
        { nodeId: ALICE },
      );
      await reopened.init(SCHEMA);
      expect(await reopened.getSyncState("schema_identity_v1")).toBe(originalIdentity);
      await reopened.adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
