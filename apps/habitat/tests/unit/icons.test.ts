import { describe, expect, it } from 'vitest'
import {
  HABIT_COLORS,
  HABIT_PICKER_CATEGORIES,
  ICON_SIZES,
  iconRegistry,
  iconsByCategory,
  resolveIcon,
} from '~/utils/icons'

describe('resolveIcon', () => {
  it('resolves a registry name to its outline class', () => {
    expect(resolveIcon('star')).toBe('i-lucide-star')
    expect(resolveIcon('plus')).toBe('i-lucide-plus')
    expect(resolveIcon('check')).toBe('i-lucide-check')
  })

  it('passes through raw i-* strings unchanged', () => {
    expect(resolveIcon('i-lucide-star')).toBe('i-lucide-star')
    expect(resolveIcon('i-lucide-heart')).toBe('i-lucide-heart')
    expect(resolveIcon('i-custom-logo')).toBe('i-custom-logo')
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

describe('iconRegistry keys are unique', () => {
  it('has no duplicate keys', () => {
    const keys = Object.keys(iconRegistry)
    const unique = new Set(keys)
    expect(keys.length).toBe(unique.size)
  })

  it('has no duplicate outline class values', () => {
    const outlines = Object.entries(iconRegistry).map(([name, def]) => ({ name, outline: def.outline }))
    const seen = new Map<string, string>()
    for (const { name, outline } of outlines) {
      const existing = seen.get(outline)
      if (existing) {
        expect.fail(`Duplicate outline class "${outline}" on keys "${existing}" and "${name}"`)
      }
      seen.set(outline, name)
    }
  })
})

describe('HABIT_PICKER_CATEGORIES', () => {
  it('every category key has matching icons in the registry', () => {
    const grouped = iconsByCategory()
    for (const cat of HABIT_PICKER_CATEGORIES) {
      const icons = grouped[cat.key]
      expect(icons, `category "${cat.key}" has no icons in registry`).toBeDefined()
      expect(icons.length, `category "${cat.key}" is empty`).toBeGreaterThan(0)
    }
  })

  it('has unique keys', () => {
    const keys = HABIT_PICKER_CATEGORIES.map((c) => c.key)
    expect(keys.length).toBe(new Set(keys).size)
  })

  it('has non-empty labels', () => {
    for (const cat of HABIT_PICKER_CATEGORIES) {
      expect(cat.label, `category "${cat.key}" label`).toBeTruthy()
    }
  })
})

describe('HABIT_COLORS', () => {
  it('all entries have valid hex values', () => {
    for (const color of HABIT_COLORS) {
      expect(color.value, `color "${color.label}"`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('has unique labels', () => {
    const labels = HABIT_COLORS.map((c) => c.label)
    expect(labels.length).toBe(new Set(labels).size)
  })

  it('has unique values', () => {
    const values = HABIT_COLORS.map((c) => c.value)
    expect(values.length).toBe(new Set(values).size)
  })
})

describe('new habit icon entries resolve correctly', () => {
  const habitKeys = [
    'barbell', 'running', 'cycling', 'heartbeat', 'trophy',
    'coffee', 'wine', 'leaf',
    'reading', 'brain', 'graduation', 'puzzle',
    'bed', 'flower-lotus', 'smiley',
    'briefcase', 'code', 'rocket', 'target',
    'guitar', 'music-notes', 'paint-brush', 'game-controller',
    'users', 'chat-circle', 'envelope',
    'piggy-bank', 'wallet', 'coin',
    'tree', 'mountains', 'dog',
  ]

  it('all resolve to i-lucide classes', () => {
    for (const key of habitKeys) {
      const resolved = resolveIcon(key)
      expect(resolved, `${key} should resolve to an icon class`).toMatch(/^i-lucide-/)
    }
  })
})
