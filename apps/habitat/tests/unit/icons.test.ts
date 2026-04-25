import { describe, expect, it } from 'vitest'
import { ICON_SIZES, iconRegistry, iconsByCategory, resolveIcon } from '~/utils/icons'

describe('resolveIcon', () => {
  it('resolves a registry name to its outline class', () => {
    expect(resolveIcon('star')).toBe('i-heroicons-star')
    expect(resolveIcon('plus')).toBe('i-heroicons-plus')
    expect(resolveIcon('check')).toBe('i-heroicons-check')
  })

  it('resolves a registry name to its solid class', () => {
    expect(resolveIcon('star', 'solid')).toBe('i-heroicons-star-solid')
    expect(resolveIcon('heart', 'solid')).toBe('i-heroicons-heart-solid')
  })

  it('resolves micro variant for play/pause', () => {
    expect(resolveIcon('play', 'micro')).toBe('i-heroicons-play-16-solid')
    expect(resolveIcon('pause', 'micro')).toBe('i-heroicons-pause-16-solid')
  })

  it('falls back to outline when requested variant is unavailable', () => {
    expect(resolveIcon('battery-100', 'solid')).toBe('i-heroicons-battery-100')
    expect(resolveIcon('star', 'micro')).toBe('i-heroicons-star')
  })

  it('passes through raw i-* strings unchanged', () => {
    expect(resolveIcon('i-heroicons-star')).toBe('i-heroicons-star')
    expect(resolveIcon('i-lucide-star')).toBe('i-lucide-star')
    expect(resolveIcon('i-custom-logo')).toBe('i-custom-logo')
  })

  it('passes through raw strings unchanged regardless of variant', () => {
    expect(resolveIcon('i-heroicons-star', 'solid')).toBe('i-heroicons-star')
  })

  it('returns name unchanged for unknown non-prefixed names', () => {
    expect(resolveIcon('unknown-icon-xyz')).toBe('unknown-icon-xyz')
  })
})

describe('iconsByCategory', () => {
  it('groups all icons by category', () => {
    const grouped = iconsByCategory()
    const totalIcons = Object.values(grouped).flat().length
    expect(totalIcons).toBe(Object.keys(iconRegistry).length)
  })

  it('each entry includes name, outline, and label', () => {
    const grouped = iconsByCategory()
    for (const entries of Object.values(grouped)) {
      for (const entry of entries) {
        expect(entry.name).toBeTruthy()
        expect(entry.outline).toMatch(/^i-/)
        expect(entry.label).toBeTruthy()
      }
    }
  })

  it('has expected categories', () => {
    const grouped = iconsByCategory()
    const categories = Object.keys(grouped)
    expect(categories).toContain('common')
    expect(categories).toContain('navigation')
    expect(categories).toContain('action')
    expect(categories).toContain('media')
  })
})

describe('iconRegistry', () => {
  it('contains all expected icons', () => {
    const expected = [
      'star', 'heart', 'fire', 'bolt', 'sparkles',
      'plus', 'minus', 'check', 'trash', 'pencil',
      'play', 'pause', 'stop', 'microphone',
      'home', 'arrow-left', 'chevron-down',
      'calendar', 'clock', 'bell',
      'sun', 'moon',
    ]
    for (const name of expected) {
      expect(iconRegistry[name], `missing icon: ${name}`).toBeDefined()
    }
  })

  it('all entries have valid outline values starting with i-', () => {
    for (const [name, def] of Object.entries(iconRegistry)) {
      expect(def.outline, `${name} outline`).toMatch(/^i-/)
    }
  })

  it('all solid values start with i- when present', () => {
    for (const [name, def] of Object.entries(iconRegistry)) {
      if (def.solid) {
        expect(def.solid, `${name} solid`).toMatch(/^i-/)
      }
    }
  })

  it('all micro values start with i- when present', () => {
    for (const [name, def] of Object.entries(iconRegistry)) {
      if (def.micro) {
        expect(def.micro, `${name} micro`).toMatch(/^i-/)
      }
    }
  })

  it('all entries have a label and category', () => {
    for (const [name, def] of Object.entries(iconRegistry)) {
      expect(def.label, `${name} label`).toBeTruthy()
      expect(def.category, `${name} category`).toBeTruthy()
    }
  })
})

describe('ICON_SIZES', () => {
  it('documents standard size conventions', () => {
    expect(ICON_SIZES).toEqual({
      xs: 'w-3 h-3',
      sm: 'w-3.5 h-3.5',
      md: 'w-4 h-4',
      lg: 'w-5 h-5',
      xl: 'w-8 h-8',
    })
  })
})
