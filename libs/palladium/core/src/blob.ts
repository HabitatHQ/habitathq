/** A compact reference to a blob, stored in a data column. */
export interface BlobRef {
  /** Blob UUID. */
  id: string;
  /** Blob size in bytes. */
  sizeBytes: number;
  /** MIME type. */
  mimeType: string;
}

/** Serialize a BlobRef to a JSON string for storage in a data column. */
export function blobRefToColumnValue(ref: BlobRef): string {
  return JSON.stringify({ id: ref.id, sizeBytes: ref.sizeBytes, mimeType: ref.mimeType });
}

/** Deserialize a BlobRef from a JSON column value. Returns null on parse failure. */
export function blobRefFromColumnValue(value: string): BlobRef | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      !("sizeBytes" in parsed) ||
      !("mimeType" in parsed)
    ) {
      return null;
    }
    const p = parsed as { id: unknown; sizeBytes: unknown; mimeType: unknown };
    if (
      typeof p.id !== "string" ||
      typeof p.sizeBytes !== "number" ||
      typeof p.mimeType !== "string"
    ) {
      return null;
    }
    return { id: p.id, sizeBytes: p.sizeBytes, mimeType: p.mimeType };
  } catch {
    return null;
  }
}
