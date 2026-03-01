<script setup lang="ts">
import { formatTime } from '~/composables/useAppSettings'
import type { Scribble } from '~/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VoiceNote {
  id: string
  blob: Blob
  mimeType: string
  duration: number // seconds at stop time
  created_at: string
  url?: string // revocable object URL, created on load
}

interface ImageNote {
  id: string
  blob: Blob
  mimeType: string
  filename: string
  created_at: string
  url?: string // revocable object URL, created on load
}

type JotItem =
  | { kind: 'text'; data: Scribble }
  | { kind: 'voice'; data: VoiceNote }
  | { kind: 'image'; data: ImageNote }

// ─── IndexedDB ────────────────────────────────────────────────────────────────

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

async function idbPut(store: string, value: object): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(store: string, id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ─── Speech Recognition types ─────────────────────────────────────────────────

interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly 0: { transcript: string }
}
interface SpeechRecognitionResultList {
  readonly length: number
  [i: number]: SpeechRecognitionResult | undefined
}
interface SpeechRecognitionResultEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvt extends Event {
  readonly error: string
}
interface SpeechRecognizer extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: SpeechRecognitionErrorEvt) => void) | null
  start(): void
  stop(): void
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognizer
    webkitSpeechRecognition: new () => SpeechRecognizer
  }
}

// ─── App composables ──────────────────────────────────────────────────────────

const dbComposable = useDatabase()
const { settings: appSettings } = useAppSettings()

// ─── Speech Recognition ───────────────────────────────────────────────────────

const SpeechRecognitionAPI: (() => SpeechRecognizer) | null = import.meta.client
  ? window.SpeechRecognition
    ? () => new window.SpeechRecognition()
    : window.webkitSpeechRecognition
      ? () => new window.webkitSpeechRecognition()
      : null
  : null
const speechSupported = SpeechRecognitionAPI !== null

let recognition: SpeechRecognizer | null = null
const interimTranscript = ref('')
const finalTranscript = ref('')

// ─── Modal state ──────────────────────────────────────────────────────────────

type ModalKind = 'picker' | 'text' | 'record' | 'image' | 'transcript' | null
const activeModal = ref<ModalKind>(null)

function closeModal() {
  activeModal.value = null
}

// ─── Timeline state ───────────────────────────────────────────────────────────

const scribbles = ref<Scribble[]>([])
const voiceNotes = ref<VoiceNote[]>([])
const imageNotes = ref<ImageNote[]>([])

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

// ─── Text modal ───────────────────────────────────────────────────────────────

const textSaving = ref(false)
const textEditing = ref<Scribble | null>(null)
const textForm = reactive({
  title: '',
  content: '',
  tags: [] as string[],
  annotations: {} as Record<string, string>,
})
const tagInput = ref('')
const annotExpanded = ref(false)
const newAnnotKey = ref('')
const newAnnotVal = ref('')

const annotationCount = computed(() => Object.keys(textForm.annotations).length)
const canSaveText = computed(
  () => textForm.title.trim().length > 0 || textForm.content.trim().length > 0,
)

function splitTag(tag: string): { parent: string | null; leaf: string } {
  const idx = tag.lastIndexOf('/')
  return idx === -1
    ? { parent: null, leaf: tag }
    : { parent: tag.slice(0, idx), leaf: tag.slice(idx + 1) }
}

function commitTag() {
  const t = tagInput.value.replace(/,+$/, '').trim()
  if (t && !t.startsWith('habitat-') && !textForm.tags.includes(t)) textForm.tags.push(t)
  tagInput.value = ''
}

function onTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    commitTag()
  }
}

function removeTag(tag: string) {
  textForm.tags = textForm.tags.filter((t) => t !== tag)
}

function commitAnnot() {
  if (!newAnnotKey.value.trim() || !newAnnotVal.value.trim()) return
  textForm.annotations[newAnnotKey.value.trim()] = newAnnotVal.value.trim()
  newAnnotKey.value = ''
  newAnnotVal.value = ''
}

function removeAnnot(key: string) {
  delete textForm.annotations[key]
}

function openNewText() {
  textEditing.value = null
  textForm.title = ''
  textForm.content = ''
  textForm.tags = []
  textForm.annotations = {}
  tagInput.value = ''
  annotExpanded.value = false
  newAnnotKey.value = ''
  newAnnotVal.value = ''
  activeModal.value = 'text'
}

function openEditText(s: Scribble) {
  textEditing.value = s
  textForm.title = s.title
  textForm.content = s.content
  textForm.tags = [...s.tags]
  textForm.annotations = { ...s.annotations }
  tagInput.value = ''
  annotExpanded.value = false
  newAnnotKey.value = ''
  newAnnotVal.value = ''
  activeModal.value = 'text'
}

