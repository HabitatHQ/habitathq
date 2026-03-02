import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { extractInlineScriptHashes, injectHashesIntoCsp } from '../../lib/csp-hashes'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256b64(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64')
}

function cspToken(text: string): string {
  return `'sha256-${sha256b64(text)}'`
}

const BASE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'"

function wrapInHead(scriptTag: string, cspContent = BASE_CSP): string {
  return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="${cspContent}">
${scriptTag}
</head><body></body></html>`
}

// ─── extractInlineScriptHashes ───────────────────────────────────────────────

describe('extractInlineScriptHashes', () => {
  it('returns empty array for HTML with no scripts', () => {
    expect(extractInlineScriptHashes('<html><body></body></html>')).toEqual([])
  })

  it('returns empty array for HTML with only external scripts', () => {
    const html = '<script src="/_nuxt/app.js"></script><script src="/other.js" type="module"></script>'
    expect(extractInlineScriptHashes(html)).toEqual([])
  })

  it('returns empty array for empty inline script', () => {
    expect(extractInlineScriptHashes('<script></script>')).toEqual([])
    expect(extractInlineScriptHashes('<script>   </script>')).toEqual([])
    expect(extractInlineScriptHashes('<script>\n\n</script>')).toEqual([])
  })

  it('hashes a simple inline script', () => {
    const body = 'console.log("hello")'
    const html = `<script>${body}</script>`
    expect(extractInlineScriptHashes(html)).toEqual([cspToken(body)])
  })

  it('hashes a multiline inline script exactly (no trimming)', () => {
    const body = '\n(function(){ var x = 1; })()\n'
    const html = `<script>${body}</script>`
    expect(extractInlineScriptHashes(html)).toEqual([cspToken(body)])
  })

  it('hashes a script with attributes (no src)', () => {
    const body = 'window.__theme = "dark"'
    const html = `<script nonce="" data-x="1">${body}</script>`
    expect(extractInlineScriptHashes(html)).toEqual([cspToken(body)])
  })

  it('skips external script even when mixed with inline scripts', () => {
    const inlineBody = 'var x = 1'
    const html = `<script src="/app.js"></script><script>${inlineBody}</script>`
    const hashes = extractInlineScriptHashes(html)
    expect(hashes).toHaveLength(1)
    expect(hashes[0]).toBe(cspToken(inlineBody))
  })

  it('collects hashes for multiple inline scripts', () => {
    const a = 'var a = 1'
    const b = 'var b = 2'
    const html = `<script>${a}</script><p>text</p><script>${b}</script>`
    const hashes = extractInlineScriptHashes(html)
    expect(hashes).toHaveLength(2)
    expect(hashes).toContain(cspToken(a))
    expect(hashes).toContain(cspToken(b))
  })

  it('produces distinct hashes for different content', () => {
    const html = `<script>var x = 1</script><script>var x = 2</script>`
    const [h1, h2] = extractInlineScriptHashes(html)
    expect(h1).not.toBe(h2)
  })

  it('produces the same hash for identical content', () => {
    const body = 'var x = 1'
    const html = `<script>${body}</script><script>${body}</script>`
    const [h1, h2] = extractInlineScriptHashes(html)
    expect(h1).toBe(h2)
  })

  it('hash tokens are wrapped in single quotes per CSP syntax', () => {
    const hash = extractInlineScriptHashes('<script>x</script>')[0]
    expect(hash).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/)
  })

  it('hash is base64-encoded SHA-256', () => {
    const body = 'var x = 1'
    const expected = `'sha256-${sha256b64(body)}'`
    const [hash] = extractInlineScriptHashes(`<script>${body}</script>`)
    expect(hash).toBe(expected)
  })

  it('handles a real-world Nuxt color-mode-style IIFE', () => {
    const body = `(function(){var d=document.documentElement,c=d.classList;c.remove('light','dark');var e=localStorage.getItem('nuxt-color-mode');if(e==='system'||!e){var t=window.matchMedia('(prefers-color-scheme: dark)');c.add(t.matches?'dark':'light')}else{c.add(e||'')}})()`
    const html = `<html><head><script>${body}</script></head></html>`
    const hashes = extractInlineScriptHashes(html)
    expect(hashes).toHaveLength(1)
    expect(hashes[0]).toBe(cspToken(body))
  })
})

// ─── injectHashesIntoCsp ─────────────────────────────────────────────────────

describe('injectHashesIntoCsp', () => {
  it('returns html unchanged when hashes is empty', () => {
    const html = wrapInHead('<script>x</script>')
    expect(injectHashesIntoCsp(html, [])).toBe(html)
  })

  it('returns html unchanged when no CSP meta tag is present', () => {
    const html = '<html><body><script>x</script></body></html>'
    const hash = cspToken('x')
    expect(injectHashesIntoCsp(html, [hash])).toBe(html)
  })

  it('appends a single hash to script-src', () => {
    const hash = cspToken('var x = 1')
    const html = wrapInHead('')
    const result = injectHashesIntoCsp(html, [hash])
    expect(result).toContain(`script-src 'self' 'wasm-unsafe-eval' ${hash}`)
  })

  it('appends multiple hashes to script-src', () => {
    const h1 = cspToken('var a = 1')
    const h2 = cspToken('var b = 2')
    const html = wrapInHead('')
    const result = injectHashesIntoCsp(html, [h1, h2])
    expect(result).toContain(`script-src 'self' 'wasm-unsafe-eval' ${h1} ${h2}`)
  })

  it('does not modify other directives', () => {
    const hash = cspToken('x')
    const html = wrapInHead('')
    const result = injectHashesIntoCsp(html, [hash])
    expect(result).toContain("default-src 'self'")
    expect(result).toContain("style-src 'self' 'unsafe-inline'")
    expect(result).toContain("connect-src 'self'")
  })

  it('injects a hash exactly once per call', () => {
    const hash = cspToken('x')
    const html = wrapInHead('')
    const once = injectHashesIntoCsp(html, [hash])
    // Use split-based count to avoid regex metachar issues with base64 (+, =, /)
    const count = once.split(hash).length - 1
    expect(count).toBe(1)
  })

  it('round-trips: extract then inject produces correct script-src', () => {
    const scriptBody = `(function(){document.documentElement.classList.add('dark')})()`
    const html = wrapInHead(`<script>${scriptBody}</script>`)
    const hashes = extractInlineScriptHashes(html)
    const result = injectHashesIntoCsp(html, hashes)
    const expected = `script-src 'self' 'wasm-unsafe-eval' ${cspToken(scriptBody)}`
    expect(result).toContain(expected)
  })

  it('full round-trip with multiple inline scripts', () => {
    const a = 'var a = 1'
    const b = 'var b = 2'
    const html = wrapInHead(`<script>${a}</script><script>${b}</script>`)
    const hashes = extractInlineScriptHashes(html)
    expect(hashes).toHaveLength(2)
    const result = injectHashesIntoCsp(html, hashes)
    // Both hashes appear in the script-src
    for (const h of hashes) {
      expect(result).toContain(h)
    }
    // Other directives preserved
    expect(result).toContain("default-src 'self'")
  })

  it('does not touch the HTML outside the CSP meta content attribute', () => {
    const hash = cspToken('x')
    const html = wrapInHead(`<script>x</script>`)
    const result = injectHashesIntoCsp(html, [hash])
    // The inline script itself should not be modified
    expect(result).toContain('<script>x</script>')
  })
})

// ─── End-to-end: plugin behaviour simulation ─────────────────────────────────

describe('end-to-end: extractInlineScriptHashes + injectHashesIntoCsp', () => {
  it('a Nuxt-style HTML with one inline script ends up with correct CSP', () => {
    const inlineScript = `(function(){var e=localStorage.getItem('nuxt-color-mode');document.documentElement.classList.add(e||'dark')})()`
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${BASE_CSP}">
  <script>${inlineScript}</script>
  <script type="module" src="/_nuxt/app.js"></script>
</head>
<body><div id="__nuxt"></div></body>
</html>`

    const hashes = extractInlineScriptHashes(html)
    expect(hashes).toHaveLength(1) // only the inline one, not the src= one

    const patched = injectHashesIntoCsp(html, hashes)
    expect(patched).toContain(`script-src 'self' 'wasm-unsafe-eval' ${cspToken(inlineScript)}`)
    // external script tag untouched
    expect(patched).toContain('src="/_nuxt/app.js"')
  })

  it('HTML with no inline scripts leaves CSP unchanged', () => {
    const html = `<!DOCTYPE html>
<html><head>
  <meta http-equiv="Content-Security-Policy" content="${BASE_CSP}">
  <script type="module" src="/_nuxt/entry.js"></script>
</head><body></body></html>`

    const hashes = extractInlineScriptHashes(html)
    expect(hashes).toHaveLength(0)
    const patched = injectHashesIntoCsp(html, hashes)
    expect(patched).toBe(html)
  })
})
