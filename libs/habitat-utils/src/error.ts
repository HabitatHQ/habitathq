/** Log a scoped error to the console and return the message string. */
export function logError(scope: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[${scope}]`, msg)
  return msg
}
