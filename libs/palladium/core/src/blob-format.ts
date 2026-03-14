import type { BlobGetFormat, BlobGetResult } from "./blob-adapter.js";

/**
 * Convert raw bytes to the requested output format.
 * Returns null if bytes is null.
 */
export function convertBlobBytes<F extends BlobGetFormat>(
  bytes: Uint8Array | null,
  format: F,
  mime = "application/octet-stream",
): BlobGetResult<F> {
  if (bytes === null) return null as BlobGetResult<F>;
  switch (format) {
    case "bytes":
      return bytes as BlobGetResult<F>;
    case "blob":
      return new Blob([bytes], { type: mime }) as BlobGetResult<F>;
    case "url":
      return URL.createObjectURL(new Blob([bytes], { type: mime })) as BlobGetResult<F>;
    case "stream": {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      return stream as BlobGetResult<F>;
    }
    default:
      return null as BlobGetResult<F>;
  }
}
