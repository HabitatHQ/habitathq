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

  it("ULIDs generated in the same millisecond are monotonically increasing", () => {
    vi.setSystemTime(1_700_000_000_002);
    const [a, b, c] = [generateUlid(), generateUlid(), generateUlid()];
    expect(a < (b ?? "")).toBe(true);
    expect((b ?? "") < (c ?? "")).toBe(true);
    vi.useRealTimers();
  });

  it("time prefix for timestamp 0 is all zeros", () => {
    // Use a different ms first to ensure now !== lastMs when we switch to 0.
    vi.setSystemTime(999_999);
    generateUlid();
    vi.setSystemTime(0);
    const id = generateUlid();
    vi.useRealTimers();
    expect(id.slice(0, 10)).toBe("0000000000");
  });

  it("time prefix encodes timestamp 32 as '0000000010' (base-32)", () => {
    vi.setSystemTime(999_998);
    generateUlid();
    vi.setSystemTime(32);
    const id = generateUlid();
    vi.useRealTimers();
    // ENCODING[0]="0", ENCODING[1]="1"; 32 = 1*32 + 0 → "0000000010"
    expect(id.slice(0, 10)).toBe("0000000010");
  });

  it("new millisecond resets time prefix", () => {
    vi.setSystemTime(1_000);
    const a = generateUlid();
    vi.setSystemTime(2_000);
    const b = generateUlid();
    vi.useRealTimers();
    expect(a.slice(0, 10)).not.toBe(b.slice(0, 10));
  });

  it("incrementBase32 carry: 33 same-ms calls still yield monotone 26-char ULIDs", () => {
    // Generate 33 ULIDs in one ms — the last char of random wraps at 32.
    vi.setSystemTime(1_700_000_000_003);
    const ids = Array.from({ length: 33 }, () => generateUlid());
    vi.useRealTimers();
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toHaveLength(26);
      expect((ids[i - 1] ?? "") < (ids[i] ?? "")).toBe(true);
    }
  });
});
