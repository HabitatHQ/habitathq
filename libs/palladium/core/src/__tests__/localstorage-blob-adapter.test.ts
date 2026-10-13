import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageBlobAdapter } from "../localstorage-blob-adapter.js";

// Provide a minimal localStorage mock for the node test environment.
// The real adapter uses the browser's localStorage; we just need the Map-backed
// equivalent to verify the logic.
class MockStorage {
  readonly #data = new Map<string, string>();

  get length(): number {
    return this.#data.size;
  }

  key(index: number): string | null {
    return Array.from(this.#data.keys())[index] ?? null;
  }

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
  vi.stubGlobal("localStorage", mockStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalStorageBlobAdapter", () => {
  it("rejects an empty prefix before clearing unrelated origin keys", async () => {
    const sentinels = {
      "other-app-preference": "keep",
      "sibling:blob": "Ag==",
      "palladium-blob:blob": "Aw==",
      "": "empty-key",
    };
    for (const [key, value] of Object.entries(sentinels)) {
      mockStorage.setItem(key, value);
    }

    let rejection: unknown;
    try {
      await new LocalStorageBlobAdapter("").clear();
    } catch (error) {
      rejection = error;
    }

    for (const [key, value] of Object.entries(sentinels)) {
      expect(mockStorage.getItem(key)).toBe(value);
    }
    expect(rejection).toBeInstanceOf(Error);
  });

  it("clears a custom prefix without crossing adjacent prefix boundaries", async () => {
    const scoped = new LocalStorageBlobAdapter("app:blob:");
    const defaultPrefix = new LocalStorageBlobAdapter();
    mockStorage.setItem("app:blob-old:keep", "AQ==");

    await scoped.put("owned", new Uint8Array([2]));
    await defaultPrefix.put("default-owned", new Uint8Array([3]));
    await scoped.clear();

    expect(mockStorage.getItem("app:blob:owned")).toBeNull();
    expect(mockStorage.getItem("app:blob-old:keep")).toBe("AQ==");
    expect(await defaultPrefix.get("default-owned")).toEqual(new Uint8Array([3]));
  });

  it("reads, writes, and deletes blobs in its custom prefix", async () => {
    const adapter = new LocalStorageBlobAdapter("custom:blob:");

    await adapter.put("id", new Uint8Array([4, 5]));

    expect(mockStorage.getItem("custom:blob:id")).not.toBeNull();
    expect(await adapter.get("id")).toEqual(new Uint8Array([4, 5]));
    await adapter.delete("id");
    expect(mockStorage.getItem("custom:blob:id")).toBeNull();
  });

  it("clears only the default prefix namespace", async () => {
    const adapter = new LocalStorageBlobAdapter();
    mockStorage.setItem("palladium-blob-old:keep", "AQ==");

    await adapter.put("owned", new Uint8Array([6]));
    await adapter.clear();

    expect(mockStorage.getItem("palladium-blob:owned")).toBeNull();
    expect(mockStorage.getItem("palladium-blob-old:keep")).toBe("AQ==");
  });

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

  it("clears only its prefix and rejects operations after disposal", async () => {
    const first = new LocalStorageBlobAdapter("clear-a:");
    const other = new LocalStorageBlobAdapter("clear-b:");
    await first.put("id", new Uint8Array([1]));
    await other.put("id", new Uint8Array([2]));

    await first.clear();
    expect(await first.has("id")).toBe(false);
    expect(await other.get("id")).toEqual(new Uint8Array([2]));
    await other.dispose();
    await expect(other.get("id")).rejects.toThrow("disposed");
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
