/**
 * Bounded protocol corpus regression tests. The fixture is intentionally small and
 * deterministic; this is the CI seed for longer external fuzzing campaigns.
 * Campaign: pnpm --filter @palladium/core exec vitest run src/__tests__/sync-fuzz-corpus.test.ts
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
  readonly bounds: { readonly max_materialized_body_bytes: number };
  readonly typescript: { readonly pages: CorpusCase[]; readonly receipts: CorpusCase[] };
}

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../protocol-fixtures/hostile-inputs.bounded.json", import.meta.url),
    ),
    "utf8",
  ),
) as Corpus;
const SERVER_URL = "http://sync-corpus.invalid";
const NODE_ID = "00000000-0000-4000-8000-00000000b0b0";
const SCHEMA: SchemaConfig = {
  version: 1,
  schema: "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
};
type Schema = { notes: { id: string; title: string } };

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

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

async function engine(): Promise<PalladiumEngine<Schema>> {
  const db = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: NODE_ID,
  });
  await db.init(SCHEMA);
  return db;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded TypeScript protocol corpus", () => {
  it.each(
    corpus.typescript.pages,
  )("rejects $name without advancing or throwing", async (fixture) => {
    vi.useFakeTimers();
    const db = await engine();
    const fetch: typeof globalThis.fetch = async () => jsonResponse(materialize(fixture));
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });

    await expect(transport.poll()).resolves.toBeUndefined();
    expect(await db.getSyncState("append_cursor_v1")).toBeNull();
    await transport.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(corpus.typescript.receipts)("retains the outbox for $name", async (fixture) => {
    vi.useFakeTimers();
    const db = await engine();
    const fetch: typeof globalThis.fetch = async (_input, init) =>
      init?.method === "POST"
        ? jsonResponse(materialize(fixture), 201)
        : jsonResponse(
            JSON.stringify({
              version: 1,
              changes: [],
              purges: [],
              events: [],
              cursor: "0",
              upperBound: "0",
              caughtUp: true,
              control: { mustRefetch: false },
            }),
          );
    const transport = new SyncTransport(db, { serverUrl: SERVER_URL, fetch });
    await transport.poll();
    await db.insert("notes", { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab", title: fixture.name });
    await Promise.resolve();
    await transport.stop();
    const rows = await db.adapter.exec<{ change_id: string }>(
      "SELECT change_id FROM _sync_outbox",
      [],
    );
    expect(rows).toHaveLength(1);
    await transport.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds fixture materialization", () => {
    for (const fixture of [...corpus.typescript.pages, ...corpus.typescript.receipts]) {
      expect(new TextEncoder().encode(materialize(fixture)).byteLength).toBeLessThanOrEqual(
        corpus.bounds.max_materialized_body_bytes,
      );
    }
  });
});
