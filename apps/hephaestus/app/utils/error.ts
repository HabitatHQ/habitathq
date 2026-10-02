export function logError(context: string, error: unknown): void {
  console.error(`[${context}]`, error instanceof Error ? error.message : String(error))
}
