import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PalladiumEngine } from "../engine.js";
import { compareHlc, type Hlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";

type Schema = Record<string, { id: string; title: string; body: string }>;

const NODE = "00000000-0000-4000-8000-00000000c0c0";
const ROW = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL)",
};

function makeInMemoryEngine(nodeId = NODE): PalladiumEngine<Schema> {
  return new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId,
  });
}

function attemptMutation(hlc: Hlc): void {
  Reflect.set(hlc, "wallMs", Number.MAX_SAFE_INTEGER);
  Reflect.set(hlc, "counter", 0xffff_ffff);
  Reflect.set(hlc, "nodeId", "00000000-0000-4000-8000-000000000000");
}

describe("issue #87 — exposed HLC references cannot poison the engine clock", () => {
  it("currentHlc and nextSendHlc references cannot mutate the next clock", () => {
    const engine = makeInMemoryEngine();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const issued = engine.nextSendHlc();
      const getter = engine.currentHlc;
      expect(getter).not.toBeNull();
      if (getter === null) throw new Error("expected current HLC");
      const floor: Hlc = { ...issued };
      attemptMutation(issued);
      attemptMutation(getter);
      expect(issued).toEqual(floor);
      expect(getter).toEqual(floor);

      const next = engine.nextSendHlc();
      expect(compareHlc(next, floor)).toBeGreaterThan(0);
      expect(engine.currentHlc).toEqual(next);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("changes:local event and durable checkpoint HLC references cannot mutate durable state", async () => {
    const engine = makeInMemoryEngine();
    await engine.init(SCHEMA);
    let eventHlc: Hlc | undefined;
    let checkpointHlc: Hlc | undefined;
    engine.on("changes:local", (change) => {
      eventHlc = change.hlc;
    });
    engine.registerLocalChangeCheckpoint(async (change) => {
      checkpointHlc = change.hlc;
    });

    await engine.insert("notes", { id: ROW, title: "first", body: "retained" });
    expect(eventHlc).toBeDefined();
    expect(checkpointHlc).toBeDefined();
    if (eventHlc === undefined || checkpointHlc === undefined) {
      throw new Error("expected event and checkpoint HLC references");
    }
    const saved = await engine.getSyncState("hlc");
    expect(saved).not.toBeNull();
    const floor: Hlc = { ...eventHlc };

    attemptMutation(eventHlc);
    attemptMutation(checkpointHlc);
    expect(eventHlc).toEqual(floor);
    expect(checkpointHlc).toEqual(floor);
    expect(engine.currentHlc).toEqual(floor);
    expect(await engine.getSyncState("hlc")).toBe(saved);

    await engine.update("notes", ROW, { title: "later" });
    const current = engine.currentHlc;
    const durable = await engine.getSyncState("hlc");
    expect(current).not.toBeNull();
    expect(durable).not.toBeNull();
    if (current === null) throw new Error("expected current HLC");
    expect(compareHlc(current, floor)).toBeGreaterThan(0);
    expect(durable).not.toBe(saved);
  });

  describe("durable HLC across restart", () => {
    let directory: string;
    let file: string;
    const engines: PalladiumEngine<Schema>[] = [];

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "palladium-hlc-reference-"));
      file = join(directory, "notes.sqlite");
    });
    afterEach(async () => {
      for (const engine of engines.splice(0)) await engine.adapter.close();
      rmSync(directory, { recursive: true, force: true });
    });

    async function open(): Promise<PalladiumEngine<Schema>> {
      const engine = new PalladiumEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename: file } }),
        { nodeId: NODE },
      );
      engines.push(engine);
      await engine.init(SCHEMA);
      return engine;
    }

    it("cannot advance a persisted HLC by mutating a retained reference; restart stays monotonic", async () => {
      const first = await open();
      await first.insert("notes", { id: ROW, title: "first", body: "retained" });
      const captured = first.currentHlc;
      expect(captured).not.toBeNull();
      if (captured === null) throw new Error("expected initial HLC");
      const floor: Hlc = { ...captured };
      const persisted = await first.getSyncState("hlc");
      expect(persisted).not.toBeNull();
      attemptMutation(captured);
      expect(captured).toEqual(floor);
      expect(await first.getSyncState("hlc")).toBe(persisted);
      await first.update("notes", ROW, { title: "before restart" });
      expect(first.currentHlc?.wallMs).toBeLessThan(Number.MAX_SAFE_INTEGER);
      const firstResumeFloor = first.currentHlc;
      if (firstResumeFloor === null) throw new Error("expected updated HLC");
      const updatedPersisted = await first.getSyncState("hlc");
      expect(updatedPersisted).not.toBe(persisted);
      await first.adapter.close();
      engines.splice(engines.indexOf(first), 1);

      const reopened = await open();
      expect(await reopened.getSyncState("hlc")).toBe(updatedPersisted);
      await reopened.update("notes", ROW, { title: "after restart" });
      const resumed = reopened.currentHlc;
      expect(resumed).not.toBeNull();
      if (resumed === null) throw new Error("expected resumed HLC");
      expect(compareHlc(resumed, firstResumeFloor)).toBeGreaterThan(0);
      expect(resumed.wallMs).toBeLessThan(Number.MAX_SAFE_INTEGER);
      expect(await reopened.getSyncState("hlc")).toBeTruthy();
    });
  });
});
