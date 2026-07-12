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
    // Both mechanisms must exist: OS-level media query + in-app html.reduce-motion.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toMatch(/html\.reduce-motion\b/)

    // A global keyframe safety-net must appear in each mechanism so decorative
    // ambient loops (declared per-page) can't keep running under reduce-motion.
    const net = css.match(/animation-iteration-count:\s*1\s*!important/g) ?? []
    expect(net.length, 'global animation safety-net missing from a reduce-motion block').toBeGreaterThanOrEqual(2)

    // Every named-transition preset must be neutralized under both mechanisms,
    // and so must the backdrop scrim fade (opacity-only, but still zeroed).
    for (const target of [...REQUIRED_PRESETS.map((p) => `${p}-leave-active`), 'sheet-backdrop']) {
      expect(css, `${target} not neutralized under @media reduce-motion`).toMatch(
        new RegExp(`@media \\(prefers-reduced-motion: reduce\\)[\\s\\S]*\\.${target}`),
      )
      expect(css, `${target} not neutralized under html.reduce-motion`).toMatch(
        new RegExp(`html\\.reduce-motion[\\s\\S]*\\.${target}`),
      )
    }
  })
})
