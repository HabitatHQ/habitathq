import { describe, expect, it } from 'vitest'
import { getKeyboardInset } from '~/utils/keyboard-viewport'

describe('getKeyboardInset', () => {
  it('returns zero when the visual viewport fills the layout viewport', () => {
    expect(getKeyboardInset(844, { height: 844, scale: 1 })).toBe(0)
  })

  it('returns the portion obscured by the iOS software keyboard', () => {
    expect(getKeyboardInset(844, { height: 510, scale: 1 })).toBe(334)
  })

  it('does not mistake pinch zoom for keyboard occlusion', () => {
    expect(getKeyboardInset(844, { height: 422, scale: 2 })).toBe(0)
  })

  it('accounts for keyboard occlusion while pinch zoom is active', () => {
    expect(getKeyboardInset(844, { height: 255, scale: 2 })).toBe(334)
  })

  it('never returns a negative inset', () => {
    expect(getKeyboardInset(844, { height: 900, scale: 1 })).toBe(0)
  })
})
