import type { BlobAdapter, BlobAdapterOptions } from "./blob-adapter.js";

/** In-memory blob adapter. Used as a fallback when no blob adapter is configured. */
export class MemoryBlobAdapter implements BlobAdapter {
  readonly #store = new Map<string, Uint8Array>();

  async put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    this.#store.set(id, bytes);
  }

  async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    options?.signal?.throwIfAborted();
    return this.#store.get(id) ?? null;
  }

  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    this.#store.delete(id);
  }

  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    return this.#store.has(id);
  }
}
