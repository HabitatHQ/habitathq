import { beforeAll, describe, expect, it, vi } from "vitest";
import { BlobHandle } from "../blob-handle.js";
import { BlobRegistry } from "../blob-registry.js";
import { MemoryBlobAdapter } from "../memory-blob-adapter.js";

beforeAll(() => {
  if (!globalThis.URL.createObjectURL) {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  }
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

describe("BlobHandle", () => {
  it("put and get round-trip bytes", async () => {
    const h = new BlobHandle(new MemoryBlobAdapter(), new BlobRegistry());
    const data = new Uint8Array([1, 2, 3]);
    await h.put("x", data);
    expect(await h.get("x")).toEqual(data);
  });

  it("get with no format defaults to bytes", async () => {
    const h = new BlobHandle(new MemoryBlobAdapter(), new BlobRegistry());
    await h.put("x", new Uint8Array([7]));
    const result = await h.get("x");
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("get as blob returns Blob", async () => {
    const h = new BlobHandle(new MemoryBlobAdapter(), new BlobRegistry());
    await h.put("x", new Uint8Array([4, 5]));
    const b = await h.get("x", "blob");
    expect(b).toBeInstanceOf(Blob);
  });

  it("get as url tracks in registry", async () => {
    const registry = new BlobRegistry();
    const h = new BlobHandle(new MemoryBlobAdapter(), registry);
    await h.put("x", new Uint8Array([1]));
    await h.get("x", "url");
    expect(registry.size).toBe(1);
  });

  it("get as stream returns ReadableStream", async () => {
    const h = new BlobHandle(new MemoryBlobAdapter(), new BlobRegistry());
    await h.put("x", new Uint8Array([1]));
    const result = await h.get("x", "stream");
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it("get returns null for missing blob", async () => {
    const h = new BlobHandle(new MemoryBlobAdapter(), new BlobRegistry());
    expect(await h.get("nope")).toBeNull();
  });

  it("has returns false for missing", async () => {
    const h = new BlobHandle(new MemoryBlobAdapter(), new BlobRegistry());
    expect(await h.has("nope")).toBe(false);
  });

  it("has returns true after put", async () => {
    const h = new BlobHandle(new MemoryBlobAdapter(), new BlobRegistry());
    await h.put("y", new Uint8Array([0]));
    expect(await h.has("y")).toBe(true);
  });

  it("delete removes blob", async () => {
    const h = new BlobHandle(new MemoryBlobAdapter(), new BlobRegistry());
    await h.put("z", new Uint8Array([9]));
    await h.delete("z");
    expect(await h.get("z")).toBeNull();
  });

  it("url format does not track when blob is missing", async () => {
    const registry = new BlobRegistry();
    const h = new BlobHandle(new MemoryBlobAdapter(), registry);
    await h.get("missing", "url");
    expect(registry.size).toBe(0);
  });
});
