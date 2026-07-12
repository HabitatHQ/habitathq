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
})
