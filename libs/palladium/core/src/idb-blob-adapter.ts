import type { BlobAdapter, BlobAdapterOptions, BlobStoreLifecycle } from "./blob-adapter.js";

/** Blob storage in an explicitly named IndexedDB database with optional chunking. */
export class IDBBlobAdapter implements BlobAdapter, BlobStoreLifecycle {
  readonly #dbName: string;
  readonly #chunkSizeBytes: number; // 0 = no chunking
  readonly #namespace: string;
  readonly #databaseExclusive: boolean;
  #db: IDBDatabase | null = null;
  #disposed = false;

  constructor(
    dbName = "palladium-blobs",
    chunkSizeKb = 0,
    namespace = "",
    databaseExclusive = false,
  ) {
    this.#dbName = dbName;
    this.#chunkSizeBytes = chunkSizeKb * 1024;
    this.#namespace = namespace;
    this.#databaseExclusive = databaseExclusive;
  }

  async #open(): Promise<IDBDatabase> {
    if (this.#disposed) throw new Error("IDBBlobAdapter has been disposed");
    if (this.#db) return this.#db;
    return new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.#dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("blobs")) {
          db.createObjectStore("blobs");
        }
        if (!db.objectStoreNames.contains("chunks")) {
          db.createObjectStore("chunks");
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          if (this.#db === db) this.#db = null;
        };
        this.#db = db;
        resolve(db);
      };
      req.onerror = () => {
        reject(req.error);
      };
    });
  }

  async put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void> {
    const key = this.#key(id);
    options?.signal?.throwIfAborted();
    const db = await this.#open();
    await runTransaction(db, ["blobs", "chunks"], "readwrite", (tx) => {
      const blobs = tx.objectStore("blobs");
      const chunks = tx.objectStore("chunks");
      const chunkCount =
        this.#chunkSizeBytes === 0 ? 0 : Math.ceil(bytes.length / this.#chunkSizeBytes);
      deleteChunks(chunks, key, chunkCount);
      if (this.#chunkSizeBytes === 0) {
        blobs.put(bytes, key);
        return;
      }

      for (let i = 0; i < chunkCount; i++) {
        const chunk = bytes.slice(i * this.#chunkSizeBytes, (i + 1) * this.#chunkSizeBytes);
        chunks.put(chunk, chunkKey(key, i));
      }
      blobs.put(chunkCount, key);
    });
  }

  async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    options?.signal?.throwIfAborted();
    return readBlob(await this.#open(), this.#key(id));
  }

  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const key = this.#key(id);
    const db = await this.#open();
    await runTransaction(db, ["blobs", "chunks"], "readwrite", (tx) => {
      deleteChunks(tx.objectStore("chunks"), key, 0);
      tx.objectStore("blobs").delete(key);
    });
  }

  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    const key = this.#key(id);
    const val = await idbGet<unknown>(await this.#open(), "blobs", key);
    return val !== undefined;
  }
  async clear(options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    if (this.#namespace.length === 0 && !this.#databaseExclusive) {
      throw new Error(
        "Clearing IndexedDB blobs requires an explicit namespace or exclusive database ownership",
      );
    }
    const db = await this.#open();
    await runTransaction(db, ["blobs", "chunks"], "readwrite", (tx) => {
      const prefix = this.#namespace ? `${this.#namespace.length}:${this.#namespace}:` : "";
      const blobs = tx.objectStore("blobs");
      const chunks = tx.objectStore("chunks");
      if (prefix === "") {
        blobs.clear();
        chunks.clear();
      } else {
        deleteKeysWithPrefix(blobs, prefix);
        deleteKeysWithPrefix(chunks, prefix);
      }
    });
  }

  /** Close this connection but allow subsequent operations to reopen it. */
  async close(): Promise<void> {
    this.#db?.close();
    this.#db = null;
  }

  /** Close and delete exactly the configured database. */
  async deleteDatabase(): Promise<void> {
    if (!this.#databaseExclusive) {
      throw new Error(
        "Database deletion requires explicit exclusive ownership of the configured database",
      );
    }
    await this.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.#dbName);
      let settled = false;
      request.onsuccess = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          reject(request.error ?? new Error(`Failed to delete IndexedDB "${this.#dbName}"`));
        }
      };
      request.onblocked = () => {
        if (!settled) {
          settled = true;
          reject(
            new Error(`Deletion of IndexedDB "${this.#dbName}" is blocked by another connection`),
          );
        }
      };
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.close();
  }

  #key(id: string): string {
    return this.#namespace ? `${this.#namespace.length}:${this.#namespace}:${id}` : id;
  }
}

