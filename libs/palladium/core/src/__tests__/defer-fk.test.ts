/**
 * Adapter-neutral constraint deferral (Phase 1c / D2c, G4). When a remote
 * change's ops touch a child before its parent within one atomic change, the
 * engine defers FK enforcement to COMMIT (via the adapter capability) so the
 * change applies whole — while a genuinely dangling reference is still rejected
 * at commit. Core issues no SQLite `PRAGMA` itself (`D2c`).
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { beforeEach, describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { Hlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";
import { supportsConstraintDeferral } from "../storage.js";
import { SyncTransport, type WireChange } from "../sync.js";

interface Schema {
  parent: { id: string; name: string };
  child: { id: string; parent_id: string };
}

const SCHEMA: SchemaConfig = {
  version: 1,
  schema: [
    "CREATE TABLE IF NOT EXISTS parent (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, FOREIGN KEY (parent_id) REFERENCES parent(id))",
  ].join(";\n"),
};

const ALICE = "00000000-0000-4000-8000-0000000a11ce";
const BOB = "00000000-0000-4000-8000-00000000b0b0";
const SERVER_URL = "http://localhost:13742";

function hlc(wallMs: number): Hlc {
  return { wallMs, counter: 0, nodeId: ALICE };
}

async function makeEngine(): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: BOB,
  });
  await db.init(SCHEMA);
  // node:sqlite leaves FK enforcement off by default; the browser adapter turns
  // it on at open() — mirror that here so the constraint is actually enforced.
  await db.adapter.exec("PRAGMA foreign_keys = ON");
  return db;
}

describe("adapter-neutral FK deferral (D2c)", () => {
  let db: PalladiumEngine<Schema>;

  beforeEach(async () => {
    db = await makeEngine();
  });

  it("the node adapter advertises the constraint-deferral capability", () => {
    expect(supportsConstraintDeferral(db.adapter)).toBe(true);
  });

  it("applies a change whose child op precedes its parent op (deferred to commit)", async () => {
    await db.applyRemote({
      hlc: hlc(1000),
      ops: [
        // Child first — would violate FK immediately without deferral.
        {
          type: "insert",
          table: "child",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          data: {
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
            parent_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
          },
        },
        {
          type: "insert",
          table: "parent",
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
          data: { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac", name: "P" },
        },
      ],
    });

    const kids = await db.exec<Schema["child"]>(sql`SELECT * FROM child`);
    const parents = await db.exec<Schema["parent"]>(sql`SELECT * FROM parent`);
    expect(kids).toHaveLength(1);
    expect(parents).toHaveLength(1);
    expect(kids[0]?.parent_id).toBe("018f0f50-7b8d-7a1c-8e2f-1234567890ac");
  });

  it("still rejects a genuinely dangling FK at commit (deferral ≠ disabling)", async () => {
    await expect(
      db.applyRemote({
        hlc: hlc(2000),
        // References a parent that is never inserted → FK fails at COMMIT.
        ops: [
          {
            type: "insert",
            table: "child",
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad",
            data: {
              id: "018f0f50-7b8d-7a1c-8e2f-1234567890ad",
              parent_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae",
            },
          },
        ],
      }),
    ).rejects.toThrow();

    // The whole change rolled back — no orphan child.
    const kids = await db.exec<Schema["child"]>(sql`SELECT * FROM child`);
    expect(kids).toHaveLength(0);
  });

  it("quarantines a dangling deferred FK when page application reaches commit", async () => {
    const change: WireChange = {
      id: "00000000-0000-4000-8000-0000000000c3",
      hlc: hlc(3000),
      ops: [
        {
          // This succeeds until the adapter commits the deferred transaction.
          op: "insert",
          table: "child",
          row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890af",
          data: {
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890af",
            parent_id: "018f0f50-7b8d-7a1c-8e2f-1234567890b0",
          },
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
          cursor: "3",
          upperBound: "3",
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

    const quarantined = await transport.inspectQuarantine();
    expect(quarantined).toEqual([
      expect.objectContaining({
        phase: "downlink",
        changeId: change.id,
        attempts: 1,
        permanent: false,
      }),
    ]);
    const kids = await db.exec<Schema["child"]>(sql`SELECT * FROM child`);
    expect(kids).toEqual([]);
    expect(await db.getSyncState("append_cursor_v1")).toBeNull();
    await transport.dispose();
  });
});
