/** Options for BlobAdapter operations. */
export interface BlobAdapterOptions {
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Storage adapter for binary blob data.
 *
 * Implementations: IDBBlobAdapter (IndexedDB), LocalStorageBlobAdapter,
 * MemoryBlobAdapter.
 */
export interface BlobAdapter {
  /** Store blob bytes under `id`. */
  put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void>;
  /** Retrieve blob bytes for `id`. Returns `null` if not found. */
  get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null>;
  /** Delete blob data for `id`. No-op if not present. */
  delete(id: string, options?: BlobAdapterOptions): Promise<void>;
  /** Check whether a blob exists for `id`. */
  has(id: string, options?: BlobAdapterOptions): Promise<boolean>;
}

/** Supported output formats for BlobAdapter.get(). */
export type BlobGetFormat = "bytes" | "blob" | "url" | "stream";

/** Resolved return type based on format. */
export type BlobGetResult<F extends BlobGetFormat> = F extends "bytes"
  ? Uint8Array | null
  : F extends "blob"
    ? Blob | null
    : F extends "url"
      ? string | null
      : F extends "stream"
        ? ReadableStream<Uint8Array> | null
        : never;