// ── IDB helpers ──────────────────────────────────────────────────────────────

type BlobMetadata = Uint8Array | number;

function chunkKey(id: string, index: number): string {
  return `${id}:${index}`;
}

function deleteChunks(store: IDBObjectStore, id: string, preservedCount: number): void {
  const prefix = `${id}:`;
  const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const key = cursor.key;
    if (typeof key === "string" && key.startsWith(prefix)) {
      const suffix = key.slice(prefix.length);
      if (/^(0|[1-9]\d*)$/.test(suffix) && Number(suffix) >= preservedCount) {
        cursor.delete();
      }
    }
    cursor.continue();
  };
}
function deleteKeysWithPrefix(store: IDBObjectStore, prefix: string): void {
  const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    if (typeof cursor.key === "string" && cursor.key.startsWith(prefix)) cursor.delete();
    cursor.continue();
  };
}

function runTransaction(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction) => void,
): Promise<void> {
  const tx = db.transaction(stores, mode);
  const { promise, resolve, reject } = deferred<void>();
  let operationError: unknown;
  tx.oncomplete = () => {
    resolve();
  };
  tx.onabort = () => {
    reject(
      tx.error ?? operationError ?? new DOMException("IndexedDB transaction aborted", "AbortError"),
    );
  };

  try {
    operation(tx);
  } catch (error) {
    operationError = error;
    try {
      tx.abort();
    } catch {
      reject(error);
    }
  }
  return promise;
}

function readBlob(db: IDBDatabase, id: string): Promise<Uint8Array | null> {
  const tx = db.transaction(["blobs", "chunks"], "readonly");
  const blobs = tx.objectStore("blobs");
  const chunks = tx.objectStore("chunks");
  let metadata: BlobMetadata | undefined;
  let parts: Array<Uint8Array | undefined> | undefined;
  let readError: Error | undefined;

  const { promise, resolve, reject } = deferred<Uint8Array | null>();
  tx.oncomplete = () => {
    if (readError) {
      reject(readError);
      return;
    }
    if (metadata === undefined) {
      resolve(null);
      return;
    }
    if (typeof metadata !== "number") {
      resolve(metadata);
      return;
    }

    const completeParts = parts ?? [];
    const total = completeParts.reduce((sum, part) => sum + (part?.length ?? 0), 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of completeParts) {
      if (part) {
        result.set(part, offset);
        offset += part.length;
      }
    }
    resolve(result);
  };
  tx.onabort = () => {
    reject(tx.error ?? new DOMException("IndexedDB transaction aborted", "AbortError"));
  };

  const metadataRequest = blobs.get(id);
  metadataRequest.onsuccess = () => {
    metadata = metadataRequest.result as BlobMetadata | undefined;
    if (typeof metadata !== "number") return;
    if (!Number.isSafeInteger(metadata) || metadata < 0) {
      readError = new Error(`Invalid IndexedDB chunk count for blob "${id}"`);
      tx.abort();
      return;
    }

    parts = new Array<Uint8Array | undefined>(metadata);
    for (let i = 0; i < metadata; i++) {
      const partRequest = chunks.get(chunkKey(id, i));
      partRequest.onsuccess = () => {
        const part = partRequest.result as Uint8Array | undefined;
        if (part === undefined) {
          readError = new Error(`Missing IndexedDB chunk ${i} for blob "${id}"`);
          return;
        }
        if (parts) parts[i] = part;
      };
    }
  };
  return promise;
}
function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(store, "readonly");
  const request = tx.objectStore(store).get(key);
  const { promise, resolve, reject } = deferred<T | undefined>();
  let result: T | undefined;

  request.onsuccess = () => {
    result = request.result as T | undefined;
  };
  tx.oncomplete = () => {
    resolve(result);
  };
  tx.onabort = () => {
    reject(tx.error ?? new DOMException("IndexedDB transaction aborted", "AbortError"));
  };
  return promise;
}
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
