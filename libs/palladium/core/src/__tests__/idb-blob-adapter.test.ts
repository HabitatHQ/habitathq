import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IDBBlobAdapter } from "../idb-blob-adapter.js";

describe("IDBBlobAdapter", () => {
  it("put and get round-trip", async () => {
    const adapter = new IDBBlobAdapter("test-idb-1");
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.put("a", bytes);
    expect(await adapter.get("a")).toEqual(bytes);
  });

  it("get returns null for missing", async () => {
    const adapter = new IDBBlobAdapter("test-idb-2");
    expect(await adapter.get("missing")).toBeNull();
  });

  it("has returns true after put", async () => {
    const adapter = new IDBBlobAdapter("test-idb-3");
    await adapter.put("b", new Uint8Array([0]));
    expect(await adapter.has("b")).toBe(true);
  });

  it("has returns false for missing", async () => {
    const adapter = new IDBBlobAdapter("test-idb-4");
    expect(await adapter.has("nope")).toBe(false);
  });

  it("delete removes the blob", async () => {
    const adapter = new IDBBlobAdapter("test-idb-5");
    await adapter.put("c", new Uint8Array([5, 6]));
    await adapter.delete("c");
    expect(await adapter.get("c")).toBeNull();
  });

  it("chunked storage round-trips data smaller than one chunk", async () => {
    const adapter = new IDBBlobAdapter("test-idb-6", 1); // 1 KB chunks
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.put("s", bytes);
    expect(await adapter.get("s")).toEqual(bytes);
  });

  it("chunked storage round-trips large data spanning multiple chunks", async () => {
    const adapter = new IDBBlobAdapter("test-idb-7", 1); // 1 KB chunks
    const big = new Uint8Array(2500).fill(42); // ~2.5 chunks
    await adapter.put("big", big);
    expect(await adapter.get("big")).toEqual(big);
  });

  it("chunked delete removes all chunks", async () => {
    const adapter = new IDBBlobAdapter("test-idb-8", 1);
    const big = new Uint8Array(2100).fill(7);
    await adapter.put("del", big);
    await adapter.delete("del");
    expect(await adapter.get("del")).toBeNull();
  });

  it("AbortSignal cancels put immediately if already aborted", async () => {
    const adapter = new IDBBlobAdapter("test-idb-9");
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.put("x", new Uint8Array([1]), { signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("AbortSignal cancels get immediately if already aborted", async () => {
    const adapter = new IDBBlobAdapter("test-idb-10");
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.get("x", { signal: controller.signal })).rejects.toThrow();
  });

  it("AbortSignal cancels has immediately if already aborted", async () => {
    const adapter = new IDBBlobAdapter("test-idb-11");
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.has("x", { signal: controller.signal })).rejects.toThrow();
  });

  it("AbortSignal cancels delete immediately if already aborted", async () => {
    const adapter = new IDBBlobAdapter("test-idb-12");
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.delete("x", { signal: controller.signal })).rejects.toThrow();
  });
});
