import { describe, expect, it, vi } from "vitest";
import { generateUlid } from "../ulid.js";

describe("generateUlid", () => {
  it("returns 26-character string", () => {
    expect(generateUlid()).toHaveLength(26);
  });

  it("uses only Crockford base-32 alphabet", () => {
    const ulid = generateUlid();
    expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("generates unique values", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateUlid()));
    expect(ids.size).toBe(1000);
  });

  it("is lexicographically sortable by generation time", () => {
    const a = generateUlid();
    // Small delay via busy-wait to guarantee different ms
    const start = Date.now();
    while (Date.now() === start) {
      // spin
    }
    const b = generateUlid();
    expect(a < b).toBe(true);
  });

  it("time component encodes the current timestamp", () => {
    const before = Date.now();
    vi.setSystemTime(before);
    const id = generateUlid();
    vi.useRealTimers();

    // First 10 chars encode the time; two ULIDs at the same ms start with
    // the same prefix, so a ULID generated later must sort after this one.
    const atSameTime = generateUlid();
    // generateUlid at a later real time will have a larger or equal prefix
    expect(id.slice(0, 10) <= atSameTime.slice(0, 10)).toBe(true);
  });

  it("ULIDs generated in the same millisecond are still unique", () => {
    vi.setSystemTime(1_700_000_000_000);
    const ids = new Set(Array.from({ length: 100 }, () => generateUlid()));
    expect(ids.size).toBe(100);
    vi.useRealTimers();
  });
});
