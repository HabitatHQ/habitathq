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
    if (this.#chunkSizeBytes === 0) {
      await idbPut(db, "blobs", id, bytes);
    } else {
      await this.#putChunked(db, id, bytes);
    }
  }

  async #putChunked(db: IDBDatabase, id: string, bytes: Uint8Array): Promise<void> {
    const chunks = Math.ceil(bytes.length / this.#chunkSizeBytes);
    const puts: Promise<void>[] = [];
    for (let i = 0; i < chunks; i++) {
      const chunk = bytes.slice(i * this.#chunkSizeBytes, (i + 1) * this.#chunkSizeBytes);
      puts.push(idbPut(db, "chunks", `${id}:${i}`, chunk));
    }
    await Promise.all(puts);
    // Store chunk count as metadata in the blobs store
    await idbPut(db, "blobs", id, chunks);
  }

  async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    options?.signal?.throwIfAborted();
    const db = await this.#open();
    const meta = await idbGet<Uint8Array | number>(db, "blobs", id);
    if (meta === undefined) return null;
    if (typeof meta === "number") {
      return this.#getChunked(db, id, meta);
    }
    return meta;
  }

  async #getChunked(db: IDBDatabase, id: string, chunkCount: number): Promise<Uint8Array> {
    const parts = await Promise.all(
      Array.from({ length: chunkCount }, (_, i) => idbGet<Uint8Array>(db, "chunks", `${id}:${i}`)),
    );
    const total = parts.reduce((s, p) => s + (p?.length ?? 0), 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      if (part) {
        result.set(part, offset);
        offset += part.length;
      }
    }
    return result;
  }

  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const db = await this.#open();
    const meta = await idbGet<Uint8Array | number>(db, "blobs", id);
    if (typeof meta === "number") {
      const dels: Promise<void>[] = [];
      for (let i = 0; i < meta; i++) {
        dels.push(idbDelete(db, "chunks", `${id}:${i}`));
      }
      await Promise.all(dels);
    }
    await idbDelete(db, "blobs", id);
  }

  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    const db = await this.#open();
    const val = await idbGet<unknown>(db, "blobs", id);
    return val !== undefined;
  }
}

// ── IDB helpers ──────────────────────────────────────────────────────────────

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value, key);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => {
      resolve(req.result as T | undefined);
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}
