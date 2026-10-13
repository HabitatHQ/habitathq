import { describe, expect, it } from "vitest";
import { MemoryBlobAdapter } from "../memory-blob-adapter.js";

describe("MemoryBlobAdapter", () => {
  it("does not let caller mutations of put input change stored bytes", async () => {
    const adapter = new MemoryBlobAdapter();
    const input = new Uint8Array([1, 2]);
    await adapter.put("x", input);
    input[0] = 9;
    const stored = Array.from((await adapter.get("x")) ?? []);
    expect(stored).toEqual([1, 2]);
    await adapter.dispose();
  });

  it("does not let caller mutations of a get result change stored bytes", async () => {
    const adapter = new MemoryBlobAdapter();
    await adapter.put("x", new Uint8Array([1, 2]));
    const first = await adapter.get("x");
    expect(first).not.toBeNull();
    if (!first) throw new Error("expected stored bytes");
    first[1] = 8;
    const stored = Array.from((await adapter.get("x")) ?? []);
    expect(stored).toEqual([1, 2]);
    await adapter.dispose();
  });

  it("preserves stored bytes across input mutation, result mutation, and repeated reads", async () => {
    const adapter = new MemoryBlobAdapter();
    const input = new Uint8Array([1, 2]);
    await adapter.put("x", input);
    input[0] = 9;
    const first = await adapter.get("x");
    expect(first).not.toBeNull();
    if (!first) throw new Error("expected stored bytes");
    first[1] = 8;
    const second = Array.from((await adapter.get("x")) ?? []);
    const third = Array.from((await adapter.get("x")) ?? []);
    expect(second).toEqual([1, 2]);
    expect(third).toEqual([1, 2]);
    await adapter.dispose();
  });

  it("round-trips empty bytes without aliasing", async () => {
    const adapter = new MemoryBlobAdapter();
    await adapter.put("empty", new Uint8Array(0));
    const got = await adapter.get("empty");
    expect(got).not.toBeNull();
    if (!got) throw new Error("expected empty bytes");
    expect(got.byteLength).toBe(0);
    expect(Array.from(got)).toEqual([]);
    await adapter.dispose();
  });

  it("round-trips binary bytes (0x00..0xFF) without aliasing", async () => {
    const adapter = new MemoryBlobAdapter();
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    await adapter.put("bin", input);
    input[0] = 0xff;
    input[128] = 0x00;
    input[255] = 0xaa;
    const got = await adapter.get("bin");
    if (!got) throw new Error("expected binary bytes");
    const expected = Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(got)).toEqual(expected);
    await adapter.dispose();
  });

  it("still returns null for missing ids", async () => {
    const adapter = new MemoryBlobAdapter();
    expect(await adapter.get("absent")).toBeNull();
    await adapter.dispose();
  });
});
