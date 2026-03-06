/**
 * E2E compatibility tests: verify that the TypeScript `@palladium/core` types
 * round-trip correctly against the live Rust server's wire format.
 *
 * These tests bridge the field-name difference between the two packages:
 *   - @palladium/core: { wallMs, counter, nodeId }
 *   - Rust server:     { millis, counter, node_id }
 */

import { randomUUID } from "node:crypto";
import { createHlc, hlcFromString, hlcToString } from "@palladium/core";
import { describe, expect, it } from "vitest";
import { PalladiumClient, coreHlcToServer, hlcToAfterCursor } from "../client.js";
import { makeChange } from "../helpers.js";

const client = new PalladiumClient();

describe("coreHlcToServer conversion", () => {
  it("maps wallMs → millis", () => {
    const core = createHlc(randomUUID());
    const server = coreHlcToServer(core);
    expect(server.millis).toBe(core.wallMs);
  });

  it("preserves counter", () => {
    const core = createHlc(randomUUID());
    const server = coreHlcToServer(core);
    expect(server.counter).toBe(core.counter);
  });

  it("maps nodeId → node_id", () => {
    const nodeId = randomUUID();
    const core = createHlc(nodeId);
    const server = coreHlcToServer(core);
    expect(server.node_id).toBe(core.nodeId);
  });
});

describe("hlcToAfterCursor encoding", () => {
  it("produces a cursor of the expected length", () => {
    const hlc = { millis: 1_700_000_000_000, counter: 0, node_id: randomUUID() };
    const cursor = hlcToAfterCursor(hlc);
    // 20 + 1 + 10 + 1 + 32 = 64 chars
    expect(cursor).toHaveLength(64);
  });

  it("cursor is accepted by the server as ?after= parameter", async () => {
    const change = makeChange({ hlc: { millis: 1, counter: 0, node_id: randomUUID() } });
    await client.postChange(change);
    // Cursor pointing before any real timestamp — should return everything.
    const cursor = hlcToAfterCursor({ millis: 0, counter: 0, node_id: randomUUID() });
    const res = await fetch(`http://localhost:13742/v1/changes?after=${cursor}`);
    expect(res.status).toBe(200);
  });
});

describe("full round-trip: core HLC → server → cursor → filtered list", () => {
  it("change posted with core HLC is retrievable", async () => {
    const nodeId = randomUUID();
    const coreHlc = createHlc(nodeId);
    const change = makeChange({ hlc: coreHlcToServer(coreHlc) });
    const postRes = await client.postChange(change);
    expect(postRes.status).toBe(201);

    const all = await client.getChanges();
    const found = all.find((c) => c.id === change.id);
    expect(found).toBeDefined();
    // Server echoes back millis/node_id fields.
    expect(found?.hlc.millis).toBe(coreHlc.wallMs);
    expect(found?.hlc.node_id).toBe(coreHlc.nodeId);
  });
});

describe("@palladium/core HLC string serialisation", () => {
  it("hlcToString / hlcFromString round-trips", () => {
    const nodeId = randomUUID();
    const hlc = createHlc(nodeId);
    const str = hlcToString(hlc);
    const back = hlcFromString(str);
    expect(back.wallMs).toBe(hlc.wallMs);
    expect(back.counter).toBe(hlc.counter);
    expect(back.nodeId).toBe(hlc.nodeId);
  });
});
