/**
 * Build-time helpers for deriving CSP script-src hashes from HTML.
 *
 * These are pure Node functions (no Vite/Nuxt runtime dependency) so they
 * can be unit-tested directly with Vitest.
 *
 * Usage in nuxt.config.ts:
 *   import { cspHashPlugin } from './lib/csp-hashes'
 *   vite: { plugins: [cspHashPlugin()] }
 */

import { createHash } from 'node:crypto'

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
 * The function identifies the CSP meta tag by matching a `content` attribute
 * whose value contains `script-src` (which is unique to CSP in this codebase).
 * Returns `html` unchanged when there is nothing to do.
 */
export function injectHashesIntoCsp(html: string, hashes: string[]): string {
  if (hashes.length === 0) return html
  const hashStr = ' ' + hashes.join(' ')

  return html.replace(
    // Match the content attribute of the CSP meta tag.
    // Our CSP always starts with "default-src 'self'" — distinctive enough.
    /(content=")(default-src 'self'[^"]*)(")/,
    (_, pre, csp, post) =>
      pre + csp.replace(/(script-src\b[^;]*)/, (directive) => directive + hashStr) + post,
  )
}

/**
 * Vite plugin that, as a post-order `transformIndexHtml` hook, automatically
 * hashes every inline `<script>` in the final HTML and appends those hashes
 * to the CSP meta tag's `script-src` directive.
 *
 * Works for both `vite dev` and `vite build` — the hook runs after all other
 * plugins (including @nuxt/ui's color-mode script injection) have finished.
 */
export function cspHashPlugin() {
  return {
    name: 'habitat:csp-hash-inject',
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string): string {
        const hashes = extractInlineScriptHashes(html)
        return injectHashesIntoCsp(html, hashes)
      },
    },
  }
}
