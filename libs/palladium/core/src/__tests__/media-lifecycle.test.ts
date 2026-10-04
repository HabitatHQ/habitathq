import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IDBBlobAdapter } from "../idb-blob-adapter.js";
import { MemoryBlobAdapter } from "../memory-blob-adapter.js";

describe("blob lifecycle", () => {
  it("clears and disposes the memory backend", async () => {
    const adapter = new MemoryBlobAdapter();
    await adapter.put("a", new Uint8Array([1]));
    await adapter.put("b", new Uint8Array([2]));
    await adapter.clear();
    expect(await adapter.has("a")).toBe(false);
    expect(await adapter.has("b")).toBe(false);
    await adapter.dispose();
    await expect(adapter.get("a")).rejects.toThrow("disposed");
  });

  it("isolates namespaces, clears one namespace, and deletes only the named database", async () => {
    const first = new IDBBlobAdapter("lifecycle-first", 0, "app-a");
    const second = new IDBBlobAdapter("lifecycle-first", 0, "app-b");
    const otherDatabase = new IDBBlobAdapter("lifecycle-second", 0, "app-a", true);
    await first.put("same", new Uint8Array([1]));
    await second.put("same", new Uint8Array([2]));
    await otherDatabase.put("same", new Uint8Array([3]));

    await first.clear();
    expect(await first.get("same")).toBeNull();
    expect(await second.get("same")).toEqual(new Uint8Array([2]));
    await expect(first.deleteDatabase()).rejects.toThrow("exclusive ownership");
    expect(await otherDatabase.get("same")).toEqual(new Uint8Array([3]));

    await first.close();
    await otherDatabase.deleteDatabase();
    expect(await second.get("same")).toEqual(new Uint8Array([2]));
    expect(await otherDatabase.has("same")).toBe(false);
    await otherDatabase.close();
    await second.close();
    const deleteSharedDatabase = new IDBBlobAdapter("lifecycle-first", 0, "app-a", true);
    await deleteSharedDatabase.deleteDatabase();
    await otherDatabase.deleteDatabase();
  });

  it("reports blocked deletion instead of treating it as success", async () => {
    const blockerRequest = indexedDB.open("lifecycle-blocked", 1);
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      blockerRequest.onsuccess = () => resolve(blockerRequest.result);
      blockerRequest.onerror = () => reject(blockerRequest.error);
    });
    const adapter = new IDBBlobAdapter("lifecycle-blocked", 0, "app", true);

    await expect(adapter.deleteDatabase()).rejects.toThrow("blocked");
    blocker.close();
  });
});
