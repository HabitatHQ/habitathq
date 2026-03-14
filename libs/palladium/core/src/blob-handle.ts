import type {
  BlobAdapter,
  BlobAdapterOptions,
  BlobGetFormat,
  BlobGetResult,
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
}
