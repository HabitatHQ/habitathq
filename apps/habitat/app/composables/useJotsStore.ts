import type { Scribble, Todo } from '~/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoiceNote {
  id: string
  blob: Blob
  mimeType: string
  duration: number
  created_at: string
  url?: string
}

export interface ImageNote {
  id: string
  blob: Blob
  mimeType: string
  filename: string
  created_at: string
  url?: string
}

export type JotItem =
  | { kind: 'text'; data: Scribble }
  | { kind: 'voice'; data: VoiceNote }
  | { kind: 'image'; data: ImageNote }

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const IDB_NAME = 'habitat'
const VOICE_STORE = 'voice_notes'
const IMAGE_STORE = 'image_notes'
let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 2)
    req.onupgradeneeded = (e) => {
      const db = req.result
      if (e.oldVersion < 1) db.createObjectStore(VOICE_STORE, { keyPath: 'id' })
      if (e.oldVersion < 2) db.createObjectStore(IMAGE_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      _db = req.result
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

export async function idbPut(store: string, value: object): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbDelete(store: string, id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export { IMAGE_STORE, VOICE_STORE }

// ─── Composable ───────────────────────────────────────────────────────────────

export function useJotsStore() {
  const db = useDatabase()

  const scribbles = useState<Scribble[]>('jots-scribbles', () => [])
  const voiceNotes = useState<VoiceNote[]>('jots-voice', () => [])
  const imageNotes = useState<ImageNote[]>('jots-images', () => [])
  const todos = useState<Todo[]>('jots-todos', () => [])

  const timeline = computed((): JotItem[] => {
    const items: JotItem[] = [
      ...scribbles.value.map((d) => ({ kind: 'text' as const, data: d })),
      ...voiceNotes.value.map((d) => ({ kind: 'voice' as const, data: d })),
      ...imageNotes.value.map((d) => ({ kind: 'image' as const, data: d })),
    ]
    return items.sort((a, b) => {
      const dateA = a.kind === 'text' ? a.data.updated_at : a.data.created_at
      const dateB = b.kind === 'text' ? b.data.updated_at : b.data.created_at
      return dateB.localeCompare(dateA)
    })
  })

  const todoByJotId = computed(() => {
    const map = new Map<string, Todo>()
    for (const t of todos.value) {
      if (t.archived_at) continue
      const jotId = t.annotations['linked_jot_id']
      if (jotId) map.set(jotId, t)
    }
    return map
  })

  async function loadAll() {
    ;[scribbles.value, todos.value] = await Promise.all([db.getScribbles(), db.getTodos()])
    const storedVoice = await idbGetAll<Omit<VoiceNote, 'url'>>(VOICE_STORE)
    storedVoice.sort((a, b) => b.created_at.localeCompare(a.created_at))
    voiceNotes.value = storedVoice.map((n) => ({ ...n, url: URL.createObjectURL(n.blob) }))
    const storedImages = await idbGetAll<Omit<ImageNote, 'url'>>(IMAGE_STORE)
    storedImages.sort((a, b) => b.created_at.localeCompare(a.created_at))
    imageNotes.value = storedImages.map((n) => ({ ...n, url: URL.createObjectURL(n.blob) }))
  }

  async function refreshScribbles() {
    scribbles.value = await db.getScribbles()
  }

  async function addVoiceNote(note: Omit<VoiceNote, 'url'>): Promise<void> {
    await idbPut(VOICE_STORE, note)
    voiceNotes.value.unshift({ ...note, url: URL.createObjectURL(note.blob) })
  }

  async function deleteVoiceNote(note: VoiceNote): Promise<void> {
    if (note.url) URL.revokeObjectURL(note.url)
    await idbDelete(VOICE_STORE, note.id)
    voiceNotes.value = voiceNotes.value.filter((n) => n.id !== note.id)
  }

  async function addImageNote(note: Omit<ImageNote, 'url'>, objectUrl: string): Promise<void> {
    await idbPut(IMAGE_STORE, note)
    imageNotes.value.unshift({ ...note, url: objectUrl })
  }

  async function deleteImageNote(note: ImageNote): Promise<void> {
    if (note.url) URL.revokeObjectURL(note.url)
    await idbDelete(IMAGE_STORE, note.id)
    imageNotes.value = imageNotes.value.filter((n) => n.id !== note.id)
  }

  function revokeAllUrls() {
    voiceNotes.value.forEach((n) => {
      if (n.url) URL.revokeObjectURL(n.url)
    })
    imageNotes.value.forEach((n) => {
      if (n.url) URL.revokeObjectURL(n.url)
    })
  }

  return {
    db,
    scribbles,
    voiceNotes,
    imageNotes,
    todos,
    timeline,
    todoByJotId,
    loadAll,
    refreshScribbles,
    addVoiceNote,
    deleteVoiceNote,
    addImageNote,
    deleteImageNote,
    revokeAllUrls,
  }
}
