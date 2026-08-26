import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface FixtureEnvelope {
  readonly version: 1;
  readonly changes: readonly Record<string, unknown>[];
  readonly cursor: string | null;
  readonly purges: readonly Record<string, unknown>[];
  readonly caughtUp: boolean;
  readonly control: { readonly mustRefetch: boolean };
}

interface InvalidFixture {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly expected_classification: "invalid_hlc" | "invalid_op" | "invalid_cursor";
}

const root = fileURLToPath(new URL("../../../protocol-fixtures/", import.meta.url));
const valid = JSON.parse(
  readFileSync(`${root}/changes-envelope.valid.json`, "utf8"),
) as FixtureEnvelope;
const invalid = JSON.parse(
  readFileSync(`${root}/wire-invalid.json`, "utf8"),
) as readonly InvalidFixture[];
interface Receipt {
  readonly version: 1;
  readonly outcome: "inserted" | "duplicate";
  readonly cursor: string;
}

const receipt = JSON.parse(readFileSync(`${root}/receipt.valid.json`, "utf8")) as Receipt;

describe("language-neutral sync wire fixtures", () => {
  it("round-trips a versioned page with bounded append cursor", () => {
    expect(JSON.parse(JSON.stringify(valid))).toEqual(valid);
    expect(valid.version).toBe(1);
    expect(valid.caughtUp).toBe(true);
    expect(valid.control.mustRefetch).toBe(false);
    expect(valid.changes).toHaveLength(1);
    const op = valid.changes[0]?.["ops"];
    expect(op).toEqual(expect.any(Array));
    const rowId = (op as Array<Record<string, unknown>>)[0]?.["row_id"];
    expect(rowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
  it("round-trips a typed upload receipt", () => {
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
    expect(receipt.version).toBe(1);
    expect(["inserted", "duplicate"]).toContain(receipt.outcome);
    expect(receipt.cursor).toMatch(/^\S+$/u);
  });

  it.each(invalid)("classifies $name input", ({ input, expected_classification }) => {
    if (expected_classification === "invalid_cursor") {
      expect(input["cursor"]).not.toMatch(/^(0|[1-9][0-9]*)$/u);
    } else if (expected_classification === "invalid_hlc") {
      const hlc = input["hlc"] as Record<string, unknown>;
      expect(hlc["wallMs"]).toBeLessThan(0);
    } else {
      const ops = input["ops"] as Array<Record<string, unknown>>;
      expect(ops[0]?.["op"]).not.toMatch(/^(insert|update|delete)$/u);
    }
  });
});
