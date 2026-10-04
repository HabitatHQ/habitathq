import type {
  BlobAdapter,
  BlobAdapterOptions,
  BlobGetFormat,
  BlobGetResult,
  BlobStoreLifecycle,
} from "./blob-adapter.js";
import { convertBlobBytes } from "./blob-format.js";
import type { BlobRegistry } from "./blob-registry.js";

/** High-level blob API exposed as `engine.blobs`. */
export class BlobHandle {
  readonly #adapter: BlobAdapter;
  readonly #registry: BlobRegistry;

  constructor(adapter: BlobAdapter, registry: BlobRegistry) {
    this.#adapter = adapter;
    this.#registry = registry;
  }

  /** Store bytes. */
  async put(id: string, bytes: Uint8Array, options?: BlobAdapterOptions): Promise<void> {
    return this.#adapter.put(id, bytes, options);
  }

  /** Retrieve bytes in the requested format. Default: "bytes". */
  async get<F extends BlobGetFormat = "bytes">(
    id: string,
    format?: F,
    options?: BlobAdapterOptions,
  ): Promise<BlobGetResult<F>> {
    const bytes = await this.#adapter.get(id, options);
    const fmt = (format ?? "bytes") as F;
    const result = convertBlobBytes(bytes, fmt);
    // Track object URLs so they can be revoked on close
    if (fmt === "url" && typeof result === "string") {
      this.#registry.track(result);
    }
    return result;
  }

  /** Delete a blob. */
  async delete(id: string, options?: BlobAdapterOptions): Promise<void> {
    return this.#adapter.delete(id, options);
  }

  /** Check if a blob exists. */
  async has(id: string, options?: BlobAdapterOptions): Promise<boolean> {
    return this.#adapter.has(id, options);
  }
  /** Remove every blob in the configured backend namespace. */
  async clear(options?: BlobAdapterOptions): Promise<void> {
    const lifecycle = this.#lifecycle();
    await lifecycle.clear(options);
    this.#registry.revokeAll();
  }

  /** Release adapter resources; unsupported custom adapters fail explicitly. */
  async dispose(): Promise<void> {
    const lifecycle = this.#lifecycle();
    try {
      await lifecycle.dispose();
    } finally {
      this.#registry.revokeAll();
    }
  }

  /** Release browser connections and URLs without permanently disposing the store. */
  async close(): Promise<void> {
    const adapter = this.#adapter;
    try {
      if ("close" in adapter && typeof adapter.close === "function") await adapter.close();
    } finally {
      this.#registry.revokeAll();
    }
  }

  /** Track typed browser media URLs alongside URLs returned by get(). */
  createObjectURL(blob: Blob): string {
    return this.#registry.track(URL.createObjectURL(blob));
  }

  revokeObjectURL(url: string): void {
    this.#registry.revoke(url);
  }

  #lifecycle(): BlobStoreLifecycle {
    const adapter = this.#adapter as BlobAdapter & Partial<BlobStoreLifecycle>;
    if (typeof adapter.clear !== "function" || typeof adapter.dispose !== "function") {
      throw new Error("Blob adapter does not support media lifecycle operations");
    }
    return adapter as BlobStoreLifecycle;
  }
}
