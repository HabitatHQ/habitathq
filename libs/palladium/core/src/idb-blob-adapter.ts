import type { BlobAdapter, BlobAdapterOptions } from "./blob-adapter.js";

/** Blob storage in IndexedDB with optional chunking. */
export class IDBBlobAdapter implements BlobAdapter {
  readonly #dbName: string;
  readonly #chunkSizeBytes: number; // 0 = no chunking
  #db: IDBDatabase | null = null;

  constructor(dbName = "palladium-blobs", chunkSizeKb = 0) {
    this.#dbName = dbName;
    this.#chunkSizeBytes = chunkSizeKb * 1024;
  }

  async #open(): Promise<IDBDatabase> {
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
        this.#db = req.result;
        resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error);
      };
    });
  }

  async put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const db = await this.#open();
    await runTransaction(db, ["blobs", "chunks"], "readwrite", (tx) => {
      const blobs = tx.objectStore("blobs");
      const chunks = tx.objectStore("chunks");
      const chunkCount =
        this.#chunkSizeBytes === 0 ? 0 : Math.ceil(bytes.length / this.#chunkSizeBytes);
      deleteChunks(chunks, id, chunkCount);
      if (this.#chunkSizeBytes === 0) {
        blobs.put(bytes, id);
        return;
      }

      for (let i = 0; i < chunkCount; i++) {
        const chunk = bytes.slice(i * this.#chunkSizeBytes, (i + 1) * this.#chunkSizeBytes);
        chunks.put(chunk, chunkKey(id, i));
      }
      blobs.put(chunkCount, id);
    });
  }

  async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    options?.signal?.throwIfAborted();
    const db = await this.#open();
    return readBlob(db, id);
  }

  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const db = await this.#open();
    await runTransaction(db, ["blobs", "chunks"], "readwrite", (tx) => {
      deleteChunks(tx.objectStore("chunks"), id, 0);
      tx.objectStore("blobs").delete(id);
    });
  }

  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    const db = await this.#open();
    const val = await idbGet<unknown>(db, "blobs", id);
    return val !== undefined;
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
