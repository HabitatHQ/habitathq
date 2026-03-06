/**
 * E2E tests for `POST /v1/changes` and `GET /v1/changes`.
 */

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PalladiumClient, hlcToAfterCursor } from "../client.js";
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
    // Axum returns 422 (Unprocessable Entity) for valid JSON that doesn't
    // match the schema; 400 for completely malformed JSON.
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
    const hlc = makeHlc({ node_id: nodeId });
    // Op::Update uses { col, value } not { data }; Op::Delete has no data field.
    const change = makeChange({
      hlc,
      ops: [
        insertOp("users", randomUUID(), { name: "Alice" }),
        { op: "update", table: "users", row_id: randomUUID(), col: "name", value: "Bob" },
        { op: "delete", table: "users", row_id: randomUUID() },
      ],
    });
    const res = await client.postChange(change);
    expect(res.status).toBe(201);
  });
});

describe("GET /v1/changes", () => {
  beforeEach(async () => {
    // Insert a known change so assertions have stable data.
    await client.postChange(makeChange());
  });

  it("returns 200 with an array", async () => {
    const changes = await client.getChanges();
    expect(Array.isArray(changes)).toBe(true);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("change objects have required fields", async () => {
    const changes = await client.getChanges();
    const first = changes[0];
    expect(first).toBeDefined();
    // id is a UUID string
    expect(typeof first?.id).toBe("string");
    expect(first?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // hlc has millis, counter, node_id
    expect(typeof first?.hlc.millis).toBe("number");
    expect(typeof first?.hlc.counter).toBe("number");
    expect(typeof first?.hlc.node_id).toBe("string");
    // ops is an array
    expect(Array.isArray(first?.ops)).toBe(true);
  });

  it("cursor pagination returns only newer changes", async () => {
    // Post a change and capture its HLC as cursor.
    const pivot = makeChange({ hlc: makeHlc({ millis: Date.now() }) });
    await client.postChange(pivot);
    const cursor = hlcToAfterCursor(pivot.hlc);

    // Post another change after the cursor.
    const later = makeChange({ hlc: makeHlc({ millis: pivot.hlc.millis + 1 }) });
    await client.postChange(later);

    const after = await client.getChanges(cursor);
    // Should include `later` but NOT `pivot` itself.
    const ids = after.map((c) => c.id);
    expect(ids).toContain(later.id);
    expect(ids).not.toContain(pivot.id);
  });

  it("returns 400 for a malformed cursor", async () => {
    const res = await fetch("http://localhost:13742/v1/changes?after=not-valid-cursor");
    expect(res.status).toBe(400);
  });

  it("returns changes that were previously inserted", async () => {
    const change = makeChange();
    await client.postChange(change);
    const all = await client.getChanges();
    const found = all.find((c) => c.id === change.id);
    expect(found).toBeDefined();
  });
});
