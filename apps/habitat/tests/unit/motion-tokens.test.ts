import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Motion-tokens drift guard.
 *
 * The shared motion design system (libs/habitat-shared/app/assets/css/
 * animations.css) is the single source of truth for easings and durations.
 * These tests fail if that source drifts — e.g. an easing curve gets inlined
 * as a raw cubic-bezier() instead of referencing a --ease-* token.
 *
 * Scope note: this phase guards the SHARED layer only. Extending the raw-easing
 * check to the app itself is part of the phase-2 migration, once the app's
 * hand-rolled animations have been moved onto the shared presets.
 */

// vitest cwd is the app root (apps/habitat); the shared layer is two up.
const cssDir = resolve(process.cwd(), '../../libs/habitat-shared/app/assets/css')
const read = (file: string) => readFileSync(resolve(cssDir, file), 'utf8')

const SHARED_CSS = ['animations.css', 'buttons.css', 'safe-area.css']

// Canonical motion tokens the presets (and app code) must reference by name.
const REQUIRED_TOKENS = [
  '--ease-out',
  '--ease-in-out',
  '--ease-drawer',
  '--duration-fast',
  '--duration-normal',
  '--duration-exit',
  '--duration-slow',
  '--duration-slower',
]

// Every named-<Transition> preset must ship its enter+leave classes.
const REQUIRED_PRESETS = [
  'sheet-slide',
  'sheet-scale',
  'page-slide-up',
  'reveal',
  'swap',
  'swap-slow',
]

describe('motion tokens', () => {
  it('defines every canonical motion token', () => {
    const css = read('animations.css')
    for (const token of REQUIRED_TOKENS) {
      expect(css, `missing token ${token}`).toContain(`${token}:`)
    }
  })

  it('declares easings only as tokens (no raw cubic-bezier outside :root)', () => {
    for (const file of SHARED_CSS) {
      // Strip comments, then :root token blocks (the one place raw
      // cubic-bezier is allowed) — what remains is enforceable CSS.
      const body = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/:root\s*\{[^}]*\}/g, '')
      expect(
        body,
        `${file} inlines a raw cubic-bezier() — use var(--ease-*) instead`,
      ).not.toMatch(/cubic-bezier\(/)
    }
  })

  it('ships enter + leave classes for every named-transition preset', () => {
    const css = read('animations.css')
    for (const preset of REQUIRED_PRESETS) {
      expect(css, `${preset} missing enter class`).toContain(
        `.${preset}-enter-active`,
      )
      expect(css, `${preset} missing leave class`).toContain(
        `.${preset}-leave-active`,
      )
    }
  })

  it('honors reduce-motion via BOTH the OS query and the in-app class', () => {
    const css = read('animations.css')
    const { media, inApp } = reduceMotionBlocks(css)

    // A global keyframe safety-net must appear in each mechanism so decorative
    // ambient loops (declared per-page) can't keep running under reduce-motion.
    const net = /animation-iteration-count:\s*1\s*!important/
    expect(media, 'global animation safety-net missing from @media reduce-motion').toMatch(net)
    expect(inApp, 'global animation safety-net missing from html.reduce-motion').toMatch(net)

    // Every named-transition preset must be neutralized under both mechanisms,
    // and so must the backdrop scrim fade (opacity-only, but still zeroed).
    // Each block is checked in isolation so dropping a preset from just one
    // mechanism still fails.
    for (const target of [...REQUIRED_PRESETS.map((p) => `.${p}-leave-active`), '.sheet-backdrop']) {
      expect(media, `${target} not neutralized under @media reduce-motion`).toContain(target)
      expect(inApp, `${target} not neutralized under html.reduce-motion`).toContain(target)
    }
  })
})

/**
 * Split animations.css into its two reduce-motion regions so each can be
 * asserted independently: the body inside `@media (prefers-reduced-motion:
 * reduce) { … }`, and everything after it (where the `html.reduce-motion`
 * rules live). Brace-matched rather than regex-sliced so one block's rules
 * never leak into the other block's assertions.
 */
function reduceMotionBlocks(css: string): { media: string; inApp: string } {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  if (start === -1) throw new Error('no prefers-reduced-motion media block')
  const open = css.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('unbalanced @media block')
  const inApp = css.slice(end + 1)
  if (!/html\.reduce-motion\b/.test(inApp)) throw new Error('no html.reduce-motion rules after @media block')
  return { media: css.slice(open + 1, end), inApp }
}
