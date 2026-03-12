/**
 * Parse a JSON string from a DB column, returning `fallback` on null, undefined,
 * a JSON-null value (`"null"`), or a parse error.
 */
export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (str == null) return fallback
  try {
    const parsed = JSON.parse(str) as T
    return parsed ?? fallback
  } catch {
    console.warn('[db] JSON.parse failed for column value:', str)
    return fallback
  }
}
