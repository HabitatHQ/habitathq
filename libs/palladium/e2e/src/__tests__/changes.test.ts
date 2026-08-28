/**
 * E2E tests for `POST /v1/changes` and `GET /v1/changes`.
 */

import { randomUUID } from "node:crypto";
import { generateUuidV7 } from "@palladium/core";
import { beforeEach, describe, expect, it } from "vitest";
import { PalladiumClient } from "../client.js";
import { insertOp, makeChange, makeHlc } from "../helpers.js";

const client = new PalladiumClient();

describe("POST /v1/changes", () => {
  it("returns 201 for a valid change", async () => {
    const res = await client.postChange(makeChange());
    expect(res.status).toBe(201);
  });
  it("returns 4xx for an invalid body", async () => {
    const res = await fetch("http://localhost:13742/v1/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"not":"a change"}',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
  it("returns 400 for malformed JSON", async () => {
    const res = await fetch("http://localhost:13742/v1/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
  it("accepts a change with multiple ops", async () => {
    const nodeId = randomUUID();
    const hlc = makeHlc({ nodeId });
    const change = makeChange({
      hlc,
      ops: [
        insertOp("users", generateUuidV7(), { name: "Alice" }),
        { op: "update", table: "users", row_id: generateUuidV7(), col: "name", value: "Bob" },
        { op: "delete", table: "users", row_id: generateUuidV7() },
      ],
    });
    expect((await client.postChange(change)).status).toBe(201);
  });
});

describe("GET /v1/changes", () => {
  beforeEach(async () => {
    await client.postChange(makeChange());
  });
  it("returns 200 with a versioned page", async () => {
    const page = await client.getChanges();
    expect(page.version).toBe(1);
    expect(Array.isArray(page.changes)).toBe(true);
    expect(page.changes.length).toBeGreaterThan(0);
  });
  it("change objects have required fields", async () => {
    const page = await client.getChanges();
    const first = page.changes[0];
    expect(first).toBeDefined();
    expect(typeof first?.id).toBe("string");
    expect(typeof first?.hlc.wallMs).toBe("number");
    expect(typeof first?.hlc.counter).toBe("number");
    expect(typeof first?.hlc.nodeId).toBe("string");
    expect(Array.isArray(first?.ops)).toBe(true);
  });
  it("cursor pagination returns only newer changes", async () => {
    const pivot = makeChange({ hlc: makeHlc({ wallMs: Date.now() }) });
    await client.postChange(pivot);
    const first = await client.getChanges();
    expect(first.cursor).not.toBeNull();
    const later = makeChange({ hlc: makeHlc({ wallMs: pivot.hlc.wallMs + 1 }) });
    await client.postChange(later);
    const after = await client.getChanges(first.cursor ?? undefined);
    const ids = after.changes.map((c) => c.id);
    expect(ids).toContain(later.id);
    expect(ids).not.toContain(pivot.id);
  });
  it("returns 400 for a malformed cursor", async () => {
    const res = await fetch("http://localhost:13742/v1/changes?cursor=not-valid-cursor");
    expect(res.status).toBe(400);
  });
  it("returns changes that were previously inserted", async () => {
    const change = makeChange();
    await client.postChange(change);
    const page = await client.getChanges();
    expect(page.changes.find((c) => c.id === change.id)).toBeDefined();
  });
});
