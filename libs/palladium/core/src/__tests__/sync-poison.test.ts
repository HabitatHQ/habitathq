/**
 * Non-poisoning remote apply (Phase 1a, G2/D2a). A single change that fails to
 * apply (e.g. a constraint violation) must not:
 *   - roll back or skip the *other* changes in the poll, nor
 *   - wedge the poll cursor forever behind it.
 * Instead the failing change is quarantined with bounded retry; once retries
 * are exhausted it becomes permanently dead-lettered and the cursor advances
 * past it (terminal state, L71), so later changes still flow.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";
import { type SyncPageEnvelope, SyncTransport, type WireChange } from "../sync.js";

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

function page(changes: readonly WireChange[] = [], cursor: string | null = "0"): SyncPageEnvelope {
  return {
    version: 1,
    changes,
    purges: [],
    events: [],
    cursor,
    upperBound: cursor ?? "0",
    caughtUp: true,
    control: { mustRefetch: false },
  };
}

async function makeEngine(nodeId: string): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId,
  });
  await db.init(SCHEMA);
  return db;
}

function good(id: string, hlcMs: number): WireChange {
  return {
    id: `00000000-0000-4000-8000-${id.replaceAll("-", "").slice(-12)}`,
    hlc: { wallMs: hlcMs, counter: 0, nodeId: ALICE },
    ops: [
      {
        op: "insert",
        table: "notes",
        row_id: id,
        data: { id, title: id, updated_at: 1 },
      },
    ],
  };
}

/** A change whose insert omits the NOT NULL `title` column → apply throws. */
function poison(id: string, hlcMs: number): WireChange {
  return {
    id: `00000000-0000-4000-8000-${id.replaceAll("-", "").slice(-12)}`,
    hlc: { wallMs: hlcMs, counter: 0, nodeId: ALICE },
    // `data` deliberately missing `title` (NOT NULL) → constraint violation.
    ops: [{ op: "insert", table: "notes", row_id: id, data: { id, updated_at: 1 } }],
  };
}

describe("SyncTransport — non-poisoning apply", () => {
  it("a poison change is quarantined; good changes in the same batch still apply", async () => {
    const db = await makeEngine(BOB);
    const batch = [
      good("018f0f50-7b8d-7a1c-8e2f-1234567890ab", 1000),
      poison("018f0f50-7b8d-7a1c-8e2f-1234567890ad", 2000),
      good("018f0f50-7b8d-7a1c-8e2f-1234567890ac", 3000),
    ];

    // Serve the same batch on every poll (server keeps returning from cursor).
    // With bounded retry the poison eventually dead-letters and n2 lands.
    let polls = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (init?.method === "POST") return new Response(JSON.stringify({}), { status: 201 });
      if (url.includes("/v1/changes")) {
        polls += 1;
        // Return the whole batch until the cursor moves past it; simplest is to
        // always serve it — idempotent apply makes re-delivery safe.
        return new Response(JSON.stringify(page(batch)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(page()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "degraded_skip",
    });
    await transport.start(); // poll #1
    // Drive a few more polls to exercise quarantine and terminal handling.
    for (let i = 0; i < 4; i++) await transport.poll();
    await transport.stop();

    const rows = await db.exec<Schema["notes"]>(sql`SELECT id FROM notes ORDER BY id`);
    // Both good rows present; poison never applied.
    expect(rows.map((r) => r.id)).toEqual([
      "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
    ]);
    expect(polls).toBeGreaterThan(1);
  });

  it("dead-letters the poison after explicit terminal policy and records it durably", async () => {
    const db = await makeEngine(BOB);
    const batch = [poison("018f0f50-7b8d-7a1c-8e2f-1234567890ad", 2000)];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") return new Response("{}", { status: 201 });
      return new Response(JSON.stringify(page(batch)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const transport = new SyncTransport(db, {
      serverUrl: SERVER_URL,
      fetch,
      terminalPolicy: "degraded_skip",
    });
    await transport.start();
    for (let i = 0; i < 5; i++) await transport.poll();
    await transport.stop();

    const dl = await db.adapter.exec<{
      change_id: string;
      attempts: number;
      permanent: number;
    }>("SELECT change_id, attempts, permanent FROM _sync_quarantine", []);
    expect(dl).toHaveLength(1);
    expect(dl[0]?.change_id).toBe("00000000-0000-4000-8000-1234567890ad");
    expect(dl[0]?.permanent).toBe(1);
    expect(dl[0]?.attempts).toBe(1);
  });
});
