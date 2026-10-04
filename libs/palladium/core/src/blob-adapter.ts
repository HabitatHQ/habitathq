import type { DbAdapter } from "./db-adapter.js";
import type { StorageAdapter } from "./storage.js";

/** Options for BlobAdapter operations. */
export interface BlobAdapterOptions {
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Transaction-scoped executor to couple blob writes to a domain mutation. */
  transaction?: StorageAdapter | DbAdapter;
}

/**
 * Storage adapter for binary blob data.
 *
 * Implementations: IDBBlobAdapter (IndexedDB), LocalStorageBlobAdapter,
 * MemoryBlobAdapter, and SQLiteBlobAdapter.
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

/**
 * Optional lifecycle supported by media backends that own external resources.
 * The methods are optional on BlobAdapter so existing engine callers remain
 * compatible; applications that own the backend should call dispose at close.
 */
export interface BlobStoreLifecycle {
  /** Remove every blob belonging to this adapter's explicit namespace. */
  clear(options?: BlobAdapterOptions): Promise<void>;
  /** Release the adapter's resources. Repeated calls are safe. */
  dispose(): Promise<void>;
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
