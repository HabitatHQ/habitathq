import type { BlobAdapter, BlobAdapterOptions, BlobStoreLifecycle } from "./blob-adapter.js";

/** In-memory blob adapter. Used as a fallback when no blob adapter is configured. */
export class MemoryBlobAdapter implements BlobAdapter, BlobStoreLifecycle {
  readonly #store = new Map<string, Uint8Array>();
  #disposed = false;

  async put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    this.#store.set(id, bytes);
  }

  async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    return this.#store.get(id) ?? null;
  }

  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    this.#store.delete(id);
  }

  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    return this.#store.has(id);
  }

  async clear(options?: BlobAdapterOptions): Promise<void> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    this.#store.clear();
  }

  async dispose(): Promise<void> {
    this.#store.clear();
    this.#disposed = true;
  }

  #assertOpen(): void {
    if (this.#disposed) throw new Error("MemoryBlobAdapter has been disposed");
  }
}
