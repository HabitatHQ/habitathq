import type { BlobAdapter, BlobAdapterOptions } from "./blob-adapter.js";

/** Blob storage in localStorage using base64 encoding. Opt-in for very small blobs. */
export class LocalStorageBlobAdapter implements BlobAdapter {
  readonly #prefix: string;

  constructor(prefix = "palladium-blob:") {
    this.#prefix = prefix;
  }

  async put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const b64 = bytesToBase64(bytes);
    localStorage.setItem(this.#prefix + id, b64);
  }

  async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    options?.signal?.throwIfAborted();
    const b64 = localStorage.getItem(this.#prefix + id);
    return b64 === null ? null : base64ToBytes(b64);
  }

  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    localStorage.removeItem(this.#prefix + id);
  }

  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    return localStorage.getItem(this.#prefix + id) !== null;
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
