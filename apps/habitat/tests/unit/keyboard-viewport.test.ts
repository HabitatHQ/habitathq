import { describe, expect, it } from 'vitest'
import { getKeyboardInset } from '~/utils/keyboard-viewport'

describe('getKeyboardInset', () => {
  it('returns zero when the visual viewport fills the layout viewport', () => {
    expect(getKeyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0)
  })

  it('returns the portion obscured by the iOS software keyboard', () => {
    expect(getKeyboardInset(844, { height: 510, offsetTop: 0 })).toBe(334)
  })

  it('accounts for a visual viewport offset and never returns a negative inset', () => {
    expect(getKeyboardInset(844, { height: 700, offsetTop: 20 })).toBe(124)
    expect(getKeyboardInset(844, { height: 900, offsetTop: 0 })).toBe(0)
  })
})
