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
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) {
      setUrl(null);
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;

    engine.blobs
      .get(id, "url", { signal: controller.signal })
      .then((u) => {
        if (!controller.signal.aborted) {
          objectUrl = u;
          setUrl(u);
        }
      })
      .catch(() => {
        // Aborted or error — leave url as null
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [engine, id]);

  return url;
}
