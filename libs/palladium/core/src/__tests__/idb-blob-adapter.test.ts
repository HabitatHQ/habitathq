import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { IDBBlobAdapter } from "../idb-blob-adapter.js";

const databaseNames: string[] = [];

function trackedAdapter(name: string, chunkSizeKb = 0): IDBBlobAdapter {
  databaseNames.push(name);
  return new IDBBlobAdapter(name, chunkSizeKb);
}

function openDatabase(name: string): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const request = indexedDB.open(name, 1);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

function readStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  const { promise, resolve, reject } = Promise.withResolvers<T[]>();
  const tx = db.transaction(storeName, "readonly");
  const request = tx.objectStore(storeName).getAll();
  request.onsuccess = () => resolve(request.result as T[]);
  request.onerror = () => reject(request.error);
  return promise;
}

function abortNextWriteTransaction(): () => void {
  const original = IDBDatabase.prototype.transaction;
  let armed = true;
  IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
    const tx = original.apply(this, args);
    if (armed && args[1] === "readwrite") {
      armed = false;
      queueMicrotask(() => tx.abort());
    }
    return tx;
  };
  return () => {
    IDBDatabase.prototype.transaction = original;
  };
}

afterEach(async () => {
  for (const name of new Set(databaseNames)) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }
  databaseNames.length = 0;
});

describe("IDBBlobAdapter", () => {
  it("put and get round-trip", async () => {
    const adapter = trackedAdapter("test-idb-1");
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
  it("keeps the previous complete blob when a replacement transaction aborts", async () => {
    const name = `atomic-replace-${crypto.randomUUID()}`;
    const writer = trackedAdapter(name, 1);
    const previous = new Uint8Array(2500).map((_, index) => index % 251);
    await writer.put("blob", previous);

    const restore = abortNextWriteTransaction();
    try {
      await expect(writer.put("blob", new Uint8Array(3100).fill(9))).rejects.toThrow();
    } finally {
      restore();
    }

    expect(await trackedAdapter(name, 1).get("blob")).toEqual(previous);
  });

  it("replaces chunked data atomically and removes surplus chunks on shrink", async () => {
    const name = `atomic-shrink-${crypto.randomUUID()}`;
    const writer = trackedAdapter(name, 1);
    await writer.put("blob", new Uint8Array(2500).fill(7));
    const smaller = new Uint8Array(1025).fill(4);
    await writer.put("blob", smaller);

    expect(await trackedAdapter(name, 1).get("blob")).toEqual(smaller);
    const db = await openDatabase(name);
    expect(await readStore<Uint8Array>(db, "chunks")).toHaveLength(2);
    db.close();
  });

  it("cleans chunks when replacing chunked data with a nonchunked blob", async () => {
    const name = `atomic-format-switch-${crypto.randomUUID()}`;
    await trackedAdapter(name, 1).put("blob", new Uint8Array(2200).fill(3));
    const replacement = new Uint8Array([8, 6, 4]);
    await trackedAdapter(name).put("blob", replacement);

    expect(await trackedAdapter(name).get("blob")).toEqual(replacement);
    const db = await openDatabase(name);
    expect(await readStore<Uint8Array>(db, "chunks")).toEqual([]);
    db.close();
  });
  it("preserves chunked blobs whose IDs share another blob's chunk-key prefix", async () => {
    const name = `nested-id-${crypto.randomUUID()}`;
    const writer = trackedAdapter(name, 1);
    const parent = new Uint8Array(2200).fill(2);
    const child = new Uint8Array(2100).fill(6);
    await writer.put("image", parent);
    await writer.put("image:preview", child);

    await writer.put("image", new Uint8Array(1100).fill(3));
    expect(await trackedAdapter(name, 1).get("image:preview")).toEqual(child);

    await writer.delete("image");
    expect(await trackedAdapter(name, 1).get("image:preview")).toEqual(child);
  });

  it("leaves blob metadata and chunks unchanged when deletion aborts", async () => {
    const name = `atomic-delete-${crypto.randomUUID()}`;
    const writer = trackedAdapter(name, 1);
    const previous = new Uint8Array(2300).fill(5);
    await writer.put("blob", previous);

    const restore = abortNextWriteTransaction();
    try {
      await expect(writer.delete("blob")).rejects.toThrow();
    } finally {
      restore();
    }

    expect(await trackedAdapter(name, 1).get("blob")).toEqual(previous);
  });

  it("persists successful deletion of metadata and chunks", async () => {
    const name = `atomic-delete-success-${crypto.randomUUID()}`;
    const writer = trackedAdapter(name, 1);
    await writer.put("blob", new Uint8Array(2300).fill(5));
    await writer.delete("blob");

    expect(await trackedAdapter(name, 1).get("blob")).toBeNull();
    const db = await openDatabase(name);
    expect(await readStore<unknown>(db, "blobs")).toEqual([]);
    expect(await readStore<Uint8Array>(db, "chunks")).toEqual([]);
    db.close();
  });
});
