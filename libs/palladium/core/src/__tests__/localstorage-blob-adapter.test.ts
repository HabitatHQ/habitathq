import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorageBlobAdapter } from "../localstorage-blob-adapter.js";

// Provide a minimal localStorage mock for the node test environment.
// The real adapter uses the browser's localStorage; we just need the Map-backed
// equivalent to verify the logic.
class MockStorage {
  readonly #data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }
  removeItem(key: string): void {
    this.#data.delete(key);
  }
  clear(): void {
    this.#data.clear();
  }
}

let mockStorage: MockStorage;

beforeEach(() => {
  mockStorage = new MockStorage();
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  (globalThis as any).localStorage = mockStorage;
});

describe("LocalStorageBlobAdapter", () => {
  it("put and get round-trip", async () => {
    const adapter = new LocalStorageBlobAdapter("ls-test:");
    const bytes = new Uint8Array([7, 8, 9]);
    await adapter.put("k", bytes);
    expect(await adapter.get("k")).toEqual(bytes);
  });

  it("get returns null for missing", async () => {
    const adapter = new LocalStorageBlobAdapter("ls-test:");
    expect(await adapter.get("nope")).toBeNull();
  });

  it("has returns true after put", async () => {
    const adapter = new LocalStorageBlobAdapter("ls-test:");
    await adapter.put("h", new Uint8Array([1]));
    expect(await adapter.has("h")).toBe(true);
  });

  it("has returns false for missing", async () => {
    const adapter = new LocalStorageBlobAdapter("ls-test:");
    expect(await adapter.has("missing")).toBe(false);
  });

  it("delete removes blob", async () => {
    const adapter = new LocalStorageBlobAdapter("ls-test:");
    await adapter.put("d", new Uint8Array([1]));
    await adapter.delete("d");
    expect(await adapter.get("d")).toBeNull();
  });

  it("uses prefix to namespace keys", async () => {
    const a = new LocalStorageBlobAdapter("ns-a:");
    const b = new LocalStorageBlobAdapter("ns-b:");
    await a.put("x", new Uint8Array([1]));
    // Different namespace should not see the value
    expect(await b.has("x")).toBe(false);
  });

  it("AbortSignal cancels put if already aborted", async () => {
    const adapter = new LocalStorageBlobAdapter("ls-test:");
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(adapter.put("x", new Uint8Array([1]), { signal: ctrl.signal })).rejects.toThrow();
  });

  it("AbortSignal cancels get if already aborted", async () => {
    const adapter = new LocalStorageBlobAdapter("ls-test:");
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(adapter.get("x", { signal: ctrl.signal })).rejects.toThrow();
  });
});
