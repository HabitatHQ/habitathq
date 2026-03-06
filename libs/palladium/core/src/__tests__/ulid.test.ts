import { describe, expect, it } from "vitest";
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
});
