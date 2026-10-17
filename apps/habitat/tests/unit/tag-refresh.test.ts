import { ref, type Ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useTagSuggestions } from '~/composables/useTagSuggestions'
import type { TagRow } from '~/types/database'

afterEach(() => vi.unstubAllGlobals())

it('refreshes cached suggestions after a database invalidation', async () => {
  const state = new Map<string, Ref<unknown>>()
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!state.has(key)) state.set(key, ref(init()))
    return state.get(key)
  })
  let rows: TagRow[] = [{ tag: 'old-tag', source: 'todo', count: 1 }]
  let refresh: (() => Promise<void>) | undefined
  vi.stubGlobal('useDatabase', (callback: () => Promise<void>) => {
    refresh = callback
    return { getAllTags: async () => rows }
  })
  const tags = useTagSuggestions('todo')
  await tags.loadTags()
  expect(tags.allUserTags.value).toEqual(['old-tag'])
  rows = [{ tag: 'synced-tag', source: 'todo', count: 1 }]
  await refresh?.()
  expect(tags.allUserTags.value).toEqual(['synced-tag'])
})