async function saveText() {
  if (!dbComposable.isAvailable || textSaving.value) return
  textSaving.value = true
  try {
    if (textEditing.value) {
      await dbComposable.updateScribble({
        id: textEditing.value.id,
        title: textForm.title,
        content: textForm.content,
        tags: [...textForm.tags],
        annotations: { ...textForm.annotations },
      })
    } else {
      await dbComposable.createScribble({
        title: textForm.title,
        content: textForm.content,
        tags: [...textForm.tags],
        annotations: { ...textForm.annotations },
      })
    }
    scribbles.value = await dbComposable.getScribbles()
    closeModal()
  } finally {
    textSaving.value = false
  }
}

async function deleteText() {
  if (!dbComposable.isAvailable || !textEditing.value) return
  await dbComposable.deleteScribble(textEditing.value.id)
  scribbles.value = await dbComposable.getScribbles()
  closeModal()
}

// ─── Voice recording ──────────────────────────────────────────────────────────

const recording = ref(false)
const recordingSeconds = ref(0)
const errorMsg = ref<string | null>(null)
const currentlyPlaying = ref<string | null>(null)
const transcriptionPending = ref(false)
const transcribingExistingId = ref<string | null>(null)

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
let recordingTimer: ReturnType<typeof setInterval> | null = null
let pendingNoteId: string | null = null
const audioMap = new Map<string, HTMLAudioElement>()

function buildRecognition(onDone?: () => void): SpeechRecognizer {
  if (!SpeechRecognitionAPI) throw new Error('SpeechRecognition not supported')
  const r = SpeechRecognitionAPI()
  r.continuous = true
  r.interimResults = true
  r.lang = navigator.language || 'en-US'

  r.onresult = (event: SpeechRecognitionResultEvent) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      if (!result) continue
      if (result.isFinal) {
        finalTranscript.value += result[0].transcript
      } else {
        interim += result[0].transcript
      }
    }
    interimTranscript.value = interim
  }

  r.onend = () => {
    interimTranscript.value = ''
    if (recognition === r) {
      if (recording.value) {
        try {
          r.start()
        } catch {
          /* already started */
        }
      } else {
        recognition = null
        onDone?.()
      }
    }
  }

  r.onerror = (event: SpeechRecognitionErrorEvt) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      errorMsg.value = `Speech recognition error: ${event.error}`
    }
  }

  return r
}

function startRecognition(onDone?: () => void): void {
  if (!SpeechRecognitionAPI) return
  finalTranscript.value = ''
  interimTranscript.value = ''
  recognition = buildRecognition(onDone)
  try {
    recognition.start()
  } catch {
    recognition = null
  }
}

