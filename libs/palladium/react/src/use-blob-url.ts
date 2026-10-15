import type { PalladiumEngine, SchemaMap } from "@palladium/core";
import { useEffect, useState } from "react";

/**
 * Returns an object URL for the blob with the given `id`, or `null` if
 * not yet loaded or `id` is null.
 *
 * The object URL is automatically revoked when the component unmounts or
 * when `id` changes.
 */
export function useBlobUrl<S extends SchemaMap>(
  engine: PalladiumEngine<S>,
  id: string | null,
): string | null {
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
    url: string | null;
  } | null>(null);

  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;

    engine.blobs
      .get(id, "url", { signal: controller.signal })
      .then((url) => {
        if (controller.signal.aborted) {
          if (url) engine.blobs.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setResult({ engine, id, generation, url });
      })
      .catch(() => {
        // Aborted or error
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        engine.blobs.revokeObjectURL(objectUrl);
      }
    };
  }, [engine, id, generation]);

  return requestMatches &&
    result?.engine === engine &&
    result.id === id &&
    result.generation === generation
    ? result.url
    : null;
}
