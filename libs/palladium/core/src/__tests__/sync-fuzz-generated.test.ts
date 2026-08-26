/**
 * Deterministic generated protocol/lifecycle regression campaign.
 *
 * Seed: 0x37_2026_0826; corpus: protocol-fixtures/hostile-inputs.bounded.json.
 * Bounds: at most 8 KiB materialized JSON, 32 nesting levels, 16 lifecycle
 * sequences. Run with:
 * pnpm --filter @palladium/core exec vitest run src/__tests__/sync-fuzz-generated.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { SyncTransport } from "../sync.js";

interface CorpusCase {
  readonly name: string;
  readonly body?: string;
  readonly long_cursor_length?: number;
  readonly nested_depth?: number;
}

interface Corpus {
  readonly bounds: {
    readonly max_materialized_body_bytes: number;
    readonly max_nesting_depth: number;
  };
  readonly typescript: {
    readonly pages: readonly CorpusCase[];
    readonly receipts: readonly CorpusCase[];
  };
}

type Schema = { notes: { id: string; title: string } };

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../protocol-fixtures/hostile-inputs.bounded.json", import.meta.url),
    ),
    "utf8",
  ),
) as Corpus;
const SEED = 0x37202608;
const SERVER_URL = "http://generated-sync.invalid";
const NODE_ID = "00000000-0000-4000-8000-00000000b0b0";
const SCHEMA: SchemaConfig = {
  version: 1,
  schema: "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
};

function seededRandom(seed = SEED): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function nestedArray(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function materialize(template: CorpusCase): string {
  let body = template.body ?? "";
  if (template.long_cursor_length !== undefined) {
    body = body.replace("__LONG_CURSOR__", "x".repeat(template.long_cursor_length));
  }
  if (template.nested_depth !== undefined) {
    body = body.replace("__NESTED_JSON__", JSON.stringify(nestedArray(template.nested_depth)));
  }
  return body;
}

function page(cursor: string, nested: unknown = null): string {
  return JSON.stringify({
    version: 1,
    changes: [],
    purges: [],
    events: [],
    cursor,
    upperBound: cursor,
    caughtUp: true,
    control: { mustRefetch: false },
    generated: nested,
  });
}

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

async function engine(): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: NODE_ID,
  });
  await db.init(SCHEMA);
  return db;
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function outboxCount(db: PalladiumEngine<Schema>): Promise<number> {
  const rows = await db.adapter.exec<{ count: number }>(
    "SELECT COUNT(*) AS count FROM _sync_outbox",
    [],
  );
  return rows[0]?.count ?? 0;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("seeded generated SyncTransport protocol inputs", () => {
  it("preserves cursor invariants for valid, invalid, and nested generated pages", async () => {
    vi.useFakeTimers();
    const random = seededRandom();
    const generated = corpus.typescript.pages.flatMap((fixture, index) => {
      const depth = 1 + Math.floor(random() * corpus.bounds.max_nesting_depth);
      const cursor = `seed-${index}-${Math.floor(random() * 1_000_000)}`;
      return [
        { name: `${fixture.name}-seed`, body: materialize(fixture), cursor: null },
        { name: `${fixture.name}-valid`, body: page(cursor, nestedArray(depth)), cursor },
        {
          name: `${fixture.name}-nested-invalid`,
          body: JSON.stringify({
            version: 1,
            changes: [],
            purges: nestedArray(depth),
            events: [],
            cursor,
            upperBound: cursor,
            caughtUp: true,
            control: { mustRefetch: false },
          }),
          cursor: null,
        },
      ];
    });

    for (const generatedCase of generated) {
      expect(bytes(generatedCase.body)).toBeLessThanOrEqual(
        corpus.bounds.max_materialized_body_bytes,
      );
      const db = await engine();
      const transport = new SyncTransport(db, {
        serverUrl: SERVER_URL,
        fetch: async () => response(generatedCase.body),
      });
      await expect(transport.poll()).resolves.toBeUndefined();
      expect(await db.getSyncState("append_cursor_v1")).toBe(generatedCase.cursor);
      if (generatedCase.cursor === null)
        expect(await db.getSyncState("append_cursor_v1")).toBeNull();
      await transport.dispose();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("keeps generated invalid receipts durable and acknowledges valid receipts", async () => {
    vi.useFakeTimers();
    const random = seededRandom();
    const generated = corpus.typescript.receipts.flatMap((fixture, index) => {
      const cursor = `receipt-${index}-${Math.floor(random() * 1_000_000)}`;
      return [
        { name: `${fixture.name}-seed`, receipt: materialize(fixture), accepted: false },
        {
          name: `${fixture.name}-valid`,
          receipt: JSON.stringify({ version: 1, outcome: "inserted", cursor }),
          accepted: true,
        },
      ];
    });

    for (const generatedCase of generated) {
      expect(bytes(generatedCase.receipt)).toBeLessThanOrEqual(
        corpus.bounds.max_materialized_body_bytes,
      );
      const db = await engine();
      const transport = new SyncTransport(db, {
        serverUrl: SERVER_URL,
        fetch: async (_input, init) =>
          init?.method === "POST" ? response(generatedCase.receipt, 201) : response(page("0")),
      });
      await transport.poll();
      await db.insert("notes", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
        title: generatedCase.name,
      });
      await transport.syncOnce();
      expect(await outboxCount(db)).toBe(generatedCase.accepted ? 0 : 1);
      if (!generatedCase.accepted) expect(db.getSyncStatus()).toBe("degraded");
      await transport.dispose();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("runs generated lifecycle and auth callback sequences without leaked timers", async () => {
    vi.useFakeTimers();
    const random = seededRandom();
    const operations = ["start", "stop", "start", "stop"] as const;
    for (let sequence = 0; sequence < 16; sequence += 1) {
      const db = await engine();
      const rejectHeaders = random() < 0.5;
      let callbackCalls = 0;
      const transport = new SyncTransport(db, {
        serverUrl: SERVER_URL,
        pollIntervalMs: 10,
        authHeaders: async () => {
          callbackCalls += 1;
          if (rejectHeaders) throw new Error("seeded auth callback failure");
          return { Authorization: `Bearer seed-${sequence}` };
        },
        fetch: async (_input, init) => {
          expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer seed-${sequence}`);
          return response(page(`lifecycle-${sequence}`));
        },
      });

      const length = 1 + Math.floor(random() * operations.length);
      for (const operation of operations.slice(0, length)) await transport[operation]();
      expect(callbackCalls).toBeGreaterThan(0);
      if (rejectHeaders) {
        expect(await db.getSyncState("append_cursor_v1")).toBeNull();
      }
      await transport.stop();
      await transport.dispose();
      await expect(transport.start()).rejects.toThrow("disposed");
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});
