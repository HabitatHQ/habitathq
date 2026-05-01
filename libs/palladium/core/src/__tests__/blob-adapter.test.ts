import { describe, expect, it } from "vitest";
import type { BlobAdapter } from "../blob-adapter.js";

// Minimal in-memory adapter for testing the interface contract
class MemoryBlobAdapter implements BlobAdapter {
  readonly #store = new Map<string, Uint8Array>();

  async put(id: string, bytes: Uint8Array): Promise<void> {
    this.#store.set(id, bytes);
  }
  async get(id: string): Promise<Uint8Array | null> {
    return this.#store.get(id) ?? null;
  }
  async delete(id: string): Promise<void> {
    this.#store.delete(id);
  }
  async has(id: string): Promise<boolean> {
    return this.#store.has(id);
  }
}

describe("BlobAdapter contract", () => {
  it("put and get round-trips bytes", async () => {
    const adapter = new MemoryBlobAdapter();
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.put("a", bytes);
    const result = await adapter.get("a");
    expect(result).toEqual(bytes);
  });

  it("get returns null for missing id", async () => {
    const adapter = new MemoryBlobAdapter();
    expect(await adapter.get("missing")).toBeNull();
  });

  it("has returns true after put", async () => {
    const adapter = new MemoryBlobAdapter();
    await adapter.put("b", new Uint8Array([0]));
    expect(await adapter.has("b")).toBe(true);
  });

  it("has returns false for missing id", async () => {
    const adapter = new MemoryBlobAdapter();
    expect(await adapter.has("missing")).toBe(false);
  });

  it("delete removes the blob", async () => {
    const adapter = new MemoryBlobAdapter();
    await adapter.put("c", new Uint8Array([9]));
    await adapter.delete("c");
    expect(await adapter.get("c")).toBeNull();
  });
});
