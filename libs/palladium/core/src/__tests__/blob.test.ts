import { describe, expect, it } from "vitest";
import { type BlobRef, blobRefFromColumnValue, blobRefToColumnValue } from "../blob.js";

describe("BlobRef", () => {
  it("round-trips through column value", () => {
    const ref: BlobRef = { id: "abc-123", sizeBytes: 42, mimeType: "image/png" };
    const col = blobRefToColumnValue(ref);
    const ref2 = blobRefFromColumnValue(col);
    expect(ref2).toEqual(ref);
  });

  it("returns null for invalid JSON", () => {
    expect(blobRefFromColumnValue("not json")).toBeNull();
  });

  it("returns null for JSON without required fields", () => {
    expect(blobRefFromColumnValue('{"foo":"bar"}')).toBeNull();
  });

  it("returns null when field types are wrong", () => {
    expect(blobRefFromColumnValue('{"id":1,"sizeBytes":42,"mimeType":"image/png"}')).toBeNull();
    expect(
      blobRefFromColumnValue('{"id":"x","sizeBytes":"big","mimeType":"image/png"}'),
    ).toBeNull();
    expect(blobRefFromColumnValue('{"id":"x","sizeBytes":42,"mimeType":true}')).toBeNull();
  });

  it("serializes to compact JSON", () => {
    const ref: BlobRef = { id: "x", sizeBytes: 0, mimeType: "text/plain" };
    const col = blobRefToColumnValue(ref);
    expect(typeof col).toBe("string");
    const parsed: unknown = JSON.parse(col);
    expect(parsed).toEqual({ id: "x", sizeBytes: 0, mimeType: "text/plain" });
  });
});
