/**
 * E2E compatibility tests: verify that `@palladium/core`'s `Hlc` round-trips
 * directly against the live Rust server's wire format.
 *
 * Both sides now share the same field shape (`wallMs`, `counter`, `nodeId`):
 * Rust uses `#[serde(rename = ...)]` to project its internal snake_case fields
 * to the camelCase wire form. No bridge function needed.
 */

import { randomUUID } from "node:crypto";
import { createHlc, hlcFromString, hlcToString } from "@palladium/core";
import { describe, expect, it } from "vitest";
import { hlcToAfterCursor, PalladiumClient } from "../client.js";
import { makeChange, makeHlc } from "../helpers.js";

const client = new PalladiumClient();

describe("hlcToAfterCursor encoding", () => {
  it("produces a cursor of the expected length", () => {
    const hlc = makeHlc({ wallMs: 1_700_000_000_000 });
    const cursor = hlcToAfterCursor(hlc);
    // 20 + 1 + 10 + 1 + 32 = 64 chars
    expect(cursor).toHaveLength(64);
  });

  it("cursor is accepted by the server as ?after= parameter", async () => {
    const change = makeChange({ hlc: makeHlc({ wallMs: 1 }) });
    await client.postChange(change);
    // Cursor pointing before any real timestamp — should return everything.
    const cursor = hlcToAfterCursor(makeHlc({ wallMs: 0 }));
    const res = await fetch(`http://localhost:13742/v1/changes?after=${cursor}`);
    expect(res.status).toBe(200);
  });
});

describe("full round-trip: core HLC → server → filtered list", () => {
  it("change posted with core HLC is retrievable with the same fields", async () => {
    const nodeId = randomUUID();
    const coreHlc = createHlc(nodeId);
    const change = makeChange({ hlc: coreHlc });
    const postRes = await client.postChange(change);
    expect(postRes.status).toBe(201);

    const all = await client.getChanges();
    const found = all.find((c) => c.id === change.id);
    expect(found).toBeDefined();
    expect(found?.hlc.wallMs).toBe(coreHlc.wallMs);
    expect(found?.hlc.nodeId).toBe(coreHlc.nodeId);
    expect(found?.hlc.counter).toBe(coreHlc.counter);
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
