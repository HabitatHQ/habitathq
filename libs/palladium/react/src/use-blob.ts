import type { PalladiumEngine, SchemaMap } from "@palladium/core";
import { useEffect, useState } from "react";

/**
 * Returns the raw bytes for a blob or `null` if not loaded or `id` is null.
 *
 * Re-fetches whenever `id` changes.
 */
export function useBlob<S extends SchemaMap>(
  engine: PalladiumEngine<S>,
  id: string | null,
): Uint8Array | null {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  useEffect(() => {
    if (id === null) {
      setBytes(null);
      return;
    }
    const controller = new AbortController();

    engine.blobs
      .get(id, "bytes", { signal: controller.signal })
      .then((b) => {
        if (!controller.signal.aborted) {
          setBytes(b);
        }
      })
      .catch(() => {
        // Aborted or error
      });

    return () => {
      controller.abort();
    };
  }, [engine, id]);

  return bytes;
}
