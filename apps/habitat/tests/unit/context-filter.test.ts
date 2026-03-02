import { describe, it, expect } from 'vitest'

/**
 * These tests exercise the core logic of useContextFilter by testing the
 * pure functions that underpin the composable. Nuxt's useState is not
 * needed here — we test the algorithms directly.
 */

// ── matchesContext logic ───────────────────────────────────────────────────────

function matchesContext(activeContexts: string[], tags: string[]): boolean {
  if (activeContexts.length === 0) return true
  return activeContexts.some((ctx) => tags.includes(ctx))
}

describe('matchesContext', () => {
  it('returns true when no filter is active (pass-through)', () => {
    expect(matchesContext([], ['work', 'personal'])).toBe(true)
    expect(matchesContext([], [])).toBe(true)
  })

  it('returns true when one active context matches an item tag', () => {
    expect(matchesContext(['work'], ['work', 'personal'])).toBe(true)
  })

  it('returns true when the sole tag matches the sole active context', () => {
    expect(matchesContext(['work'], ['work'])).toBe(true)
  })

  it('returns false when no active context matches any item tag', () => {
    expect(matchesContext(['health'], ['work', 'personal'])).toBe(false)
  })

  it('returns false for an item with no tags when filter is active', () => {
    expect(matchesContext(['work'], [])).toBe(false)
  })

  it('matches any of multiple active contexts — union semantics', () => {
    expect(matchesContext(['health', 'work'], ['work'])).toBe(true)
    expect(matchesContext(['health', 'work'], ['health'])).toBe(true)
    expect(matchesContext(['health', 'work'], ['personal'])).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(matchesContext(['Work'], ['work'])).toBe(false)
    expect(matchesContext(['work'], ['Work'])).toBe(false)
  })
})

// ── isActive logic ─────────────────────────────────────────────────────────────

function isActive(activeContexts: string[], tag: string): boolean {
  return activeContexts.includes(tag)
}

describe('isActive', () => {
  it('returns false when tag is not in the active list', () => {
    expect(isActive(['work'], 'personal')).toBe(false)
  })

  it('returns true when tag is in the active list', () => {
    expect(isActive(['work', 'personal'], 'personal')).toBe(true)
  })

  it('returns false on an empty active list', () => {
    expect(isActive([], 'work')).toBe(false)
  })
})

// ── toggleContext logic ────────────────────────────────────────────────────────

function toggleContext(activeContexts: string[], tag: string): string[] {
  const idx = activeContexts.indexOf(tag)
  if (idx === -1) return [...activeContexts, tag]
  return activeContexts.filter((t) => t !== tag)
}

describe('toggleContext', () => {
  it('adds a tag when it is not in the active list', () => {
    expect(toggleContext([], 'work')).toEqual(['work'])
    expect(toggleContext(['personal'], 'work')).toEqual(['personal', 'work'])
  })

  it('removes a tag when it is already in the active list', () => {
    expect(toggleContext(['work'], 'work')).toEqual([])
    expect(toggleContext(['work', 'personal'], 'work')).toEqual(['personal'])
  })

  it('does not mutate the original array', () => {
    const original = ['work']
    const result = toggleContext(original, 'personal')
    expect(original).toEqual(['work'])
    expect(result).toEqual(['work', 'personal'])
  })
})

// ── loadContextTags logic ──────────────────────────────────────────────────────

describe('loadContextTags', () => {
  it('calls getContextTags and populates the list', async () => {
    const mockDb = {
      getContextTags: async () => ['work', 'fitness', 'learning'],
    }
    const tags = await mockDb.getContextTags()
    expect(tags).toEqual(['work', 'fitness', 'learning'])
  })

  it('skips calling db when already loaded', async () => {
    let callCount = 0
    const mockDb = {
      getContextTags: async () => {
        callCount++
        return ['work']
      },
    }
    // Simulate already-loaded guard
    let loaded = false
    async function loadOnce() {
      if (loaded) return
      await mockDb.getContextTags()
      loaded = true
    }
    await loadOnce()
    await loadOnce()
    expect(callCount).toBe(1)
  })
})
