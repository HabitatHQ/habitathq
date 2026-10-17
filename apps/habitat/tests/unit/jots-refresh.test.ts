import { ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMediaStore, useJotsStore } from '~/composables/useJotsStore'
import type { VoiceNoteRow } from '~/types/database'

vi.mock('@palladium/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@palladium/core')>()
  return { ...core, IDBBlobAdapter: core.MemoryBlobAdapter }
})

const voice: VoiceNoteRow = {
  id: 'voice-refresh',
  title: 'An idea',
  mime_type: 'audio/webm',
  duration: 10,
  created_at: '2026-10-17T08:00:00Z',
}
let voices: VoiceNoteRow[]
let refresh: () => Promise<void>
const database = {
  getScribbles: async () => [],
  getTodos: async () => [],
  getVoiceNotes: async () => voices,
  getImageNotes: async () => [],
  createVoiceNote: vi.fn(),
}

describe('Jots live refresh', () => {
  beforeEach(() => {
    voices = [voice]
    const state = new Map<string, Ref<unknown>>()
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!state.has(key)) state.set(key, ref(init()))
      return state.get(key)
    })
    vi.stubGlobal('useDatabase', (callback: () => Promise<void>) => {
      refresh = callback
      return database
    })
    vi.stubGlobal('localStorage', { getItem: () => '1' })
    let nextUrl = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++nextUrl}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('preserves media URLs across refreshes and revokes them only when removed', async () => {
    const store = useJotsStore()
    await getMediaStore().put(voice.id, new Uint8Array([1, 2]))
    await store.loadAll()
    const url = store.voiceNotes.value[0]!.url
    voices = [{ ...voice, title: 'Renamed remotely' }]
    await refresh()
    expect(store.voiceNotes.value[0]!.url).toBe(url)
    expect(store.voiceNotes.value[0]!.title).toBe('Renamed remotely')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    voices = []
    await refresh()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })

  it('does not invent a playable URL for metadata whose media is missing locally', async () => {
    const store = useJotsStore()
    await getMediaStore().delete(voice.id)
    await store.loadAll()
    expect(store.voiceNotes.value[0]!.url).toBeUndefined()
  })

  it('keeps a saved recording unique when invalidation finishes before its save response', async () => {
    const store = useJotsStore()
    voices = []
    database.createVoiceNote.mockImplementationOnce(async (row: VoiceNoteRow) => {
      voices = [row]
      await refresh()
    })
    await store.addVoiceNote({
      id: voice.id,
      title: voice.title,
      blob: new Blob(['audio']),
      mimeType: voice.mime_type,
      duration: voice.duration,
      created_at: voice.created_at,
    })
    expect(store.voiceNotes.value.map((note) => note.id)).toEqual([voice.id])
  })

  it('does not let an older load overwrite a newer refresh from another mounted sheet', async () => {
    const firstStore = useJotsStore()
    const secondStore = useJotsStore()
    let release!: () => void
    let reached!: () => void
    const reachedRead = new Promise<void>((resolve) => {
      reached = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(database, 'getVoiceNotes').mockImplementationOnce(async () => {
      const snapshot = [...voices]
      reached()
      await gate
      return snapshot
    })
    const older = firstStore.loadAll()
    await reachedRead
    voices = [{ ...voice, title: 'The latest title' }]
    const newer = secondStore.loadAll()
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await Promise.all([older, newer])
    expect(firstStore.voiceNotes.value[0]!.title).toBe('The latest title')
    expect(secondStore.voiceNotes.value[0]!.title).toBe('The latest title')
  })
})
