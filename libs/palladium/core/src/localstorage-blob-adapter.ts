import type { BlobAdapter, BlobAdapterOptions, BlobStoreLifecycle } from "./blob-adapter.js";

/** Blob storage in localStorage using base64 encoding. Opt-in for very small blobs. */
export class LocalStorageBlobAdapter implements BlobAdapter, BlobStoreLifecycle {
  readonly #prefix: string;
  #disposed = false;

  constructor(prefix = "palladium-blob:") {
    this.#prefix = prefix;
  }

  async put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    const b64 = bytesToBase64(bytes);
    localStorage.setItem(this.#prefix + id, b64);
  }

  async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    const b64 = localStorage.getItem(this.#prefix + id);
    return b64 === null ? null : base64ToBytes(b64);
  }

  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    localStorage.removeItem(this.#prefix + id);
  }

  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    return localStorage.getItem(this.#prefix + id) !== null;
  }

  async clear(options?: BlobAdapterOptions): Promise<void> {
    this.#assertOpen();
    options?.signal?.throwIfAborted();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.#prefix)) localStorage.removeItem(key);
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
  }

  #assertOpen(): void {
    if (this.#disposed) throw new Error("LocalStorageBlobAdapter has been disposed");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
