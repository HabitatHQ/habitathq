import { describe, it, expect } from 'vitest'
import { useFirstVisit } from '~/composables/useFirstVisit'

describe('useFirstVisit', () => {
  it('returns true on the first call for a key, false thereafter', () => {
    expect(useFirstVisit('alpha')).toBe(true)
    expect(useFirstVisit('alpha')).toBe(false)
    expect(useFirstVisit('alpha')).toBe(false)
  })

  it('tracks keys independently', () => {
    expect(useFirstVisit('beta')).toBe(true)
    expect(useFirstVisit('gamma')).toBe(true)
    expect(useFirstVisit('beta')).toBe(false)
    expect(useFirstVisit('gamma')).toBe(false)
  })
})