function stopRecognitionCapture(): void {
  if (!recognition) return
  const r = recognition
  recognition = null
  transcriptionPending.value = false
  try {
    r.stop()
  } catch {
    /* ignore */
  }
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  const time = formatTime(d, appSettings.value.use24HourTime)
  if (sameDay(d, today)) return `Today, ${time}`
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`
  return (
    new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d) + `, ${time}`
  )
}

async function startRecording() {
  errorMsg.value = null
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    errorMsg.value = 'Microphone access denied. Please allow access in your browser settings.'
    return
  }

  chunks = []
  const mimeType = pickMimeType()
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop())
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
    const note: Omit<VoiceNote, 'url'> = {
      id: crypto.randomUUID(),
      blob,
      mimeType: mimeType || 'audio/webm',
      duration: recordingSeconds.value,
      created_at: new Date().toISOString(),
    }
    await idbPut(VOICE_STORE, note)
    voiceNotes.value.unshift({ ...note, url: URL.createObjectURL(blob) })
    recordingSeconds.value = 0
    pendingNoteId = note.id

    if (speechSupported && recognition) {
      // Recognition still finishing — show pending state; onDone will open the modal
      transcriptionPending.value = true
    } else {
      if (appSettings.value.saveTranscribedNotes && finalTranscript.value.trim()) {
        openTranscriptModal(note.id)
      } else {
        finalTranscript.value = ''
        closeModal()
      }
      pendingNoteId = null
    }
  }
  mediaRecorder.start(100)
  recording.value = true
  recordingTimer = setInterval(() => {
    recordingSeconds.value++
  }, 1000)

  if (speechSupported) {
    startRecognition(() => {
      transcriptionPending.value = false
      if (appSettings.value.saveTranscribedNotes && finalTranscript.value.trim()) {
        openTranscriptModal(pendingNoteId)
      } else {
        finalTranscript.value = ''
        if (activeModal.value === 'record') closeModal()
      }
      pendingNoteId = null
    })
  }
}

function stopRecording() {
  // Signal recognition to stop but keep the reference so its onend fires onDone.
  if (recognition) {
    try {
      recognition.stop()
    } catch {
      /* ignore */
    }
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  recording.value = false
  if (recordingTimer) {
    clearInterval(recordingTimer)
    recordingTimer = null
  }
}

function toggleRecording() {
  recording.value ? stopRecording() : startRecording()
}

function togglePlay(note: VoiceNote) {
  if (!note.url) return
  if (currentlyPlaying.value && currentlyPlaying.value !== note.id) {
    audioMap.get(currentlyPlaying.value)?.pause()
    currentlyPlaying.value = null
  }
  let audio = audioMap.get(note.id)
  if (!audio) {
    audio = new Audio(note.url)
    audio.onended = () => {
      currentlyPlaying.value = null
    }
    audioMap.set(note.id, audio)
  }
  if (currentlyPlaying.value === note.id) {
    audio.pause()
    currentlyPlaying.value = null
  } else {
    audio.play()
    currentlyPlaying.value = note.id
  }
}

async function transcribeNote(note: VoiceNote) {
  if (!speechSupported || !note.url) return
  if (transcribingExistingId.value) return

  if (currentlyPlaying.value) {
    audioMap.get(currentlyPlaying.value)?.pause()
    currentlyPlaying.value = null
  }

  transcribingExistingId.value = note.id
  errorMsg.value = null
  finalTranscript.value = ''
  interimTranscript.value = ''

  const audio = new Audio(note.url)
  audioMap.set(note.id, audio)

  audio.onended = () => {
    stopRecognitionCapture()
    currentlyPlaying.value = null
    transcribingExistingId.value = null
    if (finalTranscript.value.trim()) {
      openTranscriptModal(note.id)
    } else {
      errorMsg.value = 'No speech detected in this recording.'
      finalTranscript.value = ''
    }
  }

  startRecognition()
  audio.play()
  currentlyPlaying.value = note.id
}

async function deleteVoiceNote(note: VoiceNote) {
  const audio = audioMap.get(note.id)
  if (audio) {
    audio.pause()
    audioMap.delete(note.id)
  }
  if (currentlyPlaying.value === note.id) currentlyPlaying.value = null
  if (transcribingExistingId.value === note.id) {
    stopRecognitionCapture()
    transcribingExistingId.value = null
  }
  if (note.url) URL.revokeObjectURL(note.url)
  await idbDelete(VOICE_STORE, note.id)
  voiceNotes.value = voiceNotes.value.filter((n) => n.id !== note.id)
}

// ─── Transcript modal ─────────────────────────────────────────────────────────

const transcriptTitle = ref('')
const transcriptText = ref('')
const savingTranscript = ref(false)
const transcribingNoteId = ref<string | null>(null)
const deleteAfterTranscribe = ref(false)

function openTranscriptModal(noteId: string | null = null) {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = formatTime(now, appSettings.value.use24HourTime)
  transcriptTitle.value = `Voice note — ${date}, ${time}`
  transcriptText.value = finalTranscript.value
  transcribingNoteId.value = noteId
  deleteAfterTranscribe.value = false
  activeModal.value = 'transcript'
}

function closeTranscriptModal() {
  finalTranscript.value = ''
  interimTranscript.value = ''
  transcribingNoteId.value = null
  activeModal.value = null
}

async function saveTranscript() {
  if (!dbComposable.isAvailable) return
  savingTranscript.value = true
  try {
    await dbComposable.createScribble({
      title: transcriptTitle.value.trim() || 'Voice note',
      content: transcriptText.value,
      tags: ['habitat-transcribed'],
      annotations: {},
    })
    if (transcribingNoteId.value && deleteAfterTranscribe.value) {
      const note = voiceNotes.value.find((n) => n.id === transcribingNoteId.value)
      if (note) await deleteVoiceNote(note)
    }
    scribbles.value = await dbComposable.getScribbles()
    closeTranscriptModal()
  } finally {
    savingTranscript.value = false
  }
}

// ─── Image notes ──────────────────────────────────────────────────────────────

const imagePreviewing = ref<{ blob: Blob; url: string; filename: string; mimeType: string } | null>(
  null,
)

function handleFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (imagePreviewing.value) URL.revokeObjectURL(imagePreviewing.value.url)
  imagePreviewing.value = {
    blob: file,
    url: URL.createObjectURL(file),
    filename: file.name,
    mimeType: file.type,
  }
  // Reset input so same file can be re-picked
  input.value = ''
}

async function saveImage() {
  if (!imagePreviewing.value) return
  const { blob, url, filename, mimeType } = imagePreviewing.value
  const note: Omit<ImageNote, 'url'> = {
    id: crypto.randomUUID(),
    blob,
    mimeType,
    filename,
    created_at: new Date().toISOString(),
  }
  await idbPut(IMAGE_STORE, note)
  imageNotes.value.unshift({ ...note, url })
  imagePreviewing.value = null
  closeModal()
}

function cancelImagePreview() {
  if (imagePreviewing.value) {
    URL.revokeObjectURL(imagePreviewing.value.url)
    imagePreviewing.value = null
  }
}

async function deleteImageNote(note: ImageNote) {
  if (note.url) URL.revokeObjectURL(note.url)
  await idbDelete(IMAGE_STORE, note.id)
  imageNotes.value = imageNotes.value.filter((n) => n.id !== note.id)
}

// ─── View mode ────────────────────────────────────────────────────────────────

const gridView = ref(false)

// ─── Display helpers ──────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function previewTitle(s: Scribble): string {
  if (s.title) return s.title
  const first = s.content.split('\n')[0]?.trim() ?? ''
  return first.slice(0, 72) || 'Untitled'
}

function previewBody(s: Scribble): string {
  if (!s.title) return ''
  return s.content.split('\n').slice(0, 2).join(' ').trim().slice(0, 120)
}

function gridBody(s: Scribble): string {
  if (s.title) return s.content.split('\n').slice(0, 4).join(' ').trim().slice(0, 200)
  return s.content.split('\n').slice(1).join(' ').trim().slice(0, 180)
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  gridView.value = localStorage.getItem('jots-view') === 'grid'
  if (dbComposable.isAvailable) {
    scribbles.value = await dbComposable.getScribbles()
  }
  const storedVoice = await idbGetAll<Omit<VoiceNote, 'url'>>(VOICE_STORE)
  storedVoice.sort((a, b) => b.created_at.localeCompare(a.created_at))
  voiceNotes.value = storedVoice.map((n) => ({ ...n, url: URL.createObjectURL(n.blob) }))
  const storedImages = await idbGetAll<Omit<ImageNote, 'url'>>(IMAGE_STORE)
  storedImages.sort((a, b) => b.created_at.localeCompare(a.created_at))
  imageNotes.value = storedImages.map((n) => ({ ...n, url: URL.createObjectURL(n.blob) }))
})

watch(gridView, v => localStorage.setItem('jots-view', v ? 'grid' : 'list'))

onUnmounted(() => {
  stopRecording()
  stopRecognitionCapture()
  voiceNotes.value.forEach((n) => {
    if (n.url) URL.revokeObjectURL(n.url)
  })
  imageNotes.value.forEach((n) => {
    if (n.url) URL.revokeObjectURL(n.url)
  })
  if (imagePreviewing.value) URL.revokeObjectURL(imagePreviewing.value.url)
  audioMap.forEach((a) => a.pause())
})
</script>

<template>
  <div class="space-y-5">

    <header class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Jots</h2>
      <div class="flex items-center gap-1.5">
        <UButton
          :icon="gridView ? 'i-heroicons-list-bullet' : 'i-heroicons-squares-2x2'"
          size="sm"
          color="neutral"
          variant="ghost"
          :aria-label="gridView ? 'Switch to list view' : 'Switch to grid view'"
          @click="gridView = !gridView"
        />
        <UButton icon="i-heroicons-plus" size="sm" @click="activeModal = 'picker'">New</UButton>
      </div>
    </header>

    <!-- Error -->
    <UAlert
      v-if="errorMsg"
      :title="errorMsg"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-circle"
      :close-button="{ icon: 'i-heroicons-x-mark', color: 'error', variant: 'ghost', size: 'sm' }"
      @close="errorMsg = null"
    />

    <!-- Empty state -->
    <section
      v-if="timeline.length === 0"
      class="flex flex-col items-center justify-center gap-4 py-12 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
        <UIcon name="i-heroicons-document-text" class="w-8 h-8 text-slate-400" />
      </div>
      <div class="space-y-1">
        <p class="font-semibold text-slate-200">No jots yet</p>
        <p class="text-sm text-slate-500">Tap New to add a text note, voice recording, or photo.</p>
      </div>
    </section>

    <!-- ── List view ─────────────────────────────────────────────────────── -->
    <ul v-else-if="!gridView" class="space-y-2">
      <template v-for="item in timeline" :key="item.kind + '-' + item.data.id">

        <!-- Text jot -->
        <li
          v-if="item.kind === 'text'"
          class="p-3 rounded-xl bg-slate-900 border border-slate-800 active:opacity-70 transition-opacity cursor-pointer"
          @click="openEditText(item.data)"
        >
          <div class="flex items-start gap-2.5">
            <div class="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center mt-0.5 shrink-0">
              <UIcon name="i-heroicons-pencil" class="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <p class="font-medium text-sm text-slate-100 leading-snug">{{ previewTitle(item.data) }}</p>
                <span class="text-[11px] text-slate-600 shrink-0 mt-0.5">{{ timeAgo(item.data.updated_at) }}</span>
              </div>
              <p v-if="previewBody(item.data)" class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ previewBody(item.data) }}</p>
              <div v-if="item.data.tags.length > 0" class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="tag in item.data.tags.slice(0, 5)"
                  :key="tag"
                  class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px]
                         text-slate-400 bg-slate-800 border border-slate-700"
                >
                  <span v-if="splitTag(tag).parent" class="text-slate-600">{{ splitTag(tag).parent }}/</span>
                  <span>{{ splitTag(tag).leaf }}</span>
                </span>
                <span v-if="item.data.tags.length > 5" class="text-[10px] text-slate-600 self-center pl-0.5">+{{ item.data.tags.length - 5 }}</span>
              </div>
            </div>
          </div>
        </li>

        <!-- Voice jot -->
        <li
          v-else-if="item.kind === 'voice'"
          class="p-3 rounded-xl bg-slate-900 border border-slate-800"
        >
          <div class="flex items-center gap-3">
            <div class="w-6 h-6 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
              <UIcon name="i-heroicons-microphone" class="w-3.5 h-3.5 text-rose-400" />
            </div>
            <UButton
              :icon="currentlyPlaying === item.data.id ? 'i-heroicons-pause' : 'i-heroicons-play'"
              :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
              :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
              size="sm"
              :ui="{ base: 'rounded-full' }"
              :disabled="transcribingExistingId === item.data.id"
              @click="transcribingExistingId === item.data.id ? undefined : togglePlay(item.data)"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-slate-300 truncate">{{ fmtDate(item.data.created_at) }}</p>
              <p
                class="text-xs tabular-nums"
                :class="transcribingExistingId === item.data.id ? 'text-primary-400 animate-pulse' : 'text-slate-500'"
              >
                {{ transcribingExistingId === item.data.id ? 'Transcribing…' : fmtDuration(item.data.duration) }}
              </p>
            </div>
            <UButton
              v-if="speechSupported"
              icon="i-heroicons-language"
              color="neutral"
              variant="ghost"
              size="sm"
              class="text-slate-600 hover:text-primary-400"
              :loading="transcribingExistingId === item.data.id"
              :disabled="!!transcribingExistingId && transcribingExistingId !== item.data.id"
              @click="transcribeNote(item.data)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="neutral"
              variant="ghost"
              size="sm"
              class="text-slate-600 hover:text-red-400"
              :disabled="transcribingExistingId === item.data.id"
              @click="deleteVoiceNote(item.data)"
            />
          </div>
        </li>

        <!-- Image jot -->
        <li
          v-else-if="item.kind === 'image'"
          class="p-3 rounded-xl bg-slate-900 border border-slate-800"
        >
          <div class="flex items-center gap-3">
            <div class="w-6 h-6 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0">
              <UIcon name="i-heroicons-photo" class="w-3.5 h-3.5 text-sky-400" />
            </div>
            <img
              v-if="item.data.url"
              :src="item.data.url"
              :alt="item.data.filename"
              class="w-16 h-16 object-cover rounded-lg shrink-0"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-slate-300 truncate">{{ item.data.filename }}</p>
              <p class="text-xs text-slate-500">{{ fmtDate(item.data.created_at) }}</p>
            </div>
            <UButton
              icon="i-heroicons-trash"
              color="neutral"
              variant="ghost"
              size="sm"
              class="text-slate-600 hover:text-red-400"
              @click="deleteImageNote(item.data)"
            />
          </div>
        </li>

      </template>
    </ul>

    <!-- ── Grid view ──────────────────────────────────────────────────────── -->
    <ul v-else class="grid grid-cols-2 gap-2 items-start">
      <template v-for="item in timeline" :key="item.kind + '-' + item.data.id">

        <!-- Text tile (Google Keep card) -->
        <li
          v-if="item.kind === 'text'"
          class="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden cursor-pointer active:scale-[0.97] transition-transform"
          @click="openEditText(item.data)"
        >
          <!-- Amber accent stripe -->
          <div class="h-0.5 bg-gradient-to-r from-amber-500/70 to-amber-600/30" />
          <div class="p-3 flex flex-col gap-2">
            <p class="font-semibold text-sm text-slate-100 leading-snug line-clamp-2">
              {{ previewTitle(item.data) }}
            </p>
            <p v-if="gridBody(item.data)" class="text-xs text-slate-500 line-clamp-5 leading-relaxed">
              {{ gridBody(item.data) }}
            </p>
            <div class="flex items-end justify-between gap-1 mt-auto pt-1">
              <div class="flex flex-wrap gap-1 min-w-0">
                <span
                  v-for="tag in item.data.tags.slice(0, 2)"
                  :key="tag"
                  class="px-1.5 py-0.5 rounded-full text-[9px] bg-slate-800 text-slate-500 border border-slate-700/60 truncate max-w-[72px]"
                >{{ splitTag(tag).leaf }}</span>
                <span v-if="item.data.tags.length > 2" class="text-[9px] text-slate-600 self-center">+{{ item.data.tags.length - 2 }}</span>
              </div>
              <span class="text-[10px] text-slate-600 shrink-0">{{ timeAgo(item.data.updated_at) }}</span>
            </div>
          </div>
        </li>

        <!-- Voice tile (Windows-style tile) -->
        <li
          v-else-if="item.kind === 'voice'"
          class="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden"
        >
          <div class="h-0.5 bg-gradient-to-r from-rose-500/70 to-rose-600/30" />
          <div class="p-3 flex flex-col items-center gap-2.5 text-center">
            <!-- Big mic icon — tile aesthetic -->
            <div class="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mt-1">
              <UIcon name="i-heroicons-microphone" class="w-6 h-6 text-rose-400" />
            </div>
            <!-- Duration + date -->
            <div>
              <p
                class="text-sm font-mono tabular-nums font-medium"
                :class="transcribingExistingId === item.data.id ? 'text-primary-400 animate-pulse' : 'text-slate-300'"
              >
                {{ transcribingExistingId === item.data.id ? '…' : fmtDuration(item.data.duration) }}
              </p>
              <p class="text-[10px] text-slate-600 mt-0.5">{{ timeAgo(item.data.created_at) }}</p>
            </div>
            <!-- Play button -->
            <UButton
              :icon="currentlyPlaying === item.data.id ? 'i-heroicons-pause' : 'i-heroicons-play'"
              :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
              :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
              size="xs"
              :ui="{ base: 'rounded-full' }"
              :disabled="transcribingExistingId === item.data.id"
              @click.stop="transcribingExistingId === item.data.id ? undefined : togglePlay(item.data)"
            />
            <!-- Actions -->
            <div class="flex items-center gap-0.5 pb-1">
              <UButton
                v-if="speechSupported"
                icon="i-heroicons-language"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-slate-600 hover:text-primary-400"
                :loading="transcribingExistingId === item.data.id"
                :disabled="!!transcribingExistingId && transcribingExistingId !== item.data.id"
                @click.stop="transcribeNote(item.data)"
              />
              <UButton
                icon="i-heroicons-trash"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-slate-600 hover:text-red-400"
                :disabled="transcribingExistingId === item.data.id"
                @click.stop="deleteVoiceNote(item.data)"
              />
            </div>
          </div>
        </li>

        <!-- Image tile -->
        <li
          v-else-if="item.kind === 'image'"
          class="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden"
        >
          <!-- Image fills top -->
          <img
            v-if="item.data.url"
            :src="item.data.url"
            :alt="item.data.filename"
            class="w-full aspect-square object-cover"
          />
          <div v-else class="w-full aspect-square bg-slate-800 flex items-center justify-center">
            <UIcon name="i-heroicons-photo" class="w-8 h-8 text-slate-600" />
          </div>
          <!-- Footer -->
          <div class="px-2.5 py-2 flex items-center justify-between gap-1">
            <div class="min-w-0">
              <p class="text-[11px] text-slate-400 truncate leading-tight">{{ item.data.filename }}</p>
              <p class="text-[10px] text-slate-600 mt-0.5">{{ timeAgo(item.data.created_at) }}</p>
            </div>
            <UButton
              icon="i-heroicons-trash"
              color="neutral"
              variant="ghost"
              size="xs"
              class="text-slate-600 hover:text-red-400 shrink-0"
              @click="deleteImageNote(item.data)"
            />
          </div>
        </li>

      </template>
    </ul>

    <!-- ── Type picker modal ──────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="activeModal === 'picker'" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeModal" />
        <div class="relative w-full sm:max-w-sm bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-3">
          <h3 class="text-base font-semibold text-center">New Jot</h3>
          <div class="grid grid-cols-3 gap-3">
            <button
              class="flex flex-col items-center gap-2 p-4 rounded-2xl bg-slate-800 border border-slate-700 active:opacity-70 transition-opacity"
              @click="openNewText"
            >
              <div class="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <UIcon name="i-heroicons-pencil" class="w-5 h-5 text-amber-400" />
              </div>
              <span class="text-xs text-slate-300">Text</span>
            </button>
            <button
              class="flex flex-col items-center gap-2 p-4 rounded-2xl bg-slate-800 border border-slate-700 active:opacity-70 transition-opacity"
              @click="activeModal = 'record'"
            >
              <div class="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center">
                <UIcon name="i-heroicons-microphone" class="w-5 h-5 text-rose-400" />
              </div>
              <span class="text-xs text-slate-300">Voice</span>
            </button>
            <button
              class="flex flex-col items-center gap-2 p-4 rounded-2xl bg-slate-800 border border-slate-700 active:opacity-70 transition-opacity"
              @click="activeModal = 'image'"
            >
              <div class="w-10 h-10 rounded-full bg-sky-500/10 flex items-center justify-center">
                <UIcon name="i-heroicons-photo" class="w-5 h-5 text-sky-400" />
              </div>
              <span class="text-xs text-slate-300">Image</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── Text modal ─────────────────────────────────────────────────────── -->
    <UModal :open="activeModal === 'text'" @update:open="v => { if (!v) closeModal() }">
      <template #content>
        <div class="flex flex-col max-h-[90dvh]">

          <div class="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-800 shrink-0">
            <h3 class="text-base font-semibold">{{ textEditing ? 'Edit Jot' : 'New Jot' }}</h3>
            <div class="flex items-center gap-2">
              <span v-if="textEditing" class="text-[11px] text-slate-600">
                Created {{ timeAgo(textEditing.created_at) }}
              </span>
              <UButton
                v-if="textEditing"
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                size="sm"
                @click="deleteText"
              />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto px-4 pt-3 pb-2 space-y-3 min-h-0">

            <input
              v-model="textForm.title"
              placeholder="Title (optional)"
              class="w-full bg-transparent text-base font-medium text-slate-100
                     placeholder-slate-600 outline-none border-0"
            />

            <div class="border-t border-slate-800/60" />

            <UTextarea
              v-model="textForm.content"
              placeholder="Start writing…"
              autoresize
              :rows="6"
              variant="none"
              class="w-full"
              :ui="{ base: 'resize-none bg-transparent text-slate-200 placeholder-slate-600 text-sm leading-relaxed' }"
            />

            <div class="border-t border-slate-800 pt-3 space-y-2">
              <p class="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Tags</p>
              <div class="flex flex-wrap items-center gap-1.5 min-h-[20px]">
                <span
                  v-for="tag in textForm.tags"
                  :key="tag"
                  class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px]
                         bg-slate-800 text-slate-300 border border-slate-700"
                >
                  <span v-if="splitTag(tag).parent" class="text-slate-500">{{ splitTag(tag).parent }}/</span>
                  {{ splitTag(tag).leaf }}
                  <button
                    class="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full
                           text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                    @click.stop="removeTag(tag)"
                  >×</button>
                </span>
                <input
                  v-model="tagInput"
                  placeholder="+ add tag"
                  class="text-[11px] bg-transparent text-slate-400 placeholder-slate-600
                         outline-none border-0 min-w-0 w-20"
                  @keydown="onTagKeydown"
                  @blur="commitTag"
                />
              </div>
            </div>

            <div class="border-t border-slate-800 pt-3 pb-1">
              <button
                class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1.5 transition-colors"
                @click="annotExpanded = !annotExpanded"
              >
                <UIcon
                  :name="annotExpanded ? 'i-heroicons-chevron-down' : 'i-heroicons-tag'"
                  class="w-3.5 h-3.5"
                />
                <span v-if="annotationCount > 0">
                  {{ annotationCount }} annotation{{ annotationCount !== 1 ? 's' : '' }}
                </span>
                <span v-else>{{ annotExpanded ? 'Hide annotations' : 'Add annotations' }}</span>
              </button>

              <div v-if="annotExpanded" class="mt-2 space-y-2">
                <div
                  v-for="(val, key) in textForm.annotations"
                  :key="key"
                  class="flex items-center gap-2"
                >
                  <span class="text-[11px] text-slate-500 font-mono shrink-0">{{ key }}</span>
                  <span class="text-[11px] text-slate-400 flex-1 min-w-0 truncate">{{ val }}</span>
                  <UButton
                    icon="i-heroicons-x-mark"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="text-slate-600 hover:text-red-400 shrink-0"
                    @click="removeAnnot(String(key))"
                  />
                </div>
                <div class="flex items-center gap-1.5">
                  <UInput
                    v-model="newAnnotKey"
                    placeholder="key"
                    size="xs"
                    variant="outline"
                    class="flex-1"
                    @keydown.enter="commitAnnot"
                  />
                  <UInput
                    v-model="newAnnotVal"
                    placeholder="value"
                    size="xs"
                    variant="outline"
                    class="flex-1"
                    @keydown.enter="commitAnnot"
                  />
                  <UButton size="xs" variant="soft" color="neutral" @click="commitAnnot">Add</UButton>
                </div>
              </div>
            </div>

          </div>

          <div class="flex justify-end gap-2 px-4 py-3 border-t border-slate-800 shrink-0">
            <UButton variant="ghost" color="neutral" @click="closeModal">Cancel</UButton>
            <UButton
              :loading="textSaving"
              :disabled="textSaving || !canSaveText"
              @click="saveText"
            >
              {{ textEditing ? 'Save' : 'Create' }}
            </UButton>
          </div>

        </div>
      </template>
    </UModal>

    <!-- ── Record modal ────────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="activeModal === 'record'" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="() => { if (!recording) closeModal() }" />
        <div class="relative w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4">

          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">Voice Note</h3>
            <UButton
              v-if="!recording"
              icon="i-heroicons-x-mark"
              variant="ghost"
              color="neutral"
              size="sm"
              @click="closeModal"
            />
          </div>

          <div class="flex flex-col items-center gap-3 py-4">
            <button
              class="w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="recording
                ? 'bg-red-500 shadow-xl shadow-red-500/30 scale-105'
                : 'bg-slate-800 hover:bg-slate-700'"
              :aria-label="recording ? 'Stop recording' : 'Start recording'"
              @click="toggleRecording"
            >
              <UIcon
                :name="recording ? 'i-heroicons-stop' : 'i-heroicons-microphone'"
                class="w-10 h-10"
                :class="recording ? 'text-white' : 'text-slate-300'"
              />
            </button>

            <p v-if="recording" class="text-red-400 text-sm font-mono tabular-nums animate-pulse">
              ● {{ fmtDuration(recordingSeconds) }}
            </p>
            <p v-else-if="transcriptionPending" class="text-xs text-primary-400 animate-pulse">
              Finishing transcription…
            </p>
            <p v-else class="text-xs text-slate-500">Tap to record</p>

            <div
              v-if="recording && speechSupported && (finalTranscript || interimTranscript)"
              class="w-full max-w-sm bg-slate-800/60 rounded-2xl px-4 py-3 text-sm text-slate-300 min-h-[3rem]"
            >
              <span>{{ finalTranscript }}</span>
              <span class="text-slate-500 italic">{{ interimTranscript }}</span>
            </div>
          </div>

        </div>
      </div>
    </Teleport>

    <!-- ── Image picker modal ─────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="activeModal === 'image'" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="() => { cancelImagePreview(); closeModal() }" />
        <div class="relative w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4">

          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">Add Image</h3>
            <UButton
              icon="i-heroicons-x-mark"
              variant="ghost"
              color="neutral"
              size="sm"
              @click="() => { cancelImagePreview(); closeModal() }"
            />
          </div>

          <!-- Preview -->
          <div v-if="imagePreviewing" class="space-y-3">
            <img
              :src="imagePreviewing.url"
              :alt="imagePreviewing.filename"
              class="w-full max-h-64 object-contain rounded-xl bg-slate-800"
            />
            <p class="text-xs text-slate-500 truncate">{{ imagePreviewing.filename }}</p>
            <div class="flex gap-2">
              <UButton class="flex-1" @click="saveImage">Save</UButton>
              <UButton variant="outline" color="neutral" @click="cancelImagePreview">Choose another</UButton>
            </div>
          </div>

          <!-- Picker buttons -->
          <div v-else class="grid grid-cols-2 gap-3">
            <label
              class="flex flex-col items-center gap-2 p-5 rounded-2xl bg-slate-800 border border-slate-700 cursor-pointer active:opacity-70 transition-opacity"
            >
              <UIcon name="i-heroicons-photo" class="w-8 h-8 text-sky-400" />
              <span class="text-sm text-slate-300">Gallery</span>
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                @change="handleFileInput"
              />
            </label>
            <label
              class="flex flex-col items-center gap-2 p-5 rounded-2xl bg-slate-800 border border-slate-700 cursor-pointer active:opacity-70 transition-opacity"
            >
              <UIcon name="i-heroicons-camera" class="w-8 h-8 text-sky-400" />
              <span class="text-sm text-slate-300">Camera</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                class="sr-only"
                @change="handleFileInput"
              />
            </label>
          </div>

        </div>
      </div>
    </Teleport>

    <!-- ── Transcript save modal ───────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="activeModal === 'transcript'" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeTranscriptModal" />
        <div class="relative w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4">

          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">Save transcription</h3>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="closeTranscriptModal" />
          </div>

          <div class="space-y-1">
            <label class="text-xs text-slate-500 font-medium">Title</label>
            <input
              v-model="transcriptTitle"
              type="text"
              class="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div class="space-y-1">
            <label class="text-xs text-slate-500 font-medium">Transcript</label>
            <textarea
              v-model="transcriptText"
              rows="5"
              class="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
            />
          </div>

          <label v-if="transcribingNoteId" class="flex items-center gap-2 cursor-pointer">
            <input v-model="deleteAfterTranscribe" type="checkbox" class="rounded border-slate-600 bg-slate-800 text-primary-500 focus:ring-primary-500" />
            <span class="text-sm text-slate-400">Delete voice recording after saving</span>
          </label>

          <div class="flex gap-2">
            <UButton
              class="flex-1"
              color="primary"
              :loading="savingTranscript"
              @click="saveTranscript"
            >
              Save to Jots
            </UButton>
            <UButton
              variant="outline"
              color="neutral"
              @click="closeTranscriptModal"
            >
              Discard
            </UButton>
          </div>

        </div>
      </div>
    </Teleport>

  </div>
</template>
