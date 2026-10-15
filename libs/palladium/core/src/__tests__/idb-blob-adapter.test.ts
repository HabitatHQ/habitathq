import "fake-indexeddb/auto";
import { IDBOpenDBRequest } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function holdOpenSuccess(name: string) {
  const originalOpen = indexedDB.open.bind(indexedDB);
  const opens: Array<{
    ready: Promise<void>;
    release: () => void;
    request: IDBOpenDBRequest;
    close: ReturnType<typeof vi.spyOn>;
  }> = [];
  const spy = vi.spyOn(indexedDB, "open").mockImplementation((dbName, version) => {
    const request = originalOpen(dbName, version);
    if (dbName !== name) return request;
    const ready = Promise.withResolvers<void>();
    let success: IDBOpenDBRequest["onsuccess"] = null;
    let event: Event | undefined;
    let released = false;
    const held = {
      ready: ready.promise,
      request,
      close: undefined as unknown as ReturnType<typeof vi.spyOn>,
      release: () => {
        if (released || !event) return;
        released = true;
        success?.call(request, event);
      },
    };
    Object.defineProperty(request, "onsuccess", {
      configurable: true,
      get: () => null,
      set: (handler: IDBOpenDBRequest["onsuccess"]) => {
        success = handler;
      },
    });
    request.addEventListener("success", (received) => {
      event = received;
      held.close = vi.spyOn(request.result, "close");
      ready.resolve();
    });
    opens.push(held);
    return request;
  });
  return { opens, spy };
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

  it("waits for blocked deletion before reopening or writing", async () => {
    const name = `blocked-delete-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const adapter = new IDBBlobAdapter(name, 0, "", true);
    await adapter.put("stale", new Uint8Array([8]));
    const blocker = await openDatabase(name);
    const originalDelete = indexedDB.deleteDatabase.bind(indexedDB);
    const blocked = Promise.withResolvers<void>();
    const deleteSpy = vi.spyOn(indexedDB, "deleteDatabase").mockImplementation((dbName) => {
      const request = originalDelete(dbName);
      request.addEventListener("blocked", () => blocked.resolve(), { once: true });
      return request;
    });
    const openSpy = vi.spyOn(indexedDB, "open");
    const settled: string[] = [];
    const deletion = adapter.deleteDatabase().then(() => settled.push("deleted"));
    const repeatedDeletion = adapter.deleteDatabase().then(() => settled.push("deleted-again"));
    const pending: Promise<unknown>[] = [deletion, repeatedDeletion];
    try {
      await blocked.promise;
      const read = adapter.get("stale");
      const write = adapter.put("fresh", new Uint8Array([3, 4]));
      pending.push(read, write);
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toEqual([]);
      expect(openSpy).not.toHaveBeenCalled();
      expect(deleteSpy).toHaveBeenCalledTimes(1);

      blocker.close();
      await Promise.all(pending);
      expect(await read).toBeNull();
      expect(settled).toEqual(["deleted", "deleted-again"]);
      expect(await adapter.get("fresh")).toEqual(new Uint8Array([3, 4]));
      await adapter.close();
      expect(await adapter.get("stale")).toBeNull();
      expect(await adapter.get("fresh")).toEqual(new Uint8Array([3, 4]));
    } finally {
      blocker.close();
      await Promise.allSettled(pending);
      await adapter.close();
      openSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });

  it("rejects a terminal delete error and recovers access to the existing database", async () => {
    const name = `blocked-delete-error-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const adapter = new IDBBlobAdapter(name, 0, "", true);
    const previous = new Uint8Array([9, 2]);
    await adapter.put("existing", previous);
    const issued = Promise.withResolvers<void>();
    const request = new IDBOpenDBRequest();
    const failure = new DOMException("Injected delete failure", "UnknownError");
    const deleteSpy = vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
      issued.resolve();
      return request;
    });
    const openSpy = vi.spyOn(indexedDB, "open");
    const failures: unknown[] = [];
    const deletion = adapter.deleteDatabase().catch((error: unknown) => failures.push(error));
    const pending: Promise<unknown>[] = [deletion];
    try {
      await issued.promise;
      request.dispatchEvent(new IDBVersionChangeEvent("blocked"));
      const read = adapter.get("existing");
      pending.push(read);
      await Promise.resolve();
      await Promise.resolve();
      expect(failures).toEqual([]);
      expect(openSpy).not.toHaveBeenCalled();

      Object.defineProperty(request, "error", { value: failure, configurable: true });
      request.onerror?.call(request, new Event("error"));
      await deletion;
      expect(failures).toEqual([failure]);
      expect(await read).toEqual(previous);
      await adapter.put("after-error", new Uint8Array([6]));
      expect(await adapter.get("after-error")).toEqual(new Uint8Array([6]));
      deleteSpy.mockRestore();
      await adapter.deleteDatabase();
      expect(await adapter.get("existing")).toBeNull();
      expect(await adapter.get("after-error")).toBeNull();
    } finally {
      Object.defineProperty(request, "error", { value: failure, configurable: true });
      request.onerror?.call(request, new Event("error"));
      await Promise.allSettled(pending);
      await adapter.close();
      openSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });

  it("preempts an in-flight open when deletion starts and recovers on a fresh database", async () => {
    const name = `preempt-open-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const adapter = new IDBBlobAdapter(name, 0, "", true);
    const previous = new Uint8Array([11]);
    await adapter.put("first", previous);
    await adapter.close();

    type OpenRequest = {
      onsuccess: ((event: Event) => void) | null;
      onerror: ((event: Event) => void) | null;
      onupgradeneeded: ((event: Event) => void) | null;
      result: unknown;
      error: unknown;
    };
    const staleResult = { close: vi.fn(), onversionchange: null };
    const originalOpen = indexedDB.open.bind(indexedDB);
    let firstOpenReturned = false;
    const slow = Promise.withResolvers<OpenRequest>();
    const openIssued = Promise.withResolvers<void>();
    const deleteIssued = Promise.withResolvers<void>();
    const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(((
      dbName: string,
      version?: number,
    ) => {
      if (dbName !== name) return originalOpen(dbName, version);
      if (firstOpenReturned) return originalOpen(dbName, version);
      firstOpenReturned = true;
      const req: OpenRequest = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: staleResult,
        error: null,
      };
      openIssued.resolve();
      slow.promise.then(() => {
        req.onsuccess?.(new Event("success"));
      });
      return req as unknown as IDBOpenDBRequest;
    }) as typeof indexedDB.open);
    const originalDelete = indexedDB.deleteDatabase.bind(indexedDB);
    let deleteRequestIssued = false;
    const deleteSpy = vi.spyOn(indexedDB, "deleteDatabase").mockImplementation((dbName) => {
      deleteRequestIssued = true;
      deleteIssued.resolve();
      return originalDelete(dbName);
    });

    const read = adapter.get("first");
    const readFailure = read.catch((error: unknown) => error);
    try {
      await openIssued.promise;
      expect(deleteRequestIssued).toBe(false);
      const deletion = adapter.deleteDatabase();
      const queued = adapter.put("after", new Uint8Array([7]));
      await expect(deleteIssued.promise).resolves.toBeUndefined();
      slow.resolve();
      const failure = await readFailure;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/preempted by a pending deletion/);
      expect(staleResult.close).toHaveBeenCalled();
      await expect(deletion).resolves.toBeUndefined();
      await queued;
      expect(await adapter.get("after")).toEqual(new Uint8Array([7]));
      openSpy.mockRestore();
      deleteSpy.mockRestore();
      await adapter.deleteDatabase();
      expect(await adapter.get("after")).toBeNull();
    } finally {
      slow.resolve();
      await Promise.allSettled([read, readFailure]);
      await adapter.close();
      openSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });

  it("clears the deletion gate when deleteDatabase throws synchronously and keeps the database usable", async () => {
    const name = `sync-throw-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const adapter = new IDBBlobAdapter(name, 0, "", true);
    await adapter.put("keep", new Uint8Array([2]));

    const failure = new DOMException("Injected synchronous failure", "SecurityError");
    const deleteSpy = vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
      throw failure;
    });
    try {
      await expect(adapter.deleteDatabase()).rejects.toBe(failure);
      expect(await adapter.get("keep")).toEqual(new Uint8Array([2]));
      deleteSpy.mockRestore();
      await adapter.deleteDatabase();
      expect(await adapter.get("keep")).toBeNull();
    } finally {
      await adapter.close();
      deleteSpy.mockRestore();
    }
  });
  it("shares one first IndexedDB open across concurrent operations", async () => {
    const name = `concurrent-open-${crypto.randomUUID()}`;
    const adapter = trackedAdapter(name);
    const openSpy = vi.spyOn(indexedDB, "open");
    try {
      const left = new Uint8Array([1, 2]);
      const right = new Uint8Array([3, 4]);
      await Promise.all([adapter.put("left", left), adapter.put("right", right)]);
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(await adapter.get("left")).toEqual(left);
      expect(await adapter.get("right")).toEqual(right);
    } finally {
      openSpy.mockRestore();
      await adapter.dispose();
    }
  });
  it("rejects a pending first write and closes its late handle after disposal", async () => {
    const name = `dispose-open-${crypto.randomUUID()}`;
    const adapter = trackedAdapter(name);
    const held = holdOpenSuccess(name);
    const write = adapter.put("late", new Uint8Array([7]));
    const outcome = write.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await adapter.dispose();
      await Promise.all(held.opens.map((open) => open.ready));
      for (const open of held.opens) open.release();
      const failure = await outcome;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/disposed/);
      for (const open of held.opens) expect(open.close).toHaveBeenCalledOnce();
      await expect(adapter.put("later", new Uint8Array([8]))).rejects.toThrow(/disposed/);
      held.spy.mockRestore();
      const observer = trackedAdapter(name);
      expect(await observer.get("late")).toBeNull();
      expect(await observer.get("later")).toBeNull();
      await observer.dispose();
      // No late connection remains to block a subsequent database deletion.
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Disposed adapter retained a connection"));
      });
    } finally {
      await Promise.all(held.opens.map((open) => open.ready));
      for (const open of held.opens) {
        open.release();
        open.request.result.close();
      }
      await outcome;
      held.spy.mockRestore();
      await adapter.dispose();
    }
  });

  it("rejects all concurrent pending operations across repeated disposal", async () => {
    const name = `dispose-concurrent-${crypto.randomUUID()}`;
    const adapter = trackedAdapter(name);
    const held = holdOpenSuccess(name);
    const outcomes = [
      adapter.put("a", new Uint8Array([1])),
      adapter.put("b", new Uint8Array([2])),
      adapter.get("a"),
      adapter.has("b"),
    ].map((operation) =>
      operation.then(
        () => null,
        (error: unknown) => error,
      ),
    );
    try {
      await Promise.all([adapter.dispose(), adapter.dispose(), adapter.dispose()]);
      await Promise.all(held.opens.map((open) => open.ready));
      for (const open of held.opens) open.release();
      for (const failure of await Promise.all(outcomes)) {
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toMatch(/disposed/);
      }
      for (const open of held.opens) expect(open.close).toHaveBeenCalledOnce();
      held.spy.mockRestore();
      const observer = trackedAdapter(name);
      expect(await observer.get("a")).toBeNull();
      expect(await observer.get("b")).toBeNull();
      await observer.dispose();
    } finally {
      await Promise.all(held.opens.map((open) => open.ready));
      for (const open of held.opens) {
        open.release();
        open.request.result.close();
      }
      await Promise.all(outcomes);
      held.spy.mockRestore();
      await adapter.dispose();
    }
  });

  it("rejects transaction admission when disposal follows a cached open", async () => {
    const name = `dispose-admission-${crypto.randomUUID()}`;
    const adapter = trackedAdapter(name);
    await adapter.put("existing", new Uint8Array([3]));
    // The write has obtained the cached handle, but its await continuation has not run.
    const write = adapter.put("late", new Uint8Array([4]));
    const outcome = write.then(
      () => null,
      (error: unknown) => error,
    );
    await adapter.dispose();
    const failure = await outcome;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/disposed/);
    const observer = trackedAdapter(name);
    expect(await observer.get("existing")).toEqual(new Uint8Array([3]));
    expect(await observer.get("late")).toBeNull();
    await observer.dispose();
  });

  it("waits for admitted transactions before every disposal call resolves", async () => {
    const name = `dispose-drain-${crypto.randomUUID()}`;
    const adapter = trackedAdapter(name);
    await adapter.put("existing", new Uint8Array([1]));
    const started = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const originalTransaction = IDBDatabase.prototype.transaction;
    let release = () => {};
    const transactionSpy = vi
      .spyOn(IDBDatabase.prototype, "transaction")
      .mockImplementation(function (
        this: IDBDatabase,
        ...args: Parameters<typeof originalTransaction>
      ) {
        const tx = originalTransaction.apply(this, args);
        if (this.name !== name || args[1] !== "readwrite") return tx;
        let oncomplete: IDBTransaction["oncomplete"] = null;
        Object.defineProperty(tx, "oncomplete", {
          get: () => null,
          set: (handler: IDBTransaction["oncomplete"]) => {
            oncomplete = handler;
          },
        });
        tx.addEventListener("complete", (event) => {
          release = () => oncomplete?.call(tx, event);
          completed.resolve();
        });
        started.resolve();
        return tx;
      });
    const write = adapter.put("admitted", new Uint8Array([5]));
    const outcome = write.then(
      () => null,
      (error: unknown) => error,
    );
    const disposed: string[] = [];
    try {
      await started.promise;
      const first = adapter.dispose().then(() => disposed.push("first"));
      const second = adapter.dispose().then(() => disposed.push("second"));
      await completed.promise;
      await Promise.resolve();
      expect(disposed).toEqual([]);
      release();
      expect(await outcome).toBeNull();
      await Promise.all([first, second]);
      expect(disposed).toEqual(["first", "second"]);
      transactionSpy.mockRestore();
      const observer = trackedAdapter(name);
      expect(await observer.get("admitted")).toEqual(new Uint8Array([5]));
      await observer.dispose();
    } finally {
      await completed.promise;
      release();
      await outcome;
      transactionSpy.mockRestore();
      await adapter.dispose();
    }
  });

  it("reopens after versionchange and still rejects a disposed pending reopen", async () => {
    const name = `dispose-versionchange-${crypto.randomUUID()}`;
    const adapter = trackedAdapter(name);
    const originalOpen = indexedDB.open.bind(indexedDB);
    let connection: IDBDatabase | undefined;
    const capture = vi.spyOn(indexedDB, "open").mockImplementation((dbName, version) => {
      const request = originalOpen(dbName, version);
      if (dbName === name) {
        request.addEventListener("success", () => {
          connection = request.result;
        });
      }
      return request;
    });
    await adapter.put("existing", new Uint8Array([6]));
    if (!connection) throw new Error("Initial connection was not captured");
    const previous = connection;
    const close = vi.spyOn(previous, "close");
    previous.dispatchEvent(new IDBVersionChangeEvent("versionchange"));
    expect(close).toHaveBeenCalledOnce();
    expect(await adapter.get("existing")).toEqual(new Uint8Array([6]));
    expect(connection).not.toBe(previous);
    await adapter.close();
    capture.mockRestore();
    const held = holdOpenSuccess(name);
    const read = adapter.get("existing");
    const outcome = read.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await adapter.dispose();
      await Promise.all(held.opens.map((open) => open.ready));
      for (const open of held.opens) open.release();
      const failure = await outcome;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/disposed/);
      for (const open of held.opens) expect(open.close).toHaveBeenCalledOnce();
    } finally {
      await Promise.all(held.opens.map((open) => open.ready));
      for (const open of held.opens) {
        open.release();
        open.request.result.close();
      }
      await outcome;
      held.spy.mockRestore();
      await adapter.dispose();
    }
  });
});
