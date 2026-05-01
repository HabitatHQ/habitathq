/**
 * Tracks object URLs created via URL.createObjectURL so they can be revoked
 * on engine close. Each engine instance owns one BlobRegistry.
 */
export class BlobRegistry {
  readonly #urls = new Set<string>();

  /** Register a URL for later revocation. Returns the same URL for chaining. */
  track(url: string): string {
    this.#urls.add(url);
    return url;
  }

  /** Revoke one URL and stop tracking it. */
  revoke(url: string): void {
    URL.revokeObjectURL(url);
    this.#urls.delete(url);
  }

  /** Revoke all tracked URLs. Called on engine.close(). */
  revokeAll(): void {
    for (const url of this.#urls) {
      URL.revokeObjectURL(url);
    }
    this.#urls.clear();
  }

  /** Number of currently tracked URLs. */
  get size(): number {
    return this.#urls.size;
  }
}
