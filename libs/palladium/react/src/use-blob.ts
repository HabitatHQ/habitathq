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
  const [request, setRequest] = useState({ engine, id, generation: 0 });
  const requestMatches = request.engine === engine && request.id === id;
  const generation = requestMatches ? request.generation : request.generation + 1;
  if (!requestMatches) {
    setRequest({ engine, id, generation });
  }

  const [result, setResult] = useState<{
    engine: PalladiumEngine<S>;
    id: string;
    generation: number;
    bytes: Uint8Array | null;
  } | null>(null);

  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController();

    engine.blobs
      .get(id, "bytes", { signal: controller.signal })
      .then((bytes) => {
        if (!controller.signal.aborted) {
          setResult({ engine, id, generation, bytes });
        }
      })
      .catch(() => {
        // Aborted or error
      });

    return () => {
      controller.abort();
    };
  }, [engine, id, generation]);

  return requestMatches &&
    result?.engine === engine &&
    result.id === id &&
    result.generation === generation
    ? result.bytes
    : null;
}
