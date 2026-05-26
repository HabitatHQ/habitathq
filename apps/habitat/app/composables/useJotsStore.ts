import { IDBBlobAdapter } from '@palladium/core'
import type { ImageNoteRow, Scribble, Todo, VoiceNoteRow } from '~/types/database'

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

// ─── Blob adapter (main-thread IDB for binary data) ──────────────────────────

let _blobAdapter: IDBBlobAdapter | null = null

export function getBlobAdapter(): IDBBlobAdapter {
  if (!_blobAdapter) _blobAdapter = new IDBBlobAdapter('habitat-blobs')
  return _blobAdapter
}

// ─── Legacy IDB migration helpers ────────────────────────────────────────────

const MIGRATION_KEY = 'habitat:blobs-migrated'

interface LegacyVoiceRecord {
  id: string
  blob: Blob
  mimeType: string
  duration: number
  created_at: string
}

interface LegacyImageRecord {
  id: string
  blob: Blob
  mimeType: string
  filename: string
  created_at: string
}

async function legacyIdbExists(dbName: string): Promise<boolean> {
  if (typeof indexedDB.databases === 'function') {
    const dbs = await indexedDB.databases()
    return dbs.some((d) => d.name === dbName)
  }
  // Firefox <126 lacks databases(); fall through to open-based check
  return true
}

function legacyIdbGetAll<T>(dbName: string, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 2)
    req.onupgradeneeded = (e) => {
      if (e.oldVersion === 0) {
        // DB didn't exist before this open — abort to avoid creating an orphan
        req.result.close()
        req.transaction?.abort()
        resolve([])
        return
      }
      const db = req.result
      if (e.oldVersion < 1 && !db.objectStoreNames.contains('voice_notes'))
        db.createObjectStore('voice_notes', { keyPath: 'id' })
      if (e.oldVersion < 2 && !db.objectStoreNames.contains('image_notes'))
        db.createObjectStore('image_notes', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.close()
        resolve([])
        return
      }
      const tx = db.transaction(storeName, 'readonly')
      const getAll = tx.objectStore(storeName).getAll()
      getAll.onsuccess = () => {
        db.close()
        resolve(getAll.result as T[])
      }
      getAll.onerror = () => {
        db.close()
        reject(getAll.error)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

async function runBlobMigration(db: ReturnType<typeof useDatabase>): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(MIGRATION_KEY) === '1') return

  // Skip migration entirely for fresh users who never had the legacy IDB
  if (!(await legacyIdbExists('habitat'))) {
    localStorage.setItem(MIGRATION_KEY, '1')
    return
  }

  const voices = await legacyIdbGetAll<LegacyVoiceRecord>('habitat', 'voice_notes')
  const images = await legacyIdbGetAll<LegacyImageRecord>('habitat', 'image_notes')

  if (voices.length === 0 && images.length === 0) {
    localStorage.setItem(MIGRATION_KEY, '1')
    indexedDB.deleteDatabase('habitat')
    return
  }

  for (const v of voices) {
    const bytes = new Uint8Array(await v.blob.arrayBuffer())
    await getBlobAdapter().put(v.id, bytes)
    await db.createVoiceNote({
      id: v.id,
      mime_type: v.mimeType,
      duration: v.duration,
      created_at: v.created_at,
    })
  }

  for (const img of images) {
    const bytes = new Uint8Array(await img.blob.arrayBuffer())
    await getBlobAdapter().put(img.id, bytes)
    await db.createImageNote({
      id: img.id,
      mime_type: img.mimeType,
      filename: img.filename,
      created_at: img.created_at,
    })
  }

  localStorage.setItem(MIGRATION_KEY, '1')
  indexedDB.deleteDatabase('habitat')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hydrateVoice(row: VoiceNoteRow): Promise<VoiceNote> {
  const bytes = await getBlobAdapter().get(row.id)
  const blob = bytes ? new Blob([bytes.slice()], { type: row.mime_type }) : new Blob()
  return {
    id: row.id,
    blob,
    mimeType: row.mime_type,
    duration: row.duration,
    created_at: row.created_at,
    url: URL.createObjectURL(blob),
  }
}

async function hydrateImage(row: ImageNoteRow): Promise<ImageNote> {
  const bytes = await getBlobAdapter().get(row.id)
  const blob = bytes ? new Blob([bytes.slice()], { type: row.mime_type }) : new Blob()
  return {
    id: row.id,
    blob,
    mimeType: row.mime_type,
    filename: row.filename,
    created_at: row.created_at,
    url: URL.createObjectURL(blob),
  }
}

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
    await runBlobMigration(db)
    ;[scribbles.value, todos.value] = await Promise.all([db.getScribbles(), db.getTodos()])

    const [voiceRows, imageRows] = await Promise.all([db.getVoiceNotes(), db.getImageNotes()])
    voiceNotes.value = await Promise.all(voiceRows.map(hydrateVoice))
    imageNotes.value = await Promise.all(imageRows.map(hydrateImage))
  }

  async function refreshScribbles() {
    scribbles.value = await db.getScribbles()
  }

  async function addVoiceNote(note: Omit<VoiceNote, 'url'>): Promise<void> {
    const bytes = new Uint8Array(await note.blob.arrayBuffer())
    await getBlobAdapter().put(note.id, bytes)
    await db.createVoiceNote({
      id: note.id,
      mime_type: note.mimeType,
      duration: note.duration,
      created_at: note.created_at,
    })
    voiceNotes.value.unshift({ ...note, url: URL.createObjectURL(note.blob) })
  }

  async function deleteVoiceNote(note: VoiceNote): Promise<void> {
    if (note.url) URL.revokeObjectURL(note.url)
    await getBlobAdapter().delete(note.id)
    await db.deleteVoiceNote(note.id)
    voiceNotes.value = voiceNotes.value.filter((n) => n.id !== note.id)
  }

  async function addImageNote(note: Omit<ImageNote, 'url'>, objectUrl: string): Promise<void> {
    const bytes = new Uint8Array(await note.blob.arrayBuffer())
    await getBlobAdapter().put(note.id, bytes)
    await db.createImageNote({
      id: note.id,
      mime_type: note.mimeType,
      filename: note.filename,
      created_at: note.created_at,
    })
    imageNotes.value.unshift({ ...note, url: objectUrl })
  }

  async function deleteImageNote(note: ImageNote): Promise<void> {
    if (note.url) URL.revokeObjectURL(note.url)
    await getBlobAdapter().delete(note.id)
    await db.deleteImageNote(note.id)
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
