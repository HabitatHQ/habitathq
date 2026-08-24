import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ServerChange } from "../client.js";
import { PalladiumClient } from "../client.js";

interface FixtureEnvelope {
  readonly changes: readonly ServerChange[];
  readonly cursor: string;
  readonly purges: readonly unknown[];
  readonly events: readonly unknown[];
}

interface InvalidFixture {
  readonly name: string;
  readonly input: unknown;
  readonly expected_classification: "invalid_hlc" | "invalid_op" | "invalid_cursor";
}

const root = fileURLToPath(new URL("../../../protocol-fixtures/", import.meta.url));
const valid = JSON.parse(
  readFileSync(`${root}/changes-envelope.valid.json`, "utf8"),
) as FixtureEnvelope;
const invalid = JSON.parse(
  readFileSync(`${root}/wire-invalid.json`, "utf8"),
) as readonly InvalidFixture[];
const client = new PalladiumClient();

describe("language-neutral sync wire fixtures", () => {
  it("round-trips the valid envelope through JSON", () => {
    expect(JSON.parse(JSON.stringify(valid))).toEqual(valid);
    expect(valid.cursor).toMatch(/^(0|[1-9][0-9]*)$/);
  });

  it("accepts and returns the valid shared change", async () => {
    const change = valid.changes[0];
    if (change === undefined) throw new Error("valid fixture must contain a change");

    expect((await client.postChange(change)).status).toBe(201);
    expect((await client.getChanges()).some((candidate) => candidate.id === change.id)).toBe(true);
  });

  it.each(invalid)("classifies $name input", async ({ input, expected_classification }) => {
    if (expected_classification === "invalid_cursor") {
      const cursor =
        typeof input === "object" && input !== null && "cursor" in input ? input.cursor : undefined;
      if (typeof cursor !== "string") throw new Error("invalid cursor fixture");

      expect((await fetch(`http://localhost:13742/v1/changes?after=${cursor}`)).status).toBe(400);
      return;
    }

    const res = await fetch("http://localhost:13742/v1/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
