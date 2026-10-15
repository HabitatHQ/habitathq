import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PalladiumEngine, SyncTransport, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";

interface InvalidFixture {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly expected_classification: "invalid_hlc" | "invalid_op" | "invalid_cursor";
}

type Schema = { notes: { id: string; title: string } };

const SCHEMA = {
  version: 1,
  schema: "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
};

const NODE_ID = "00000000-0000-4000-8000-000000000011";

const root = fileURLToPath(new URL("../../../protocol-fixtures/", import.meta.url));
const invalid = JSON.parse(
  readFileSync(`${root}/wire-invalid.json`, "utf8"),
) as readonly InvalidFixture[];

async function makeEngine(): Promise<PalladiumEngine<Schema>> {
  const engine = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: NODE_ID,
  });
  await engine.init(SCHEMA);
  return engine;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function validPage() {
  return {
    version: 1,
    changes: [
      {
        id: "00000000-0000-4000-8000-000000000099",
        hlc: { wallMs: Date.now(), counter: 0, nodeId: NODE_ID },
        ops: [
          {
            op: "insert",
            table: "notes",
            row_id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae",
            data: {
              id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae",
              title: "accepted after invalid fixture",
            },
          },
        ],
      },
    ],
    cursor: "2",
    upperBound: "2",
    purges: [],
    events: [],
    caughtUp: true,
    control: { mustRefetch: false },
  };
}

describe("language-neutral sync wire fixtures", () => {
  it("rejects shared malformed operation fixtures without checkpointing, then applies a valid change", async () => {
    const fixtures = invalid.filter(
      ({ expected_classification }) => expected_classification === "invalid_op",
    );
    let current: unknown = null;
    const fetch: typeof globalThis.fetch = async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (new URL(url).pathname === "/v1/clock") {
        return response({ version: 1, nowMs: Date.now(), maxFutureMs: 300_000 });
      }
      return response(current);
    };
    const engine = await makeEngine();
    const transport = new SyncTransport(engine, { serverUrl: "http://localhost:13742", fetch });
    try {
      for (const fixture of fixtures) {
        current = {
          version: 1,
          changes: [fixture.input],
          cursor: "1",
          upperBound: "1",
          purges: [],
          events: [],
          caughtUp: true,
          control: { mustRefetch: false },
        };
        await transport.poll();
        expect(transport.lastError).toMatchObject({ phase: "protocol", code: "invalid_operation" });
        expect(await engine.getSyncState("append_cursor_v1")).toBeNull();
        expect(await engine.exec<Schema["notes"]>(sql`SELECT * FROM notes`)).toEqual([]);
      }

      current = validPage();
      await transport.poll();
      expect(await engine.getSyncState("append_cursor_v1")).toBe("2");
      expect(await engine.exec<Schema["notes"]>(sql`SELECT id, title FROM notes`)).toEqual([
        { id: "018f0f50-7b8d-7a1c-8e2f-1234567890ae", title: "accepted after invalid fixture" },
      ]);
    } finally {
      await transport.dispose();
    }
  });
});
