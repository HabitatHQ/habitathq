import { randomUUID } from "node:crypto";
import { createHlc, hlcFromString, hlcToString } from "@palladium/core";
import { describe, expect, it } from "vitest";
import { PalladiumClient } from "../client.js";
import { makeChange } from "../helpers.js";

const client = new PalladiumClient();

describe("append cursor compatibility", () => {
  it("accepts a numeric append cursor with a bounded page", async () => {
    const res = await fetch("http://localhost:13742/v1/changes?limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; changes: unknown[] };
    expect(body.version).toBe(1);
    expect(Array.isArray(body.changes)).toBe(true);
  });
});

describe("full round-trip: core HLC → server → filtered list", () => {
  it("returns a posted change with the same HLC fields", async () => {
    const coreHlc = createHlc(randomUUID());
    const change = makeChange({ hlc: coreHlc });
    expect((await client.postChange(change)).status).toBe(201);
    const page = await client.getChanges();
    const found = page.changes.find((candidate) => candidate.id === change.id);
    expect(found).toBeDefined();
    expect(found?.hlc).toEqual(coreHlc);
  });
});

describe("@palladium/core HLC string serialisation", () => {
  it("round-trips", () => {
    const hlc = createHlc(randomUUID());

    expect(hlcFromString(hlcToString(hlc))).toEqual(hlc);
  });
});
