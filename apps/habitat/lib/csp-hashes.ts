/**
 * Build-time helpers for deriving CSP script-src hashes from HTML.
 *
 * These are pure Node functions (no Vite/Nuxt runtime dependency) so they
 * can be unit-tested directly with Vitest.
 */

import { createHash } from 'node:crypto'

/**
 * The canonical CSP directives for this app (no inline-script hashes).
 * Hashes are appended at build time by `buildFullCsp()`.
 *
 * `frame-ancestors` is intentionally absent — browsers ignore it inside
 * `<meta>` tags; use an HTTP response header for clickjacking protection.
 */
export const CSP_DIRECTIVES = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' is required for SQLite WASM compilation.
  // Inline-script hashes are appended by buildFullCsp().
  "script-src 'self' 'wasm-unsafe-eval'",
  // 'unsafe-inline' needed for Vue :style bindings (e.g. category colours)
  "style-src 'self' 'unsafe-inline'",
  // blob: for IDB image/voice playback & export downloads; data: for SVG bg-images
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  // blob: covers DB worker bundled as a blob URL by some bundlers
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
]

/**
 * Build the complete CSP string from `CSP_DIRECTIVES`, appending
 * inline-script hashes to the `script-src` directive.
 */
export function buildFullCsp(hashes: string[]): string {
  return CSP_DIRECTIVES.map((d) =>
    hashes.length > 0 && d.startsWith('script-src ')
      ? `${d} ${hashes.join(' ')}`
      : d,
  ).join('; ')
}

/**
 * Inject (or replace) a `<meta http-equiv="Content-Security-Policy">` tag
 * in the `<head>` of `html`. If a CSP meta tag already exists it is replaced
 * in-place; otherwise the tag is inserted before `</head>`.
 */
export function injectFullCspMetaTag(html: string, csp: string): string {
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  const replaced = html.replace(
    /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i,
    metaTag,
  )
  if (replaced !== html) return replaced
  return html.replace('</head>', `  ${metaTag}\n</head>`)
}

/**
 * Extract SHA-256 hashes (in CSP token form, e.g. `'sha256-abc123='`) for
 * every non-empty inline `<script>` element found in `html`.
 *
 * External scripts (`<script src="…">`) are skipped because they load from
 * URLs and don't need an inline hash.
 */
export function extractInlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  // Match <script> tags that have NO src= attribute
  const re = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const body = m[1] ?? ''
    if (body.trim().length === 0) continue
    const hash = createHash('sha256').update(body, 'utf8').digest('base64')
    hashes.push(`'sha256-${hash}'`)
  }
  return hashes
}

/**
 * Patch the `script-src` directive inside a `<meta http-equiv="Content-Security-Policy">`
 * tag's `content` attribute by appending `hashes`.
 *
 * Kept for backward compatibility with existing unit tests.
 * New code should use `buildFullCsp` + `injectFullCspMetaTag` instead.
 */
export function injectHashesIntoCsp(html: string, hashes: string[]): string {
  if (hashes.length === 0) return html
  const hashStr = ' ' + hashes.join(' ')

  return html.replace(
    // Match the content attribute of the CSP meta tag.
    // Our CSP always starts with "default-src 'self'" — distinctive enough.
    /(content=")(default-src 'self'[^"]*)(")/,
    (_, pre, csp, post) =>
      pre + csp.replace(/(script-src\b[^;]*)/, (directive: string) => directive + hashStr) + post,
  )
}

/**
 * Vite plugin that, as a post-order `transformIndexHtml` hook, automatically
 * hashes every inline `<script>` in the final HTML and injects the full CSP
 * meta tag (all directives + computed hashes).
 *
 * Used in dev mode (`vite dev`). Production builds use the `nitro:build:done`
 * hook in `nuxt.config.ts` instead, which runs after Nitro's prerenderer has
 * written the final HTML files to `.output/public/`.
 */
export function cspHashPlugin() {
  return {
    name: 'habitat:csp-hash-inject',
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string): string {
        const hashes = extractInlineScriptHashes(html)
        const csp = buildFullCsp(hashes)
        return injectFullCspMetaTag(html, csp)
      },
    },
  }
}
