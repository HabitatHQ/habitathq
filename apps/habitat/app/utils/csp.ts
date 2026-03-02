/**
 * Strict CSP directives — blocks all fetch/XHR (`connect-src 'none'`) while
 * keeping everything needed for the offline WASM + OPFS experience:
 *   - script: 'wasm-unsafe-eval' for SQLite WASM compilation
 *   - worker: blob: for the DB worker URL emitted by the bundler
 *   - img/media/font: self + blob/data for cached assets
 *   - connect: 'none' — no outbound network at all
 *
 * NOTE: `frame-ancestors` is intentionally omitted; it has no effect in a
 * <meta> CSP tag and is already present in the HTTP headers via nuxt.config.ts.
 */
export const STRICT_CSP_DIRECTIVES = [
  "default-src 'self'",
  // hash = @nuxt/ui color-mode FOUC-prevention inline script
  "script-src 'self' 'wasm-unsafe-eval' 'sha256-7QIjPOpXT97VD5NmIGqI7WTiAFunWN1i1ifDHVp5i+g='",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'none'", // blocks fetch() and XHR entirely
  "worker-src 'self' blob:", // SQLite DB worker
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
] as const

export const STRICT_CSP = STRICT_CSP_DIRECTIVES.join('; ')

/** localStorage key used by useAppSettings */
export const SETTINGS_STORAGE_KEY = 'habitat-app-settings'

/**
 * Read the `strictCsp` flag from a serialised AppSettings JSON string.
 * Pure function — no side effects, safe to call in any context.
 */
export function parseStrictCspSetting(storageJson: string | null): boolean {
  if (!storageJson) return false
  try {
    const parsed: unknown = JSON.parse(storageJson)
    if (typeof parsed !== 'object' || parsed === null) return false
    const val = (parsed as Record<string, unknown>)['strictCsp']
    return val === true // strict equality — only boolean true
  } catch {
    return false
  }
}
