import { randomUUID } from "node:crypto";
import { createHlc, hlcFromString, hlcToString } from "@palladium/core";
import { describe, expect, it } from "vitest";
import { hlcToAfterCursor, PalladiumClient } from "../client.js";
import { makeChange } from "../helpers.js";

const client = new PalladiumClient();

describe("HLC cursor compatibility", () => {
  it("produces a sort-key cursor accepted by the generic server", async () => {
    const cursor = hlcToAfterCursor(createHlc(randomUUID()));

    expect(cursor).toHaveLength(64);
    expect((await fetch(`http://localhost:13742/v1/changes?after=${cursor}`)).status).toBe(200);
  });
});

describe("full round-trip: core HLC → server → filtered list", () => {
  it("returns a posted change with the same HLC fields", async () => {
    const coreHlc = createHlc(randomUUID());
    const change = makeChange({ hlc: coreHlc });

    expect((await client.postChange(change)).status).toBe(201);

    const found = (await client.getChanges()).find((candidate) => candidate.id === change.id);
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
