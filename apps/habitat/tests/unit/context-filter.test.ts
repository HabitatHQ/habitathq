import { describe, it, expect, vi, beforeAll } from 'vitest'
import { ref, computed, readonly } from 'vue'

/**
 * Tests for useContextFilter.
 *
 * Nuxt's useState is a global auto-import not available in Vitest.
 * We stub it with a plain Vue ref so the composable's state wiring works
 * without a Nuxt runtime.  The stub matches the real signature:
 *   useState<T>(key, init) → Ref<T>
 */
beforeAll(() => {
  vi.stubGlobal('useState', <T>(_key: string, init: () => T) => ref(init()))
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('readonly', readonly)
})

import { useContextFilter } from '~/composables/useContextFilter'

// Each test gets a fresh composable instance (fresh refs via the stub).
function fresh() {
  return useContextFilter()
}

// ── matchesContext ─────────────────────────────────────────────────────────────

describe('matchesContext', () => {
  it('returns true when no filter is active (pass-through)', () => {
    const { matchesContext } = fresh()
    expect(matchesContext(['work', 'personal'])).toBe(true)
    expect(matchesContext([])).toBe(true)
  })

  it('returns true when one active context matches an item tag', () => {
    const { toggleContext, matchesContext } = fresh()
    toggleContext('work')
    expect(matchesContext(['work', 'personal'])).toBe(true)
  })

  it('returns false when no active context matches any item tag', () => {
    const { toggleContext, matchesContext } = fresh()
    toggleContext('health')
    expect(matchesContext(['work', 'personal'])).toBe(false)
  })

  it('returns false for an item with no tags when filter is active', () => {
    const { toggleContext, matchesContext } = fresh()
    toggleContext('work')
    expect(matchesContext([])).toBe(false)
  })

  it('matches any of multiple active contexts — union semantics', () => {
    const { toggleContext, matchesContext } = fresh()
    toggleContext('health')
    toggleContext('work')
    expect(matchesContext(['work'])).toBe(true)
    expect(matchesContext(['health'])).toBe(true)
    expect(matchesContext(['personal'])).toBe(false)
  })

  it('is case-sensitive', () => {
    const { toggleContext, matchesContext } = fresh()
    toggleContext('Work')
    expect(matchesContext(['work'])).toBe(false)
  })
})

// ── isActive ──────────────────────────────────────────────────────────────────

describe('isActive', () => {
  it('returns false when tag is not in the active list', () => {
    const { toggleContext, isActive } = fresh()
    toggleContext('work')
    expect(isActive('personal')).toBe(false)
  })

  it('returns true when tag is in the active list', () => {
    const { toggleContext, isActive } = fresh()
    toggleContext('work')
    toggleContext('personal')
    expect(isActive('personal')).toBe(true)
  })

  it('returns false on an empty active list', () => {
    const { isActive } = fresh()
    expect(isActive('work')).toBe(false)
  })
})

// ── toggleContext ─────────────────────────────────────────────────────────────

describe('toggleContext', () => {
  it('adds a tag when it is not in the active list', () => {
    const { toggleContext, activeContexts } = fresh()
    toggleContext('work')
    expect(activeContexts.value).toEqual(['work'])
    toggleContext('personal')
    expect(activeContexts.value).toEqual(['work', 'personal'])
  })

  it('removes a tag when it is already in the active list', () => {
    const { toggleContext, activeContexts } = fresh()
    toggleContext('work')
    toggleContext('personal')
    toggleContext('work')
    expect(activeContexts.value).toEqual(['personal'])
  })
})

// ── clearAll ──────────────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('empties the active contexts list', () => {
    const { toggleContext, clearAll, activeContexts } = fresh()
    toggleContext('work')
    toggleContext('personal')
    clearAll()
    expect(activeContexts.value).toEqual([])
  })

  it('anyActive is false after clearAll', () => {
    const { toggleContext, clearAll, anyActive } = fresh()
    toggleContext('work')
    clearAll()
    expect(anyActive.value).toBe(false)
  })
})

// ── anyActive ─────────────────────────────────────────────────────────────────

describe('anyActive', () => {
  it('is false when nothing is toggled', () => {
    const { anyActive } = fresh()
    expect(anyActive.value).toBe(false)
  })

  it('is true after a tag is toggled', () => {
    const { toggleContext, anyActive } = fresh()
    toggleContext('work')
    expect(anyActive.value).toBe(true)
  })
})

// ── loadContextTags ────────────────────────────────────────────────────────────

describe('loadContextTags', () => {
  it('calls getContextTags and populates contextTags', async () => {
    const { loadContextTags, contextTags } = fresh()
    const mockDb = { getContextTags: async () => ['work', 'fitness', 'learning'] }
    await loadContextTags(mockDb)
    expect(contextTags.value).toEqual(['work', 'fitness', 'learning'])
  })

  it('skips calling db when already loaded', async () => {
    const { loadContextTags } = fresh()
    let callCount = 0
    const mockDb = {
      getContextTags: async () => {
        callCount++
        return ['work']
      },
    }
    await loadContextTags(mockDb)
    await loadContextTags(mockDb)
    expect(callCount).toBe(1)
  })
})
